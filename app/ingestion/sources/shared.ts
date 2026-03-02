import * as cheerio from "cheerio"
import type { ExtractedReport } from "@/app/ingestion/sources/types"

const REPORT_HINTS = [
  "report",
  "research",
  "publication",
  "outlook",
  "marketbeat",
  "market beat",
  "quarterly",
  "banking profile",
  "emerging trends",
]

export function genericExtractReports(html: string, baseUrl: string): ExtractedReport[] {
  const $ = cheerio.load(html)
  const out: ExtractedReport[] = []
  const seen = new Set<string>()

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim()
    if (!href) return

    let landingUrl = ""
    try {
      landingUrl = new URL(href, baseUrl).toString()
    } catch {
      return
    }

    const title = ($(el).text() || "").replace(/\s+/g, " ").trim()
    const candidateText = `${title} ${landingUrl}`.toLowerCase()
    const looksLikeResearch = REPORT_HINTS.some((h) => candidateText.includes(h))
    if (!looksLikeResearch) return
    if (!title || title.length < 4) return
    if (seen.has(landingUrl)) return

    const contextText = ($(el).closest("li,article,div,section").text() || "").replace(/\s+/g, " ")
    const dateMatch = contextText.match(/\b(?:20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i)

    seen.add(landingUrl)
    out.push({
      title,
      landingUrl,
      publishedDate: dateMatch?.[0],
    })
  })

  return out.slice(0, 30)
}
