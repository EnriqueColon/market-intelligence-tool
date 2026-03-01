"use server"

export type PublicMentionSummary = {
  title: string
  source?: string
  date?: string
  url?: string
  executiveSummary: string
  keyBullets: string[]
  whyItMatters: string[]
  entities: string[]
  redFlags: string[]
  followUps: string[]
  confidence: number
  generatedAt: string
  notes?: string[]
}

type MentionInput = {
  title: string
  source?: string
  date?: string
  url?: string
  snippet?: string
}

function asStringArray(value: unknown, max = 10): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const cleaned = item.replace(/^\s*[-•]\s*/g, "").trim()
    if (!cleaned) continue
    out.push(cleaned)
    if (out.length >= max) break
  }
  return out
}

function clampNumber(n: unknown, lo: number, hi: number, fallback: number) {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN
  if (Number.isNaN(v)) return fallback
  return Math.max(lo, Math.min(hi, v))
}

function buildFallback(input: MentionInput, notes?: string[]): PublicMentionSummary {
  const title = (input.title || "Untitled").trim()
  const source = input.source?.trim()
  const date = input.date?.trim()
  const url = input.url?.trim()
  const snippet = input.snippet?.trim()

  if (!process.env.PERPLEXITY_API_KEY) {
    notes?.push("PERPLEXITY_API_KEY not found; using fallback summary.")
  } else {
    notes?.push("Using fallback summary (AI unavailable or parse failed).")
  }

  const headline = title.replace(/\s+/g, " ").trim()
  const summaryBase = snippet ? `${headline} — ${snippet}` : headline

  return {
    title,
    source,
    date,
    url,
    executiveSummary: summaryBase.slice(0, 320),
    keyBullets: [
      snippet ? "This summary is based on the RSS snippet + headline." : "This summary is based on the headline only.",
      source ? `Source: ${source}.` : "Source not provided in the RSS item.",
      date ? `Date: ${date}.` : "Date not provided in the RSS item.",
    ],
    whyItMatters: [
      "If this mention involves distressed CRE debt activity, it may signal active pricing, bid appetite, or lender behavior shifts.",
      "Use the article to confirm facts (asset type, location, counterparties) before acting on it.",
    ],
    entities: [],
    redFlags: [
      "Article may be paywalled or the RSS snippet may omit key context.",
      "Headline-only inference can be incomplete; validate by opening the link.",
    ],
    followUps: [
      "What asset type, geography, and transaction size are mentioned?",
      "Which firms are explicitly named as buyers/sellers/servicers?",
      "Is the event a single sale or part of a broader portfolio/strategy?",
    ],
    confidence: snippet ? 45 : 25,
    generatedAt: new Date().toISOString(),
    notes,
  }
}

function extractJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : undefined
}

export async function summarizePublicMention(input: MentionInput): Promise<PublicMentionSummary> {
  const notes: string[] = []
  const title = (input.title || "").trim()
  if (!title) return buildFallback({ ...input, title: "Untitled" }, notes)

  const API_KEY = process.env.PERPLEXITY_API_KEY?.trim()
  if (!API_KEY) {
    return buildFallback(input, notes)
  }

  const sourceLine = input.source ? `Source: ${input.source}` : ""
  const dateLine = input.date ? `Date: ${input.date}` : ""
  const urlLine = input.url ? `URL: ${input.url}` : ""
  const snippetLine = input.snippet ? `RSS snippet: ${input.snippet}` : ""

  const prompt = `You are a meticulous market intelligence analyst focused on distressed commercial real estate debt and related counterparties.

Summarize this public news mention into a "bullet-proof" briefing:
- Use the article URL if you can access it. If the URL is not accessible or paywalled, use best-effort from the headline + RSS snippet.
- Do NOT invent facts. If uncertain, say so in redFlags and lower confidence.
- Prefer concrete facts: asset type, geography, dollar amounts, named firms, and what actually happened.
- Output MUST be valid JSON matching the schema below.

Mention:
Title: ${title}
${sourceLine}
${dateLine}
${urlLine}
${snippetLine}

Return JSON with EXACT keys:
{
  "executiveSummary": "2-4 sentences, plain English, no hype",
  "keyBullets": ["... up to 8 bullets ..."],
  "whyItMatters": ["... up to 6 bullets ..."],
  "entities": ["... named entities (firms/people/agencies) if present ..."],
  "redFlags": ["... uncertainties, missing info, paywall limits ..."],
  "followUps": ["... concrete questions to validate/act ..."],
  "confidence": 0-100
}`

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a careful analyst. Always respond with valid JSON only, matching the requested schema.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1100,
      }),
      next: { revalidate: 86400 },
    })

    if (!response.ok) {
      notes.push(`Perplexity API error: ${response.status} ${response.statusText}`)
      return buildFallback(input, notes)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      notes.push("No content in Perplexity response.")
      return buildFallback(input, notes)
    }

    const jsonText = extractJsonObject(content)
    if (!jsonText) {
      notes.push("Could not find JSON object in Perplexity response.")
      return buildFallback(input, notes)
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      notes.push("Failed to parse JSON from Perplexity response.")
      return buildFallback(input, notes)
    }

    const executiveSummary =
      typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim()
        ? parsed.executiveSummary.trim()
        : buildFallback(input).executiveSummary

    const summary: PublicMentionSummary = {
      title: input.title,
      source: input.source,
      date: input.date,
      url: input.url,
      executiveSummary,
      keyBullets: asStringArray(parsed.keyBullets, 8),
      whyItMatters: asStringArray(parsed.whyItMatters, 6),
      entities: asStringArray(parsed.entities, 12),
      redFlags: asStringArray(parsed.redFlags, 8),
      followUps: asStringArray(parsed.followUps, 8),
      confidence: clampNumber(parsed.confidence, 0, 100, input.snippet ? 55 : 45),
      generatedAt: new Date().toISOString(),
      notes,
    }

    // Ensure minimum content even if model returns empty arrays.
    if (summary.keyBullets.length === 0) summary.keyBullets = buildFallback(input).keyBullets
    if (summary.whyItMatters.length === 0) summary.whyItMatters = buildFallback(input).whyItMatters
    if (summary.redFlags.length === 0) summary.redFlags = buildFallback(input).redFlags
    if (summary.followUps.length === 0) summary.followUps = buildFallback(input).followUps

    return summary
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
    notes.push(`Summarization failed: ${message}`)
    return buildFallback(input, notes)
  }
}

