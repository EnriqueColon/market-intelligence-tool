import { NextRequest, NextResponse } from "next/server"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const MAX_FILE_SIZE = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  const adminToken = request.headers.get("x-admin-upload-token")?.trim() || ""
  if (!adminToken || adminToken !== process.env.ADMIN_UPLOAD_TOKEN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim()
    if (!blobToken) {
      return NextResponse.json(
        { ok: false, error: "Blob is not configured: missing BLOB_READ_WRITE_TOKEN at runtime." },
        { status: 500 }
      )
    }

    const body = (await request.json()) as HandleUploadBody
    const json = await handleUpload({
      token: blobToken,
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_FILE_SIZE,
          addRandomSuffix: false,
        }
      },
      onUploadCompleted: async () => {
        // no-op: DB persistence is handled by /api/research/register-upload.
      },
    })

    return NextResponse.json(json)
  } catch (err) {
    console.error("[blob-handle-upload] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to handle upload." },
      { status: 500 }
    )
  }
}
