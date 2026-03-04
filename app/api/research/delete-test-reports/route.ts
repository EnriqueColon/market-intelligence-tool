import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-admin-upload-token")?.trim() || ""
  const expected = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""
  if (!token || !expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await sql<{ id: number }>`
      DELETE FROM research_reports
      WHERE producer = 'manual'
         OR tags->>'source' = 'manual_upload'
      RETURNING id
    `

    return NextResponse.json({
      ok: true,
      deleted: result.rowCount || 0,
    })
  } catch (err) {
    console.error("[research-delete-test-reports] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to delete test reports." },
      { status: 500 }
    )
  }
}
