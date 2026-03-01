/**
 * Resolves document content from URL: PDF download + extract, or HTML fetch + PDF discovery, or page text.
 * Used by summarize-found-report action.
 */

import { scrapeReport } from "./report-scraper"

export type ResolvedDocument = {
  text: string
  source: "pdf" | "page"
  finalUrl: string
} | {
  text: ""
  source: "failed"
  finalUrl: string
  error: string
}

/**
 * Resolve document content from URL.
 * - If PDF => download and extract text
 * - Else fetch HTML and attempt to discover PDF link
 * - Else extract readable page text
 */
export async function resolveDocument(url: string): Promise<ResolvedDocument> {
  const result = await scrapeReport(url, { lightweightOnly: true })

  if (result.source === "failed") {
    return {
      text: "",
      source: "failed",
      finalUrl: url,
      error: result.error || "Could not extract content",
    }
  }

  return {
    text: result.text,
    source: result.source,
    finalUrl: url,
  }
}
