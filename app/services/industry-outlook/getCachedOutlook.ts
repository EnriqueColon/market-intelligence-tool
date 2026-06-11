import { unstable_cache } from "next/cache"
import { retrieveSources } from "@/app/services/industry-outlook/retrieveSources"
import type { RetrievedSource } from "@/app/services/industry-outlook/schema"
import { newsCalendarDayET, NEWS_TAB_REVALIDATE_SECONDS } from "@/lib/news-tab-cache"
import { callClaude, getClaudeApiKey } from "@/lib/claude"

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ])
}

/** True if the text looks like a real AI-generated memo (has substance). */
function hasUsableContent(text: string): boolean {
  if (!text || text.trim().length < 200) return false
  // At least one of the core section concepts must appear
  const t = text.toLowerCase()
  return (
    t.includes("executive summary") ||
    t.includes("commercial real estate") ||
    t.includes("distressed") ||
    t.includes("cmbs") ||
    t.includes("special servicing")
  )
}

const MEMO_HEADINGS = [
  "Executive Summary",
  "U.S. commercial real estate outlook (CRE debt & distress)",
  "Miami-specific CRE and distressed-debt outlook",
  "How this shapes distressed-debt investing",
  "Key sources (for further reading)",
]

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Sentence boundary: period/!/? followed by space and a capital/digit/$.
// Negative lookbehind avoids splitting after two-letter abbreviations (U.S., D.C.).
const SENTENCE_SPLIT_RE = /(?<![A-Z]\.[A-Z]\.)(?<=[.!?])\s+(?=[A-Z0-9$"(])/

/**
 * Generation is flaky about line breaks: sometimes a whole section arrives as
 * one fused paragraph (especially with web-search citation blocks). Enforce
 * one bullet per key point so the UI never renders a wall of text.
 */
function enforceBulletStructure(text: string): string {
  const out: string[] = []
  let inSources = false

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const isHeading = MEMO_HEADINGS.some((h) => trimmed.toLowerCase() === h.toLowerCase())
    if (isHeading) {
      inSources = /^key sources/i.test(trimmed)
      out.push("", trimmed)
      continue
    }
    if (inSources) {
      out.push(trimmed)
      continue
    }

    // Re-split bullet markers that got glued mid-line ("...defaults. - CMBS...")
    const pieces = trimmed.replace(/([.!?])\s+-\s+(?=[A-Z0-9$"])/g, "$1\n").split("\n")
    for (const piece of pieces) {
      const body = piece.replace(/^[-•]\s*/, "").trim()
      if (!body) continue
      if (body.length <= 300) {
        out.push(`- ${body}`)
        continue
      }
      // Merged blob: one sentence per bullet; tiny fragments join the previous.
      const bullets: string[] = []
      for (const sentence of body.split(SENTENCE_SPLIT_RE)) {
        const s = sentence.trim()
        if (!s) continue
        if (s.length < 60 && bullets.length) bullets[bullets.length - 1] += ` ${s}`
        else bullets.push(s)
      }
      for (const b of bullets) out.push(`- ${b}`)
    }
  }
  return out.join("\n").trim()
}

function cleanMemoText(text: string): string {
  let cleaned = text
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // Drop any preamble/memo header before the first real section heading,
  // e.g. "I'll search for..." narration or TO:/FROM:/DATE: lines. Not anchored
  // to line start because search narration can fuse onto the same line.
  const firstSection = cleaned.search(/(?:\d+\)\s*)?executive summary/i)
  if (firstSection > 0) {
    cleaned = cleaned.slice(firstSection).trim()
  }

  // Put every known section heading on its own line (handles "5) Key sources"
  // numbering and headings fused onto the end of a paragraph).
  for (const heading of MEMO_HEADINGS) {
    cleaned = cleaned.replace(
      new RegExp(`\\s*(?:\\d+\\)\\s*)?${escapeRegex(heading)}\\s*:?\\s*`, "gi"),
      `\n\n${heading}\n`
    )
  }

  return enforceBulletStructure(cleaned)
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
    output.push({ title: String(item.title || url).trim(), url })
    if (output.length >= 12) break
  }
  return output
}

export function buildFallbackMemo(sources: RetrievedSource[], reason: string): string {
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

function buildPrompt(sources: RetrievedSource[]): { system: string; user: string } {
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
    "Use your web search tool to find the most current market data — CMBS delinquency rates, special servicing volumes, foreclosure filings, note sale pipelines, and deal activity. " +
    "Supplement with the source articles provided below. Prioritize verifiable, cited facts. " +
    "Never use markdown symbols (no **, no #, no bullet dashes — use plain hyphens)."

  const user = `Write a distressed commercial real estate debt outlook memo. Use your web search tool AND the source articles below.

SCOPE: U.S. national, Florida, Miami-Dade

OUTPUT — use these exact five section headers in this order:
1) Executive Summary
2) U.S. commercial real estate outlook (CRE debt & distress)
3) Miami-specific CRE and distressed-debt outlook
4) How this shapes distressed-debt investing
5) Key sources (for further reading)

WRITING RULES:
- Start your response DIRECTLY with the text "Executive Summary" — no preamble, no memo header (no TO:/FROM:/DATE: lines), no commentary about searching.
- EVERY section must be formatted as plain hyphen bullets ("- "), INCLUDING the Executive Summary. Never write paragraphs.
- Each bullet starts on its OWN LINE with "- ".
- ONE key point per bullet. Never combine multiple facts, deals, or data points into a single bullet — split them.
- 4-8 bullets per section (except Key sources).
- Each bullet: 1-2 SHORT sentences maximum. Be concise — lead with a concrete metric, named entity, or date when available.
- Include dollar amounts, percentages, basis points, delinquency rates, loan counts, or deal sizes.
- Name specific properties, cities, lenders, borrowers, or servicers when known.
- Search for: current CMBS delinquency rates, special servicing volumes, CRE loan maturity wall data, South Florida foreclosure activity, distressed note sale transactions.
- Key sources: list 4-8 URLs, one per line, format: Title — https://url

SUPPLEMENTAL SOURCE ARTICLES:
${richContext || "No supplemental articles provided — rely on web search."}`

  return { system, user }
}

/** Generates the memo. Throws on any failure so callers can decide whether to cache. */
async function runGeneration(): Promise<string> {
  let sources: RetrievedSource[] = []
  try {
    sources = await withTimeout(retrieveSources(), 8000, "Source retrieval timed out.")
  } catch (err) {
    console.error("Industry outlook source retrieval error:", err)
  }

  const { system, user } = buildPrompt(sources)
  const raw = await callClaude({
    system,
    user,
    tier: "fast",
    maxTokens: 3200,
    temperature: 0.2,
    webSearch: true,
    maxSearches: 4,
    timeoutMs: 90_000,
  })
  const content = cleanMemoText(raw)
  if (!hasUsableContent(content)) {
    throw new Error("Claude returned insufficient content")
  }
  return content
}

/**
 * Returns today's industry outlook from cache, or generates + caches it.
 * Safe to call from both the API route and the cron warm-up directly —
 * no HTTP round-trip, no middleware interception.
 *
 * Failed generations are NEVER cached: the cached function throws on failure,
 * and the fallback memo is built fresh per request so the next request retries.
 */
export async function getCachedIndustryOutlook(): Promise<string> {
  const day = newsCalendarDayET()
  const cachedGeneration = unstable_cache(
    async () => runGeneration(),
    ["industry-outlook-shared-v8", day],
    { revalidate: NEWS_TAB_REVALIDATE_SECONDS }
  )

  try {
    if (!getClaudeApiKey()) throw new Error("Missing ANTHROPIC_API_KEY")
    return await cachedGeneration()
  } catch (err) {
    console.error("Industry outlook generation error:", err)
    let sources: RetrievedSource[] = []
    try {
      sources = await withTimeout(retrieveSources(), 8000, "Source retrieval timed out.")
    } catch {
      /* fallback proceeds without sources */
    }
    return buildFallbackMemo(
      sources,
      err instanceof Error ? err.message : "Unhandled generation error"
    )
  }
}
