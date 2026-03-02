"use server"

import { createHash } from "crypto"
import { reportIdFromUrl } from "@/lib/report-id"
import { isDbEnabled, sql } from "@/lib/db"
import { getAllSummaries, getSummaryByHash } from "@/lib/market-research-memory"

export type ReportSummaryEntry = {
  reportId: string
  summary: string
  bullets: string[]
  executiveSummary?: string
  keyTakeaways?: string[]
  notableStats?: string[]
  risks?: string[]
  opportunities?: string[]
  whatToWatch_30_90?: string[]
  metadata?: {
    producer?: string
    source?: string
    title: string
    landingUrl: string
    documentUrl: string
    documentType: "pdf" | "html"
    summarizedAt: string
    warning?: string
    publishedDate?: string
  }
  lastFetched: string
  source: "pdf" | "page" | "failed"
  error: string | null
}

export type ReportSummariesMap = Record<string, ReportSummaryEntry>

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex")
}

export async function fetchReportSummaries(): Promise<ReportSummariesMap> {
  if (isDbEnabled()) {
    try {
      const rows = await sql<{
        landing_url: string
        summary_json: any
        updated_at: string
      }>`
        SELECT rr.landing_url, rs.summary_json, rs.updated_at
        FROM research_summaries rs
        JOIN research_reports rr ON rr.id = rs.report_id
        ORDER BY rs.updated_at DESC
      `
      const out: ReportSummariesMap = {}
      for (const row of rows.rows) {
        const id = reportIdFromUrl(row.landing_url)
        const data = row.summary_json ?? {}
        const entry: ReportSummaryEntry = {
          reportId: id,
          summary: data.executiveSummary ?? "",
          bullets: data.keyTakeaways ?? [],
          executiveSummary: data.executiveSummary ?? "",
          keyTakeaways: data.keyTakeaways ?? [],
          notableStats: data.notableStats ?? [],
          risks: data.risks ?? [],
          opportunities: data.opportunities ?? [],
          whatToWatch_30_90: data.whatToWatch_30_90 ?? [],
          metadata: data.metadata,
          lastFetched: row.updated_at,
          source: data.metadata?.documentType === "pdf" ? "pdf" : "page",
          error: null,
        }
        out[id] = entry
      }
      return out
    } catch (err) {
      console.error("[fetch-report-summaries] DB read failed:", err)
      return {}
    }
  }

  if (process.env.NODE_ENV === "production") return {}
  return getAllSummaries()
}

export { reportIdFromUrl }

/** Get cached summary for a URL if it exists. */
export async function getSummaryForUrl(url: string): Promise<ReportSummaryEntry | null> {
  if (isDbEnabled()) {
    try {
      const hash = urlHash(url)
      const rows = await sql<{
        summary_json: any
        updated_at: string
      }>`
        SELECT rs.summary_json, rs.updated_at
        FROM research_summaries rs
        JOIN research_reports rr ON rr.id = rs.report_id
        WHERE rr.url_hash = ${hash}
        LIMIT 1
      `
      const row = rows.rows[0]
      if (!row) return null
      const data = row.summary_json ?? {}
      return {
        reportId: reportIdFromUrl(url),
        summary: data.executiveSummary ?? "",
        bullets: data.keyTakeaways ?? [],
        executiveSummary: data.executiveSummary ?? "",
        keyTakeaways: data.keyTakeaways ?? [],
        notableStats: data.notableStats ?? [],
        risks: data.risks ?? [],
        opportunities: data.opportunities ?? [],
        whatToWatch_30_90: data.whatToWatch_30_90 ?? [],
        metadata: data.metadata,
        lastFetched: row.updated_at,
        source: data.metadata?.documentType === "pdf" ? "pdf" : "page",
        error: null,
      }
    } catch (err) {
      console.error("[fetch-report-summaries] DB getSummaryForUrl failed:", err)
      return null
    }
  }
  if (process.env.NODE_ENV === "production") return null
  return getSummaryByHash(urlHash(url))
}

/** Get cached summaries for multiple URLs. Returns map of url -> entry for those that exist. */
export async function getSummariesForUrls(
  urls: string[]
): Promise<Record<string, ReportSummaryEntry>> {
  const out: Record<string, ReportSummaryEntry> = {}

  if (isDbEnabled()) {
    try {
      for (const url of urls) {
        const hash = urlHash(url)
        const rows = await sql<{
          summary_json: any
          updated_at: string
        }>`
          SELECT rs.summary_json, rs.updated_at
          FROM research_summaries rs
          JOIN research_reports rr ON rr.id = rs.report_id
          WHERE rr.url_hash = ${hash}
          LIMIT 1
        `
        const row = rows.rows[0]
        if (!row) continue
        const data = row.summary_json ?? {}
        out[url] = {
          reportId: reportIdFromUrl(url),
          summary: data.executiveSummary ?? "",
          bullets: data.keyTakeaways ?? [],
          executiveSummary: data.executiveSummary ?? "",
          keyTakeaways: data.keyTakeaways ?? [],
          notableStats: data.notableStats ?? [],
          risks: data.risks ?? [],
          opportunities: data.opportunities ?? [],
          whatToWatch_30_90: data.whatToWatch_30_90 ?? [],
          metadata: data.metadata,
          lastFetched: row.updated_at,
          source: data.metadata?.documentType === "pdf" ? "pdf" : "page",
          error: null,
        }
      }
      return out
    } catch (err) {
      console.error("[fetch-report-summaries] DB getSummariesForUrls failed:", err)
      return out
    }
  }

  if (process.env.NODE_ENV === "production") return out
  for (const url of urls) {
    const entry = getSummaryByHash(urlHash(url))
    if (entry) out[url] = entry
  }
  return out
}
