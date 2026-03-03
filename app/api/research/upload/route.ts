import { NextRequest, NextResponse } from "next/server"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

function safeFilename(name: string): string {
  const lower = name.toLowerCase().trim().replace(/\s+/g, "-")
  const cleaned = lower.replace(/[^a-z0-9._-]/g, "")
  return cleaned || `report-${Date.now()}.pdf`
}

function humanizeFilename(name: string): string {
  const noExt = name.replace(/\.pdf$/i, "")
  return noExt.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

export async function POST(request: NextRequest) {
  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim()
    const adminEnvToken = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""
    if (!blobToken) {
      return NextResponse.json(
        { ok: false, error: "Blob is not configured: missing BLOB_READ_WRITE_TOKEN at runtime." },
        { status: 500 }
      )
    }
    const requestTokenHeader = request.headers.get("x-admin-upload-token")?.trim() || ""
    const requestTokenQuery = new URL(request.url).searchParams.get("token")?.trim() || ""

    const body = (await request.json()) as HandleUploadBody
    const json = await handleUpload({
      token: blobToken,
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const parsed = (() => {
          try {
            return clientPayload ? (JSON.parse(clientPayload) as Record<string, unknown>) : {}
          } catch {
            return {}
          }
        })()
        const payloadToken =
          typeof parsed.adminToken === "string" ? parsed.adminToken.trim() : ""

        const authorized =
          (adminEnvToken && payloadToken === adminEnvToken) ||
          (adminEnvToken && requestTokenHeader === adminEnvToken) ||
          (adminEnvToken && requestTokenQuery === adminEnvToken)

        if (!authorized) {
          console.error("[research-upload] Unauthorized token handshake", {
            hasPayloadToken: Boolean(payloadToken),
            hasHeaderToken: Boolean(requestTokenHeader),
            hasQueryToken: Boolean(requestTokenQuery),
          })
          throw new Error("Unauthorized")
        }
        const originalFilename =
          typeof parsed.originalFilename === "string" ? parsed.originalFilename : pathname
        const safe = safeFilename(originalFilename || pathname)
        const title = humanizeFilename(originalFilename || pathname) || "Untitled Report"
        return {
          allowedContentTypes: ["application/pdf"],
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({
            originalFilename,
            title,
            uploadedAt: new Date().toISOString(),
          }),
        }
      },
      onUploadCompleted: async () => {
        // Intentionally no-op for v1.
        // Metadata persistence is handled by /api/research/register-upload from the client
        // immediately after upload() resolves, which keeps this callback fast and avoids
        // slow/hanging client completion when DB connectivity is degraded.
      },
    })

    return NextResponse.json(json)
  } catch (err) {
    console.error("[research-upload] Failed:", err)
    const message = err instanceof Error ? err.message : "Failed to process upload request."
    const status = /unauthorized/i.test(message) ? 401 : 500
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    )
  }
}
