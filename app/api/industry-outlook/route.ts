import { NextResponse } from "next/server"
import { unstable_cache } from "next/cache"
import { retrieveSources } from "@/app/services/industry-outlook/retrieveSources"
import type { RetrievedSource } from "@/app/services/industry-outlook/schema"
import { newsCalendarDayET, NEWS_TAB_REVALIDATE_SECONDS } from "@/lib/news-tab-cache"

export const runtime = "nodejs"
export const maxDuration = 60

const SECTION_HEADINGS = [
  "Executive Summary",
  "U.S. commercial real estate outlook (CRE debt & distress)",
  "Miami-specific CRE and distressed-debt outlook",
  "How this shapes distressed-debt investing",
  "Key sources (for further reading)",
]

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ])
}

function hasRequiredSections(text: string): boolean {
  return SECTION_HEADINGS.every((heading) => text.toLowerCase().includes(heading.toLowerCase()))
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
    "You are a senior CRE distressed-debt analyst at a private equity firm specializing in distressed commercial real estate debt, NPL acquisitions, and loan workouts. " +
    "Write for the investment committee: plain text only, data-forward, specific numbers and dates. " +
    "Use your live web search to find the most current market data — CMBS delinquency rates, special servicing volumes, foreclosure filings, note sale pipelines, and deal activity. " +
    "Supplement with the source articles provided below. Prioritize verifiable, cited facts. " +
    "Never use markdown symbols (no **, no #, no bullet dashes — use plain hyphens)."

  const user = `Write a distressed commercial real estate debt outlook memo. Use your live search AND the source articles below.

SCOPE: U.S. national, Florida, Miami-Dade

OUTPUT — use these exact five section headers in this order:
1) Executive Summary
2) U.S. commercial real estate outlook (CRE debt & distress)
3) Miami-specific CRE and distressed-debt outlook
4) How this shapes distressed-debt investing
5) Key sources (for further reading)

WRITING RULES:
- 4-6 bullets per section (except Key sources).
- Each bullet: 1-2 sentences. Lead with a concrete metric, named entity, or date when available.
- Include dollar amounts, percentages, basis points, delinquency rates, loan counts, or deal sizes.
- Name specific properties, cities, lenders, borrowers, or servicers when known.
- Search for: current CMBS delinquency rates, special servicing volumes, CRE loan maturity wall data, South Florida foreclosure activity, distressed note sale transactions.
- Key sources: list 4-8 URLs, one per line, format: Title — https://url

SUPPLEMENTAL SOURCE ARTICLES:
${richContext || "No supplemental articles provided — rely on live search."}`

  return { system, user }
}

async function callPerplexity(
  apiKey: string,
  system: string,
  user: string
): Promise<string> {
  const response = await withTimeout(
    fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        temperature: 0.2,
        max_tokens: 1400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      cache: "no-store",
    }),
    40000,
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

/** Full generation — only called inside unstable_cache when API key exists. */
async function runIndustryOutlookGeneration(): Promise<string> {
  let sources: RetrievedSource[] = []
  try {
    sources = await withTimeout(
      retrieveSources(),
      8000,
      "Source retrieval timed out."
    )
  } catch (err) {
    console.error("Industry outlook source retrieval error:", err)
  }

  const apiKey = process.env.PERPLEXITY_API_KEY?.trim()
  if (!apiKey) {
    return buildFallbackMemo(sources, "Missing PERPLEXITY_API_KEY")
  }

  try {
    const { system, user } = buildPrompt(sources)
    const content = cleanMemoText(await callPerplexity(apiKey, system, user))

    if (!content || !hasRequiredSections(content) || !hasOrderedSections(content)) {
      return buildFallbackMemo(sources, "Output failed section-format requirements")
    }

    return content
  } catch (err) {
    console.error("Industry outlook generation error:", err)
    return buildFallbackMemo(
      sources,
      err instanceof Error ? err.message : "Unhandled generation error"
    )
  }
}

export async function POST() {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim()
  if (!apiKey) {
    let sources: RetrievedSource[] = []
    try {
      sources = await withTimeout(
        retrieveSources(),
        8000,
        "Source retrieval timed out."
      )
    } catch (err) {
      console.error("Industry outlook source retrieval error:", err)
    }
    return NextResponse.json({ text: buildFallbackMemo(sources, "Missing PERPLEXITY_API_KEY") })
  }

  const day = newsCalendarDayET()
  const text = await unstable_cache(
    async () => runIndustryOutlookGeneration(),
    ["industry-outlook-shared-v2", day],
    { revalidate: NEWS_TAB_REVALIDATE_SECONDS }
  )()

  return NextResponse.json({ text })
}
