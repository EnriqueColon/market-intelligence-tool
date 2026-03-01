"use server"

import { findPdfUrl } from "@/lib/report-scraper"

export type GetReportPdfUrlResult =
  | { ok: true; pdfUrl: string }
  | { ok: false; error?: string }

/**
 * Get a direct PDF URL for a report. Uses manual override if provided, otherwise
 * fetches the page and detects PDF links.
 */
export async function getReportPdfUrl(
  url: string,
  pdfUrlOverride?: string
): Promise<GetReportPdfUrlResult> {
  if (pdfUrlOverride?.trim()) {
    return { ok: true, pdfUrl: pdfUrlOverride.trim() }
  }

  if (!url?.trim()) {
    return { ok: false, error: "No report URL provided" }
  }

  try {
    const pdfUrl = await findPdfUrl(url.trim())
    if (pdfUrl) {
      return { ok: true, pdfUrl }
    }
    return { ok: false, error: "No direct PDF available. Use Link to Source to access the report." }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
