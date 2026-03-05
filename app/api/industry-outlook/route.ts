import { NextResponse } from "next/server"
export const runtime = "nodejs"

const PROMPT = `I would like the current and projected industry outlook for the commercial real estate sector for Miami, Florida, and the US level as it pertains to investing in distressed debt. Provide sources.
Time window: recent and current conditions.
Topic scope (national): distressed COMMERCIAL REAL ESTATE DEBT (CMBS stress, special servicing, delinquencies/defaults, refinancing stress, note/loan sales, workouts, receiverships, foreclosures).
Topic scope (Florida/Miami): use Florida/Miami-specific sources. If thin, include regional CRE signals tied to debt stress.
Tone: professional, concise, investment-committee memo. No casual language. No markdown headings. No extra commentary.

Return a single plain-text memo in this structure using bullet points for each section:
1) A short executive summary comparing U.S. vs Miami/Florida (2–4 bullets).
2) “U.S. commercial real estate outlook (CRE debt & distress)” section with 3–6 bullets.
3) “Miami-specific CRE and distressed-debt outlook” section with 3–6 bullets.
4) “How this shapes distressed-debt investing” section with 3–6 bullets.
5) “Key sources (for further reading)” section with 5–10 lines, each line: Title — https://url.
No JSON. No markdown.`

type CacheEntry = {
  text: string
  fetchedAt: number
}

const CACHE_TTL_MS = 2 * 60 * 60 * 1000
let cached: CacheEntry | null = null

function isFresh(entry: CacheEntry | null) {
  if (!entry) return false
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS
}

function normalizeOutput(text: string) {
  const startIdx = text.indexOf("Key themes")
  if (startIdx === -1) return text.trim()
  const trimmed = text.slice(startIdx).trim()
  return trimmed
}

async function generateOutlook(apiKey: string, prompt: string, strict = false) {
  const system = strict
    ? "Output ONLY the requested memo. No markdown headings. Do not mention search results or limitations. Keep it professional."
    : "Output ONLY the requested memo. No extra text, no apologies, no mention of search results or limitations."
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_OUTLOOK_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: system,
        },
        { role: "user", content: prompt },
      ],
    }),
  })

  if (!response.ok) return ""
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return json.choices?.[0]?.message?.content?.trim() || ""
}

export async function POST() {
  // Avoid cross-request state assumptions in serverless runtime.
  // In-memory cache is used only for local/self-hosted Node processes.
  const allowMemoryCache = process.env.VERCEL !== "1"
  if (allowMemoryCache && isFresh(cached)) {
    return NextResponse.json({ text: cached?.text })
  }

  // Required in production: OPENAI_API_KEY
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    console.error("Industry outlook API error: missing OPENAI_API_KEY")
    return NextResponse.json({ text: "" }, { status: 500 })
  }

  const content = await generateOutlook(apiKey, PROMPT, false)
  if (!content) {
    console.error("Industry outlook API error: empty provider response")
    return NextResponse.json({ text: "" }, { status: 500 })
  }

  let normalized = normalizeOutput(content)
  if (!normalized) {
    const retry = await generateOutlook(apiKey, PROMPT, true)
    if (retry) normalized = normalizeOutput(retry)
  }
  if (allowMemoryCache) {
    cached = { text: normalized, fetchedAt: Date.now() }
  }
  return NextResponse.json({ text: normalized })
}
