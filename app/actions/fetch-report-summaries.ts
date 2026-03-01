"use server"

import * as fs from "fs/promises"
import * as path from "path"
import { reportIdFromUrl } from "@/lib/report-id"

export type ReportSummaryEntry = {
  reportId: string
  summary: string
  bullets: string[]
  lastFetched: string
  source: "pdf" | "page" | "failed"
  error: string | null
}

export type ReportSummariesMap = Record<string, ReportSummaryEntry>

const SUMMARIES_PATH = path.join(process.cwd(), "data", "report-summaries.json")

export async function fetchReportSummaries(): Promise<ReportSummariesMap> {
  try {
    const raw = await fs.readFile(SUMMARIES_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as ReportSummariesMap
    }
  } catch {
    // File may not exist yet
  }
  return {}
}

export { reportIdFromUrl }

/** Get cached summary for a URL if it exists. */
export async function getSummaryForUrl(url: string): Promise<ReportSummaryEntry | null> {
  const summaries = await fetchReportSummaries()
  const id = reportIdFromUrl(url)
  return summaries[id] ?? null
}

/** Get cached summaries for multiple URLs. Returns map of url -> entry for those that exist. */
export async function getSummariesForUrls(
  urls: string[]
): Promise<Record<string, ReportSummaryEntry>> {
  const summaries = await fetchReportSummaries()
  const out: Record<string, ReportSummaryEntry> = {}
  for (const url of urls) {
    const id = reportIdFromUrl(url)
    const entry = summaries[id]
    if (entry) out[url] = entry
  }
  return out
}
