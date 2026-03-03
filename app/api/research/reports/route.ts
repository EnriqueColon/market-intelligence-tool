import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim() || ""
  const producer = searchParams.get("producer")?.trim() || ""
  const from = searchParams.get("from")?.trim() || ""
  const to = searchParams.get("to")?.trim() || ""

  try {
    const rows = await sql<{
      id: number
      producer: string
      title: string
      document_url: string
      published_date: string | null
      tags: unknown
      has_summary: boolean
    }>`
      SELECT
        rr.id,
        rr.producer,
        rr.title,
        rr.document_url,
        rr.published_date::text,
        rr.tags,
        (rs.report_id IS NOT NULL) AS has_summary
      FROM research_reports rr
      LEFT JOIN research_summaries rs ON rs.report_id = rr.id
      WHERE
        (${q || null}::text IS NULL OR rr.title ILIKE ${`%${q}%`} OR rr.document_url ILIKE ${`%${q}%`})
        AND (${producer || null}::text IS NULL OR rr.producer = ${producer || null})
        AND (${from || null}::date IS NULL OR rr.published_date >= ${from || null}::date)
        AND (${to || null}::date IS NULL OR rr.published_date <= ${to || null}::date)
      ORDER BY rr.published_date DESC NULLS LAST, rr.discovered_at DESC
      LIMIT 500
    `

    return NextResponse.json({
      ok: true,
      items: rows.rows.map((r) => ({
        id: r.id,
        producer: r.producer,
        title: r.title,
        document_url: r.document_url,
        published_date: r.published_date,
        tags: r.tags,
        has_summary: Boolean(r.has_summary),
      })),
    })
  } catch (err) {
    console.error("[research-reports] Failed:", err)
    return NextResponse.json(
      { ok: false, error: "Failed to fetch reports." },
      { status: 500 }
    )
  }
}
