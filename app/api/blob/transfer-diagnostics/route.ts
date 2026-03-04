import { NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ])
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const adminToken = request.headers.get("x-admin-upload-token")?.trim() || ""
  const expectedToken = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""
  if (!adminToken || !expectedToken || adminToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || ""
  if (!blobToken) {
    return NextResponse.json(
      { ok: false, error: "Missing BLOB_READ_WRITE_TOKEN at runtime." },
      { status: 500 }
    )
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const pathname = `market-research/diagnostics/${id}.txt`
  const content = `blob-transfer-diagnostics ${new Date().toISOString()}`

  try {
    const putStartedAt = Date.now()
    const blob = await withTimeout(
      put(pathname, content, {
        access: "private",
        addRandomSuffix: false,
        contentType: "text/plain; charset=utf-8",
        token: blobToken,
      }),
      15000,
      "Blob PUT timed out after 15 seconds."
    )
    const putMs = Date.now() - putStartedAt
    const totalMs = Date.now() - startedAt

    return NextResponse.json({
      ok: true,
      message: "Transfer diagnostics passed.",
      region: process.env.VERCEL_REGION || "local",
      timings: { putMs, totalMs },
      probe: { pathname: blob.pathname, url: blob.url },
      ts: new Date().toISOString(),
    })
  } catch (err) {
    const totalMs = Date.now() - startedAt
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Blob transfer diagnostics failed unexpectedly.",
        region: process.env.VERCEL_REGION || "local",
        timings: { totalMs },
        ts: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
