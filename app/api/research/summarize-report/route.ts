import { NextRequest, NextResponse } from "next/server"
import { isDbEnabled, sql } from "@/lib/db"
import { resolveDocument } from "@/lib/document-resolver"
import { summarizeReportText } from "@/lib/report-summarizer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

type SummarizeBody = {
  reportId?: number
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-admin-upload-token")?.trim() || ""
  const expected = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""
  if (!token || !expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  if (!isDbEnabled()) {
    return NextResponse.json(
      { ok: false, error: "POSTGRES_URL is not configured." },
      { status: 500 }
    )
  }

  try {
    const body = (await request.json()) as SummarizeBody
    const reportId = Number(body?.reportId)
    if (!Number.isFinite(reportId) || reportId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid report id." }, { status: 400 })
    }

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
    if (!report) {
      return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 })
    }

    let resolved = await resolveDocument(report.document_url)
    let warning: string | undefined
    if (!resolved.text || resolved.text.length < 100) {
      const fallback = await resolveDocument(report.landing_url)
      if (!fallback.text || fallback.text.length < 100) {
        return NextResponse.json(
          { ok: false, error: "Insufficient content to summarize." },
          { status: 400 }
        )
      }
      resolved = fallback
      warning = "PDF extraction was limited; summary generated from landing page content."
    }

    const aiSummary = await summarizeReportText(resolved.text, report.title, report.producer)
    if (!aiSummary) {
      return NextResponse.json(
        { ok: false, error: "AI summarization failed. Check PERPLEXITY_API_KEY." },
        { status: 500 }
      )
    }

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

    return NextResponse.json({ ok: true, reportId: report.id })
  } catch (err) {
    console.error("[research-summarize-report] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to summarize report." },
      { status: 500 }
    )
  }
}
