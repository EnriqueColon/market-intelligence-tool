"use server"

import { createHash } from "crypto"
import { resolveDocument } from "@/lib/document-resolver"
import { summarizeReportText } from "@/lib/report-summarizer"
import { reportIdFromUrl } from "@/lib/report-id"
import { resolveReportDocument } from "@/lib/report-resolver"
import type { EntityId } from "@/lib/entity-sources"
import { isDbEnabled, sql } from "@/lib/db"
import { setSummaryByHash } from "@/lib/market-research-memory"
import { upsertResearchReport } from "@/app/ingestion/storage/upsert-report"
import type { ReportSummaryEntry } from "./fetch-report-summaries"

export type SummarizeFoundReportResult =
  | { ok: true; summary: ReportSummaryEntry }
  | { ok: false; error: string }

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex")
}

export async function summarizeFoundReport(
  url: string,
  title: string,
  entityId: EntityId,
  preResolved?: {
    documentUrl: string
    documentType: "pdf" | "html"
    publishedDate?: string
  }
): Promise<SummarizeFoundReportResult> {
  if (!isDbEnabled() && process.env.NODE_ENV === "production") {
    return {
      ok: false,
      error: "Database is required in production. Configure POSTGRES_URL for summary persistence.",
    }
  }

  try {
    const docMeta =
      preResolved ??
      (await resolveReportDocument(url, entityId))
    const landingUrl = url
    const documentUrl = docMeta.documentUrl
    const documentType = docMeta.documentType

    const hash = urlHash(documentUrl || landingUrl)
    if (isDbEnabled()) {
      const existing = await sql<{
        summary_json: any
        updated_at: string
      }>`
        SELECT rs.summary_json, rs.updated_at
        FROM research_summaries rs
        JOIN research_reports rr ON rr.id = rs.report_id
        WHERE rr.url_hash = ${hash}
        LIMIT 1
      `
      const row = existing.rows[0]
      if (row?.summary_json) {
        const data = row.summary_json
        const entry: ReportSummaryEntry = {
          reportId: reportIdFromUrl(landingUrl),
          summary: data.executiveSummary ?? "",
          bullets: data.keyTakeaways ?? [],
          executiveSummary: data.executiveSummary ?? "",
          keyTakeaways: data.keyTakeaways ?? [],
          notableStats: data.notableStats ?? [],
          risks: data.risks ?? [],
          opportunities: data.opportunities ?? [],
          metadata: data.metadata,
          lastFetched: row.updated_at,
          source: data.metadata?.documentType === "pdf" ? "pdf" : "page",
          error: null,
        }
        return { ok: true, summary: entry }
      }
    }

    let resolved = await resolveDocument(documentUrl)
    let warning: string | undefined

    if (resolved.source === "failed") {
      const msg = resolved.error || "Could not fetch or extract content."
      const isBlocked =
        msg.includes("403") ||
        msg.includes("401") ||
        msg.includes("blocked") ||
        msg.includes("access denied")
      const hint = isBlocked
        ? " The report may be gated. Use 'Upload PDF / Paste text' if you have access."
        : ""
      return { ok: false, error: msg + hint }
    }

    if (!resolved.text || resolved.text.length < 100) {
      // If PDF extraction is weak, fall back to landing page text before failing.
      if (documentType === "pdf" && documentUrl !== landingUrl) {
        const fallback = await resolveDocument(landingUrl)
        if (fallback.source !== "failed" && fallback.text && fallback.text.length >= 100) {
          resolved = fallback
          warning = "PDF extraction was limited; summary generated from landing page content."
        } else {
          return {
            ok: false,
            error: "Insufficient content extracted. The page may require login or block automated access.",
          }
        }
      } else {
        return {
          ok: false,
          error: "Insufficient content extracted. The page may require login or block automated access.",
        }
      }
    }

    const sourceLabel = entityId === "all" ? "Report" : entityId.toUpperCase()
    const aiSummary = await summarizeReportText(resolved.text, title, sourceLabel)

    if (!aiSummary || (!aiSummary.summary && aiSummary.bullets.length === 0)) {
      return {
        ok: false,
        error: "AI summarization failed. Ensure OPENAI_API_KEY is set.",
      }
    }

    const reportId = reportIdFromUrl(landingUrl)
    const summaryJson = {
      executiveSummary: aiSummary.summary || "",
      keyTakeaways: aiSummary.bullets || [],
      notableStats: [] as string[],
      risks: [] as string[],
      opportunities: [] as string[],
      whatToWatch_30_90: [] as string[],
      metadata: {
        producer: sourceLabel,
        title,
        landingUrl,
        documentUrl,
        documentType,
        summarizedAt: new Date().toISOString(),
        warning,
        publishedDate: preResolved?.publishedDate,
      },
    }

    const entry: ReportSummaryEntry = {
      reportId,
      summary: aiSummary.summary || "",
      bullets: aiSummary.bullets || [],
      executiveSummary: summaryJson.executiveSummary,
      keyTakeaways: summaryJson.keyTakeaways,
      notableStats: summaryJson.notableStats,
      risks: summaryJson.risks,
      opportunities: summaryJson.opportunities,
      metadata: summaryJson.metadata,
      lastFetched: new Date().toISOString(),
      source: documentType === "pdf" ? "pdf" : "page",
      error: null,
    }

    if (isDbEnabled()) {
      try {
        const reportRow = await upsertResearchReport({
          producer: sourceLabel,
          title,
          landingUrl,
          documentUrl,
          documentType,
          publishedDate: preResolved?.publishedDate,
          tags: {},
        })

        await sql`
          INSERT INTO research_summaries (
            report_id,
            summary_json,
            model_provider
          )
          VALUES (
            ${reportRow.id},
            ${JSON.stringify(summaryJson)}::jsonb,
            ${"openai"}
          )
          ON CONFLICT (report_id)
          DO UPDATE SET
            summary_json = EXCLUDED.summary_json,
            updated_at = now()
        `
      } catch (err) {
        console.error("[summarizeFoundReport] DB write failed:", err)
      }
    } else if (process.env.NODE_ENV !== "production") {
      setSummaryByHash(hash, entry)
    }

    return { ok: true, summary: entry }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
