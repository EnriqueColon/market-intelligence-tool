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

type OutlookMemoJson = {
  executiveSummary: string[]
  usOutlook: string[]
  miamiOutlook: string[]
  investingImplications: string[]
  sources: Array<{ title: string; url: string }>
}

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

function parseJsonObject<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}

function hasAtLeastNDataBullets(lines: string[], minCount: number): boolean {
  const count = lines.filter((line) => /\d/.test(line)).length
  return count >= minCount
}

function validateMemoJson(obj: OutlookMemoJson): string | null {
  if (!Array.isArray(obj.executiveSummary) || obj.executiveSummary.length < 3) {
    return "Missing executive summary bullets."
  }
  if (!Array.isArray(obj.usOutlook) || obj.usOutlook.length < 5) {
    return "Missing U.S. outlook depth."
  }
  if (!Array.isArray(obj.miamiOutlook) || obj.miamiOutlook.length < 5) {
    return "Missing Miami outlook depth."
  }
  if (!Array.isArray(obj.investingImplications) || obj.investingImplications.length < 4) {
    return "Missing investing implications depth."
  }
  if (!Array.isArray(obj.sources) || obj.sources.length < 6) {
    return "Insufficient sources."
  }
  if (!hasAtLeastNDataBullets(obj.usOutlook, 3)) {
    return "U.S. section is not data-forward enough."
  }
  if (!hasAtLeastNDataBullets(obj.miamiOutlook, 3)) {
    return "Miami section is not data-forward enough."
  }
  return null
}

function asBulletList(lines: string[]): string {
  return lines.map((line) => `- ${String(line || "").trim()}`).join("\n")
}

function normalizeSources(
  requested: Array<{ title: string; url: string }>,
  fallback: RetrievedSource[]
): Array<{ title: string; url: string }> {
  const valid = (requested || []).filter(
    (s) =>
      s &&
      typeof s.title === "string" &&
      typeof s.url === "string" &&
      /^https?:\/\//i.test(s.url)
  )
  const seen = new Set<string>()
  const output: Array<{ title: string; url: string }> = []
  for (const item of valid) {
    const key = item.url.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push({ title: item.title.trim() || item.url.trim(), url: item.url.trim() })
    if (output.length >= 15) return output
  }
  for (const item of fallback) {
    const key = item.url.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push({ title: item.title.trim() || item.url.trim(), url: item.url.trim() })
    if (output.length >= 15) break
  }
  return output
}

function renderMemoText(obj: OutlookMemoJson): string {
  const lines: string[] = []
  lines.push("Executive Summary")
  lines.push(asBulletList(obj.executiveSummary))
  lines.push("")
  lines.push("U.S. commercial real estate outlook (CRE debt & distress)")
  lines.push(asBulletList(obj.usOutlook))
  lines.push("")
  lines.push("Miami-specific CRE and distressed-debt outlook")
  lines.push(asBulletList(obj.miamiOutlook))
  lines.push("")
  lines.push("How this shapes distressed-debt investing")
  lines.push(asBulletList(obj.investingImplications))
  lines.push("")
  lines.push("Key sources (for further reading)")
  for (const src of obj.sources) {
    lines.push(`${src.title} — ${src.url}`)
  }
  return lines.join("\n").trim()
}

function buildFallbackMemo(
  sources: RetrievedSource[],
  reason: string
): string {
  const limitedSources = normalizeSources([], sources).slice(0, 10)
  const srcLines =
    limitedSources.length > 0
      ? limitedSources.map((s) => `${s.title} — ${s.url}`)
      : ["No verified sources were available from the retrieval pipeline."]

  return [
    "Executive Summary",
    "- We could not complete the full data-validated outlook in this run.",
    `- Reason: ${reason}.`,
    "- A provisional update is provided below using currently retrieved signals.",
    "",
    "U.S. commercial real estate outlook (CRE debt & distress)",
    "- Current run did not pass strict data-density validation for U.S. metrics.",
    "- Re-run is recommended to retrieve additional verified debt-stress datapoints.",
    "",
    "Miami-specific CRE and distressed-debt outlook",
    "- Current run did not pass strict data-density validation for Miami/Florida metrics.",
    "- Re-run is recommended to retrieve additional local/regional datapoints.",
    "",
    "How this shapes distressed-debt investing",
    "- Treat this output as provisional and prioritize direct review of linked sources.",
    "- Focus diligence on delinquency trends, special servicing, and refinance pressure updates.",
    "",
    "Key sources (for further reading)",
    ...srcLines,
  ].join("\n")
}

async function generateMemoJson(
  apiKey: string,
  sources: RetrievedSource[],
  strictRetry: boolean
): Promise<OutlookMemoJson | null> {
  const sourceContext = JSON.stringify(
    sources.map((s) => ({
      title: s.title,
      url: s.url,
      region: s.region,
      publisher: s.publisher,
      date: s.date,
      snippet: s.snippet,
    })),
    null,
    2
  )

  const system = strictRetry
    ? "Return ONLY valid JSON. No markdown, no prose outside JSON, no missing fields."
    : "Return ONLY valid JSON. No markdown."

  const user = `Create a data-forward investment-committee outlook for distressed CRE debt.
Use ONLY facts supported by SOURCES_CONTEXT. Do not fabricate numbers.
Use recent data and include explicit period labels where available.

Return JSON with EXACT shape:
{
  "executiveSummary": ["3-5 bullets"],
  "usOutlook": ["5-8 data-heavy bullets"],
  "miamiOutlook": ["5-8 data-heavy bullets (Florida/Miami)"],
  "investingImplications": ["4-7 actionable bullets"],
  "sources": [{"title":"...","url":"https://..."}]
}

Rules:
- Each bullet max 2 sentences.
- U.S. and Miami sections must each include multiple numeric bullets (rates, %, $, bps, counts).
- Include CMBS delinquency/special servicing/refinance pressure/liquidity/pricing-distress signals when supported.
- If Miami data is thin, state that explicitly and use Florida/regional proxy evidence.
- Sources should be specific URLs from context, not generic homepages.

SOURCES_CONTEXT:
${sourceContext}`

  try {
    const response = await withTimeout(
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_OUTLOOK_MODEL?.trim() || "gpt-4o-mini",
          temperature: 0.1,
          response_format: { type: "json_object" },
          max_tokens: 1800,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        cache: "no-store",
      }),
      25000,
      "Industry outlook generation timed out."
    )

    if (!response.ok) return null
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content?.trim() || ""
    const parsed = parseJsonObject<OutlookMemoJson>(content)
    if (!parsed) return null
    return parsed
  } catch (err) {
    console.error("Industry outlook generation error:", err)
    return null
  }
}

async function generateOutlookText(apiKey: string): Promise<string> {
  const retrieved = await retrieveSources()
  if (retrieved.length < 2) {
    return buildFallbackMemo(retrieved, "Insufficient retrieved sources")
  }

  const first = await generateMemoJson(apiKey, retrieved, false)
  const second = first ? null : await generateMemoJson(apiKey, retrieved, true)
  const draft = first || second
  if (!draft) {
    return buildFallbackMemo(retrieved, "Model generation returned no usable JSON")
  }

  const normalized: OutlookMemoJson = {
    executiveSummary: Array.isArray(draft.executiveSummary) ? draft.executiveSummary : [],
    usOutlook: Array.isArray(draft.usOutlook) ? draft.usOutlook : [],
    miamiOutlook: Array.isArray(draft.miamiOutlook) ? draft.miamiOutlook : [],
    investingImplications: Array.isArray(draft.investingImplications)
      ? draft.investingImplications
      : [],
    sources: normalizeSources(Array.isArray(draft.sources) ? draft.sources : [], retrieved),
  }

  const validationError = validateMemoJson(normalized)
  if (validationError) {
    console.error("Industry outlook validation failed:", validationError)
    return buildFallbackMemo(retrieved, validationError)
  }

  return renderMemoText(normalized)
}

export async function POST() {
  // Avoid cross-request state assumptions in serverless runtime.
  // In-memory cache is used only for local/self-hosted Node processes.
  const allowMemoryCache = process.env.VERCEL !== "1"
  if (allowMemoryCache && isFresh(cached)) {
    return NextResponse.json({ text: cached?.text })
  }

  try {
    // Required in production: OPENAI_API_KEY
    const apiKey = process.env.OPENAI_API_KEY?.trim()
    if (!apiKey) {
      console.error("Industry outlook API error: missing OPENAI_API_KEY")
      const text = buildFallbackMemo([], "Missing OPENAI_API_KEY")
      return NextResponse.json({ text }, { status: 200 })
    }

    const content = await withTimeout(
      generateOutlookText(apiKey),
      50000,
      "Industry outlook generation exceeded time budget."
    )
    if (!content) {
      console.error("Industry outlook API error: could not produce validated data-forward memo")
      const text = buildFallbackMemo([], "No usable output from provider")
      return NextResponse.json({ text }, { status: 200 })
    }

    if (allowMemoryCache) {
      cached = { text: content, fetchedAt: Date.now() }
    }
    return NextResponse.json({ text: content })
  } catch (err) {
    console.error("Industry outlook API unhandled error:", err)
    const text = buildFallbackMemo([], "Unhandled generation error")
    return NextResponse.json({ text }, { status: 200 })
  }
}
