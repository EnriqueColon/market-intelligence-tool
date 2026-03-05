import { NextResponse } from "next/server"
export const runtime = "nodejs"

const PROMPT = `I need a data-forward industry outlook for distressed commercial real estate debt focused on U.S., Florida, and Miami.
Audience: investment committee evaluating distressed-debt acquisitions.

Hard requirements:
- Use RECENT data (prefer last 3-12 months) and include explicit period labels (e.g., Q4 2025, Jan 2026).
- Prioritize quantified facts, not general commentary.
- In each main section, include at least 4 numeric data points with units/percentages where possible.
- Cover debt stress metrics: CMBS delinquency/default trend, special servicing trend, refinance maturity wall pressure, loan origination/liquidity conditions, pricing/spread direction, and transaction distress signals (workouts, note sales, foreclosures/receiverships where available).
- For Miami/Florida, include local/regional evidence first; if sparse, explicitly label any proxy/regional substitution.
- Every bullet should be 1-2 sentences max and include concrete figures when available.
- No markdown. No JSON. Plain text only.

Return a single plain-text memo in EXACT structure:
1) Executive Summary (U.S. vs Florida/Miami) - 3-5 bullets.
2) U.S. commercial real estate outlook (CRE debt & distress) - 5-8 bullets, data-heavy.
3) Miami-specific CRE and distressed-debt outlook - 5-8 bullets, data-heavy.
4) How this shapes distressed-debt investing - 4-7 bullets with actionable implications tied to the cited data.
5) Key sources (for further reading) - 8-15 lines. Format each line exactly:
   Title — https://url
`

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
