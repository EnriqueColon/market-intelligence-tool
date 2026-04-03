import { NextResponse } from "next/server"
import { retrieveSources } from "@/app/services/industry-outlook/retrieveSources"
import type { RetrievedSource } from "@/app/services/industry-outlook/schema"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

type CacheEntry = {
  text: string
  fetchedAt: number
}

const CACHE_TTL_MS = 2 * 60 * 60 * 1000
let cached: CacheEntry | null = null

const SECTION_HEADINGS = [
  "Executive Summary",
  "U.S. commercial real estate outlook (CRE debt & distress)",
  "Miami-specific CRE and distressed-debt outlook",
  "How this shapes distressed-debt investing",
  "Key sources (for further reading)",
]

function isFresh(entry: CacheEntry | null) {
  if (!entry) return false
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ])
}

function hasRequiredSections(text: string): boolean {
  return SECTION_HEADINGS.every((heading) =>
    text.toLowerCase().includes(heading.toLowerCase())
  )
}

function hasOrderedSections(text: string): boolean {
  const lowered = text.toLowerCase()
  let lastIndex = -1
  for (const heading of SECTION_HEADINGS) {
    const idx = lowered.indexOf(heading.toLowerCase())
    if (idx === -1 || idx < lastIndex) return false
    lastIndex = idx
  }
  return true
}

function cleanMemoText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function normalizeSources(sources: RetrievedSource[]): Array<{ title: string; url: string }> {
  const seen = new Set<string>()
  const output: Array<{ title: string; url: string }> = []
  for (const item of sources) {
    const url = String(item.url || "").trim()
    if (!/^https?:\/\//i.test(url)) continue
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      title: String(item.title || url).trim(),
      url,
    })
    if (output.length >= 12) break
  }
  return output
}

function buildFallbackMemo(sources: RetrievedSource[], reason: string): string {
  const sourceLines = normalizeSources(sources)
  const renderedSources =
    sourceLines.length > 0
      ? sourceLines.map((s) => `${s.title} — ${s.url}`)
      : ["No verified sources were available in this run."]

  return [
    "Executive Summary",
    "- We could not complete a full generated outlook in this run.",
    `- Reason: ${reason}.`,
    "- A provisional update is provided below with available sources.",
    "",
    "U.S. commercial real estate outlook (CRE debt & distress)",
    "- Data retrieval was partially available; re-run is recommended for a fuller update.",
    "",
    "Miami-specific CRE and distressed-debt outlook",
    "- Miami/Florida signal coverage was limited in this run; re-run is recommended.",
    "",
    "How this shapes distressed-debt investing",
    "- Use the sources below for direct verification and decision support.",
    "",
    "Key sources (for further reading)",
    ...renderedSources,
  ].join("\n")
}

function buildPrompt(sources: RetrievedSource[]): {
  system: string
  user: string
} {
  // Build rich source context — include publisher, date, and snippet so the
  // LLM has actual data points to cite, not just headlines.
  const seen = new Set<string>()
  const richContext = sources
    .filter((s) => {
      const url = String(s.url || "").trim()
      if (!/^https?:\/\//i.test(url) || seen.has(url.toLowerCase())) return false
      seen.add(url.toLowerCase())
      return true
    })
    .slice(0, 6)
    .map((s, i) => {
      const lines = [
        `[Source ${i + 1} — ${(s.region || "national").toUpperCase()}]`,
        `Title: ${s.title}`,
        `Publisher: ${s.publisher || "Unknown"} | Date: ${s.date || "Recent"}`,
        `URL: ${s.url}`,
      ]
      const snippet = (s.snippet || "").trim()
      if (snippet) lines.push(`Content: ${snippet.slice(0, 600)}`)
      return lines.join("\n")
    })
    .join("\n\n")

  const system =
    "You are a senior CRE distressed-debt analyst at a private equity firm. " +
    "Write for the investment committee: plain text only, data-forward, specific numbers and dates. " +
    "Cite facts from the sources provided. If a metric is not in the sources, write 'data unavailable in this run'. " +
    "Never invent statistics. Never use markdown symbols (no **, no #, no bullet dashes — use plain hyphens)."

  const user = `Write a distressed commercial real estate debt outlook memo using the source articles below.

SCOPE: U.S. national, Florida, Miami-Dade

OUTPUT — use these exact five section headers in this order:
1) Executive Summary
2) U.S. commercial real estate outlook (CRE debt & distress)
3) Miami-specific CRE and distressed-debt outlook
4) How this shapes distressed-debt investing
5) Key sources (for further reading)

WRITING RULES:
- 4-6 bullets per section (except Key sources).
- Each bullet: 1-2 sentences, lead with a concrete metric or named entity when the source provides one.
- Include dollar amounts, percentages, basis points, delinquency rates, loan counts, or deal sizes whenever the sources mention them.
- Name specific properties, cities, lenders, borrowers, or servicers when cited in the sources.
- For bullets where source data is thin, note the signal and flag it as limited-data.
- Key sources: list 4-8 source URLs, one per line, format: Title — https://url

SOURCE ARTICLES:
${richContext || "No source articles available in this run."}`

  return { system, user }
}

async function callOpenAI(
  apiKey: string,
  system: string,
  user: string
): Promise<string> {
  const response = await withTimeout(
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_OUTLOOK_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 1400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      cache: "no-store",
    }),
    35000,
    "Industry outlook generation timed out."
  )

  if (!response.ok) {
    throw new Error(`Provider error ${response.status}`)
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return json.choices?.[0]?.message?.content?.trim() || ""
}

export async function POST() {
  // Always serve from memory cache when fresh — this was previously disabled
  // on Vercel which caused every page load to re-run the full generation.
  if (isFresh(cached)) {
    return NextResponse.json({ text: cached?.text })
  }

  let sources: RetrievedSource[] = []
  try {
    sources = await withTimeout(
      retrieveSources(),
      12000,
      "Source retrieval timed out."
    )
  } catch (err) {
    console.error("Industry outlook source retrieval error:", err)
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    const fallback = buildFallbackMemo(sources, "Missing OPENAI_API_KEY")
    return NextResponse.json({ text: fallback }, { status: 200 })
  }

  try {
    const { system, user } = buildPrompt(sources)
    let content = cleanMemoText(await callOpenAI(apiKey, system, user))

    if (!content || !hasRequiredSections(content) || !hasOrderedSections(content)) {
      const repairUser =
        `Reformat the following memo into EXACTLY these five section headers in this order:
${SECTION_HEADINGS.join("\n")}

Rules:
- Plain text only, no markdown symbols.
- Keep original meaning and data points.
- Use bullet points under each section.
- Ensure "Key sources (for further reading)" contains line items in format: Title — https://url

MEMO TO REFORMAT:
${content || "(empty)"}
`
      const repaired = await callOpenAI(apiKey, system, repairUser)
      if (repaired) content = cleanMemoText(repaired)
    }

    if (!content || !hasRequiredSections(content) || !hasOrderedSections(content)) {
      const fallback = buildFallbackMemo(sources, "Output failed section-format requirements")
      if (true /* always cache */) {
        cached = { text: fallback, fetchedAt: Date.now() }
      }
      return NextResponse.json({ text: fallback }, { status: 200 })
    }

    if (true /* always cache */) {
      cached = { text: content, fetchedAt: Date.now() }
    }
    return NextResponse.json({ text: content }, { status: 200 })
  } catch (err) {
    console.error("Industry outlook generation error:", err)
    const fallback = buildFallbackMemo(
      sources,
      err instanceof Error ? err.message : "Unhandled generation error"
    )
    if (true /* always cache */) {
      cached = { text: fallback, fetchedAt: Date.now() }
    }
    return NextResponse.json({ text: fallback }, { status: 200 })
  }
}
