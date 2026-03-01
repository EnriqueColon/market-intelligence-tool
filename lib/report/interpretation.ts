/**
 * OpenAI interpretation for report visualizations.
 * Server-side only. Produces investment-committee grade interpretation.
 */

export type InterpretationPayload = {
  vizType: string
  scope: string
  asOfQuarter: string
  stats: Record<string, unknown>
}

export type InterpretationResult = {
  headline: string
  bullets: string[]
  paragraph: string
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const interpretationCache = new Map<string, { result: InterpretationResult; expires: number }>()

function cacheKey(payload: InterpretationPayload): string {
  return `interpretation:${payload.scope}:${payload.asOfQuarter}:${payload.vizType}:${JSON.stringify(payload.stats)}`
}

function getCached(key: string): InterpretationResult | null {
  const entry = interpretationCache.get(key)
  if (!entry || Date.now() > entry.expires) return null
  return entry.result
}

function setCache(key: string, result: InterpretationResult): void {
  interpretationCache.set(key, { result, expires: Date.now() + CACHE_TTL_MS })
}

export async function generateInterpretation(
  payload: InterpretationPayload
): Promise<InterpretationResult> {
  const key = cacheKey(payload)
  const cached = getCached(key)
  if (cached) return cached

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      headline: "Data summary available.",
      bullets: ["Metrics derived from FDIC call reports.", "Values are cohort-relative.", "Source: FDIC (latest quarter)."],
      paragraph: "This visualization presents FDIC-derived metrics for the selected scope. Interpretation is descriptive and based solely on the provided data.",
    }
  }

  const systemPrompt = `You are an institutional research analyst. Generate a brief, neutral interpretation of a bank screening visualization for an investment committee. Use ONLY the provided metrics. No forecasting. No invented data. Tone: analytical, professional. Output valid JSON only.`

  const userPrompt = `Visualization: ${payload.vizType}
Scope: ${payload.scope}
As of: ${payload.asOfQuarter}
Key stats (use these numbers only):
${JSON.stringify(payload.stats, null, 2)}

Return JSON with exactly:
{
  "headline": "string (max 12 words)",
  "bullets": ["string", "string", "string"] (3-5 bullets),
  "paragraph": "string (2-4 sentences)"
}`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`OpenAI API error: ${res.status} ${err}`)
      }
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content?.trim()
      if (!content) throw new Error("Empty response")

      const parsed = JSON.parse(content) as InterpretationResult
      if (!parsed.headline || !Array.isArray(parsed.bullets) || !parsed.paragraph) {
        throw new Error("Invalid structure")
      }
      const result: InterpretationResult = {
        headline: String(parsed.headline).slice(0, 120),
        bullets: (parsed.bullets as string[]).slice(0, 5).map((b) => String(b).slice(0, 200)),
        paragraph: String(parsed.paragraph).slice(0, 600),
      }
      setCache(key, result)
      return result
    } catch (err) {
      if (attempt === 1) {
        return {
          headline: `${payload.vizType} — FDIC cohort metrics`,
          bullets: ["Data from FDIC call reports.", "Values are relative to the selected scope.", "Latest available quarter."],
          paragraph: `This section presents ${payload.vizType} for ${payload.scope} as of ${payload.asOfQuarter}. Metrics are derived from FDIC regulatory filings.`,
        }
      }
    }
  }
  return {
    headline: "Data summary",
    bullets: ["FDIC-derived metrics."],
    paragraph: "Metrics from FDIC call reports.",
  }
}
