"use server"

import { isDbEnabled, sql } from "@/lib/db"
import { resolveDocument } from "@/lib/document-resolver"
import { summarizeReportText } from "@/lib/report-summarizer"
import { runInstitutionalResearchIngestion } from "@/app/ingestion/run-ingestion"

export type ResearchFeedRow = {
  id: number
  producer: string
  title: string
  landingUrl: string
  documentUrl: string
  documentType: "pdf" | "html"
  publishedDate: string | null
  discoveredAt: string
  tags: {
    assetType?: string
    geography?: string
    topics?: string[]
  } | null
  isSummarized: boolean
}

export async function fetchInstitutionalResearchFeed(params?: {
  producer?: string
  assetType?: string
  geography?: string
  days?: 7 | 30 | 90
}): Promise<{ ok: true; reports: ResearchFeedRow[] } | { ok: false; error: string }> {
  if (!isDbEnabled()) {
    return { ok: false, error: "POSTGRES_URL is not configured." }
  }

  const producer = params?.producer?.trim()
  const assetType = params?.assetType?.trim()
  const geography = params?.geography?.trim()
  const days = params?.days ?? 30

  try {
    const rows = await sql<{
      id: number
      producer: string
      title: string
      landing_url: string
      document_url: string
      document_type: "pdf" | "html"
      published_date: string | null
      discovered_at: string
      tags: any
      summary_report_id: number | null
    }>`
      SELECT
        rr.id,
        rr.producer,
        rr.title,
        rr.landing_url,
        rr.document_url,
        rr.document_type,
        rr.published_date::text,
        rr.discovered_at::text,
        rr.tags,
        rs.report_id AS summary_report_id
      FROM research_reports rr
      LEFT JOIN research_summaries rs ON rs.report_id = rr.id
      WHERE
        (${producer ?? null}::text IS NULL OR rr.producer = ${producer ?? null})
        AND (${assetType ?? null}::text IS NULL OR rr.tags->>'assetType' = ${assetType ?? null})
        AND (${geography ?? null}::text IS NULL OR rr.tags->>'geography' = ${geography ?? null})
        AND rr.discovered_at >= now() - (${days}::text || ' days')::interval
      ORDER BY COALESCE(rr.published_date::timestamp, rr.discovered_at) DESC
      LIMIT 250
    `

    return {
      ok: true,
      reports: rows.rows.map((r) => ({
        id: r.id,
        producer: r.producer,
        title: r.title,
        landingUrl: r.landing_url,
        documentUrl: r.document_url,
        documentType: r.document_type,
        publishedDate: r.published_date,
        discoveredAt: r.discovered_at,
        tags: r.tags ?? null,
        isSummarized: Boolean(r.summary_report_id),
      })),
    }
  } catch (err) {
    console.error("[research-feed] Fetch failed:", err)
    return { ok: false, error: "Failed to fetch institutional research feed." }
  }
}

export async function fetchResearchSummaryByReportId(reportId: number): Promise<{
  ok: boolean
  summary?: any
  error?: string
}> {
  if (!isDbEnabled()) return { ok: false, error: "POSTGRES_URL is not configured." }
  try {
    const rows = await sql<{ summary_json: any }>`
      SELECT summary_json
      FROM research_summaries
      WHERE report_id = ${reportId}
      LIMIT 1
    `
    if (!rows.rows[0]) return { ok: false, error: "No summary found." }
    return { ok: true, summary: rows.rows[0].summary_json }
  } catch (err) {
    console.error("[research-feed] Fetch summary failed:", err)
    return { ok: false, error: "Failed to fetch summary." }
  }
}

export async function summarizeResearchReportById(reportId: number): Promise<{
  ok: boolean
  error?: string
}> {
  if (!isDbEnabled()) return { ok: false, error: "POSTGRES_URL is not configured." }

  try {
    const reportRows = await sql<{
      id: number
      producer: string
      title: string
      landing_url: string
      document_url: string
      document_type: "pdf" | "html"
      published_date: string | null
    }>`
      SELECT id, producer, title, landing_url, document_url, document_type, published_date::text
      FROM research_reports
      WHERE id = ${reportId}
      LIMIT 1
    `
    const report = reportRows.rows[0]
    if (!report) return { ok: false, error: "Report not found." }

    let resolved = await resolveDocument(report.document_url)
    let warning: string | undefined
    if (!resolved.text || resolved.text.length < 100) {
      const fallback = await resolveDocument(report.landing_url)
      if (!fallback.text || fallback.text.length < 100) {
        return { ok: false, error: "Insufficient content to summarize." }
      }
      resolved = fallback
      warning = "PDF extraction was limited; summary generated from landing page content."
    }

    const aiSummary = await summarizeReportText(resolved.text, report.title, report.producer)
    if (!aiSummary) return { ok: false, error: "AI summarization failed." }

    const summaryJson = {
      executiveSummary: aiSummary.summary || "",
      keyTakeaways: aiSummary.bullets || [],
      notableStats: [] as string[],
      risks: [] as string[],
      opportunities: [] as string[],
      whatToWatch_30_90: [] as string[],
      metadata: {
        producer: report.producer,
        title: report.title,
        publishedDate: report.published_date ?? undefined,
        landingUrl: report.landing_url,
        documentUrl: report.document_url,
        documentType: report.document_type,
        summarizedAt: new Date().toISOString(),
        warning,
      },
    }

    await sql`
      INSERT INTO research_summaries (report_id, summary_json, model_provider)
      VALUES (${report.id}, ${JSON.stringify(summaryJson)}::jsonb, ${"perplexity"})
      ON CONFLICT (report_id)
      DO UPDATE SET
        summary_json = EXCLUDED.summary_json,
        model_provider = EXCLUDED.model_provider,
        updated_at = now()
    `

    return { ok: true }
  } catch (err) {
    console.error("[research-feed] Summarize report failed:", err)
    return { ok: false, error: "Failed to summarize report." }
  }
}

export async function runResearchIngestionAction(): Promise<{
  ok: boolean
  scanned?: number
  upserted?: number
  error?: string
}> {
  if (!isDbEnabled()) return { ok: false, error: "POSTGRES_URL is not configured." }
  try {
    const result = await runInstitutionalResearchIngestion()
    return result
  } catch (err) {
    console.error("[research-feed] Ingestion action failed:", err)
    return { ok: false, error: "Failed to run ingestion." }
  }
}
