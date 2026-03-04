import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 10

export async function POST(request: NextRequest) {
  const adminToken = request.headers.get("x-admin-upload-token")?.trim() || ""
  const expectedToken = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""
  if (!adminToken || !expectedToken || adminToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim())
  if (!hasBlobToken) {
    return NextResponse.json(
      { ok: false, error: "Missing BLOB_READ_WRITE_TOKEN at runtime." },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    message: "Blob token preflight passed.",
    region: process.env.VERCEL_REGION || "local",
    ts: new Date().toISOString(),
  })
}
