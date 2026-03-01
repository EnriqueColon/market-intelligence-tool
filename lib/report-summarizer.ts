/**
 * Summarizes extracted report text using Perplexity (or OpenAI) API.
 */

export type ReportSummary = {
  summary: string
  bullets: string[]
}

function extractJsonObject(text: string): string | undefined {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : undefined
}

async function callPerplexity(prompt: string): Promise<ReportSummary | null> {
  const API_KEY = process.env.PERPLEXITY_API_KEY?.trim()
  if (!API_KEY) return null

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
          content: "You are a commercial real estate analyst. Respond with valid JSON only. Do not invent facts.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
    }),
    cache: "no-store",
  })

  if (!response.ok) return null

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== "string" || !content.trim()) return null

  const jsonText = extractJsonObject(content)
  if (!jsonText) return null

  try {
    const parsed = JSON.parse(jsonText)
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : ""
    const bullets = Array.isArray(parsed?.bullets)
      ? parsed.bullets.filter((b: unknown) => typeof b === "string").map((b: string) => b.trim()).filter(Boolean)
      : []
    if (summary || bullets.length > 0) {
      return { summary: summary || bullets[0] || "", bullets }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Summarize extracted report text into executive summary + bullets.
 */
export async function summarizeReportText(
  text: string,
  reportTitle: string,
  reportSource: string
): Promise<ReportSummary | null> {
  const clipped = text.length > 40_000 ? text.slice(0, 40_000) + "\n\n[Content truncated...]" : text

  const prompt = `Summarize this commercial real estate report in 3-5 bullet points. Focus on key rankings, outlook, and actionable insights. Max 300 words for the summary.

Report: ${reportTitle}
Source: ${reportSource}

EXTRACTED TEXT:
${clipped}

Return JSON with EXACT keys:
{
  "summary": "2-4 sentence executive summary",
  "bullets": ["bullet 1", "bullet 2", "bullet 3", "bullet 4", "bullet 5"]
}`

  return callPerplexity(prompt)
}
