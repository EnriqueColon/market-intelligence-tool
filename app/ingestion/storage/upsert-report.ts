import { createHash } from "crypto"
import { sql } from "@/lib/db"

export type UpsertResearchReportInput = {
  producer: string
  title: string
  landingUrl: string
  documentUrl: string
  documentType: "pdf" | "html"
  publishedDate?: string
  tags?: Record<string, unknown>
}

export type UpsertResearchReportResult = {
  id: number
  action: "inserted" | "updated"
}

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex")
}

function normalizeDate(input?: string): string | null {
  if (!input) return null
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export async function upsertResearchReport(input: UpsertResearchReportInput): Promise<UpsertResearchReportResult> {
  const hash = urlHash(input.documentUrl || input.landingUrl)
  const rows = await sql<{ id: number; inserted: boolean }>`
    INSERT INTO research_reports (
      producer,
      title,
      landing_url,
      document_url,
      document_type,
      published_date,
      tags,
      url_hash,
      discovered_at,
      last_seen_at
    )
    VALUES (
      ${input.producer},
      ${input.title},
      ${input.landingUrl},
      ${input.documentUrl},
      ${input.documentType},
      ${normalizeDate(input.publishedDate)},
      ${JSON.stringify(input.tags ?? {})}::jsonb,
      ${hash},
      now(),
      now()
    )
    ON CONFLICT (url_hash)
    DO UPDATE SET
      producer = EXCLUDED.producer,
      title = CASE WHEN length(EXCLUDED.title) > length(research_reports.title) THEN EXCLUDED.title ELSE research_reports.title END,
      landing_url = EXCLUDED.landing_url,
      document_url = EXCLUDED.document_url,
      document_type = EXCLUDED.document_type,
      published_date = COALESCE(EXCLUDED.published_date, research_reports.published_date),
      tags = CASE
        WHEN research_reports.tags IS NULL OR research_reports.tags = '{}'::jsonb THEN EXCLUDED.tags
        ELSE research_reports.tags || EXCLUDED.tags
      END,
      last_seen_at = now()
    RETURNING id, (xmax = 0) AS inserted
  `
  const row = rows.rows[0]
  return {
    id: row.id,
    action: row.inserted ? "inserted" : "updated",
  }
}
