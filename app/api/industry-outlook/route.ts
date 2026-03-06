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
  const hitCount = SECTION_HEADINGS.filter((heading) =>
    text.toLowerCase().includes(heading.toLowerCase())
  ).length
  return hitCount >= 3
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
  const sourceContext = normalizeSources(sources)
    .map((s) => `${s.title} — ${s.url}`)
    .join("\n")

  const system =
    "You are a senior CRE distressed-debt analyst writing for a private equity investment committee. " +
    "Write plain text only, concise, data-forward, and decision-oriented. " +
    "Do not invent sources; if uncertain, say data unavailable in this run."

  const user = `Create an industry outlook memo for distressed commercial real estate debt.

Scope:
- U.S.
- Florida
- Miami

Timeframe:
- Prioritize recent data (last 3-12 months), include period labels when possible.

Output format (exact sections):
1) Executive Summary
2) U.S. commercial real estate outlook (CRE debt & distress)
3) Miami-specific CRE and distressed-debt outlook
4) How this shapes distressed-debt investing
5) Key sources (for further reading)

Rules:
- 3-6 bullets per section (except sources list).
- Keep bullets to 1-2 sentences.
- Prefer concrete metrics (rates, %, $, bps, counts) when available.
- If a metric is unavailable, state "data unavailable in this run".
- In Key sources, provide 6-12 specific URLs (not generic homepages), one per line:
  Title — https://url

SOURCES_CONTEXT:
${sourceContext || "No source context available in this run."}`

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
        max_tokens: 1600,
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
  const allowMemoryCache = process.env.VERCEL !== "1"
  if (allowMemoryCache && isFresh(cached)) {
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
    let content = await callOpenAI(apiKey, system, user)

    if (!content || !hasRequiredSections(content)) {
      const repairUser =
        `${user}\n\nReformat your answer now to include ALL five required section headers exactly as listed.`
      const repaired = await callOpenAI(apiKey, system, repairUser)
      if (repaired) content = repaired
    }

    if (!content || !hasRequiredSections(content)) {
      const fallback = buildFallbackMemo(sources, "Output failed section-format requirements")
      if (allowMemoryCache) {
        cached = { text: fallback, fetchedAt: Date.now() }
      }
      return NextResponse.json({ text: fallback }, { status: 200 })
    }

    if (allowMemoryCache) {
      cached = { text: content, fetchedAt: Date.now() }
    }
    return NextResponse.json({ text: content }, { status: 200 })
  } catch (err) {
    console.error("Industry outlook generation error:", err)
    const fallback = buildFallbackMemo(
      sources,
      err instanceof Error ? err.message : "Unhandled generation error"
    )
    if (allowMemoryCache) {
      cached = { text: fallback, fetchedAt: Date.now() }
    }
    return NextResponse.json({ text: fallback }, { status: 200 })
  }
}
