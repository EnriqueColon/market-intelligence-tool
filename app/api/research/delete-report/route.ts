import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

type DeleteReportBody = {
  id?: number
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-admin-upload-token")?.trim() || ""
  const expected = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""
  if (!token || !expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await request.json()) as DeleteReportBody
    const id = Number(body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid report id." }, { status: 400 })
    }

    const deleted = await sql<{ id: number; title: string }>`
      DELETE FROM research_reports
      WHERE id = ${id}
      RETURNING id, title
    `

    const row = deleted.rows[0]
    if (!row) {
      return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 })
    }

    return NextResponse.json({ ok: true, id: row.id, title: row.title })
  } catch (err) {
    console.error("[research-delete-report] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to delete report." },
      { status: 500 }
    )
  }
}
