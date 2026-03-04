import { NextRequest, NextResponse } from "next/server"
import { isDbEnabled, sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

export async function GET(request: NextRequest) {
  if (!isDbEnabled()) {
    return NextResponse.json(
      { ok: false, error: "POSTGRES_URL is not configured." },
      { status: 500 }
    )
  }

  const reportIdRaw = new URL(request.url).searchParams.get("reportId")?.trim() || ""
  const reportId = Number(reportIdRaw)
  if (!Number.isFinite(reportId) || reportId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid reportId." }, { status: 400 })
  }

  try {
    const rows = await sql<{ summary_json: unknown }>`
      SELECT summary_json
      FROM research_summaries
      WHERE report_id = ${reportId}
      LIMIT 1
    `

    const row = rows.rows[0]
    if (!row?.summary_json) {
      return NextResponse.json({ ok: false, error: "No summary found." }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      summary: row.summary_json,
    })
  } catch (err) {
    console.error("[research-summary] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to fetch summary." },
      { status: 500 }
    )
  }
}
