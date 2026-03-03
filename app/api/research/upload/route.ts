import { NextRequest, NextResponse } from "next/server"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { upsertResearchReport } from "@/app/ingestion/storage/upsert-report"

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
  const token =
    request.headers.get("x-admin-upload-token") ||
    new URL(request.url).searchParams.get("token")
  if (!token || token !== process.env.ADMIN_UPLOAD_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await request.json()) as HandleUploadBody
    const json = await handleUpload({
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
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = (() => {
          try {
            return tokenPayload ? (JSON.parse(tokenPayload) as Record<string, unknown>) : {}
          } catch {
            return {}
          }
        })()
        const originalFilename =
          typeof payload.originalFilename === "string" ? payload.originalFilename : blob.pathname
        const title =
          typeof payload.title === "string" ? payload.title : humanizeFilename(originalFilename)
        await upsertResearchReport({
          producer: "manual",
          title: title || "Untitled Report",
          landingUrl: blob.url,
          documentUrl: blob.url,
          documentType: "pdf",
          tags: {
            source: "manual_upload",
            originalFilename,
            blobPath: blob.pathname,
            uploadedAt:
              typeof payload.uploadedAt === "string"
                ? payload.uploadedAt
                : new Date().toISOString(),
          },
        })
      },
    })

    return NextResponse.json(json)
  } catch (err) {
    console.error("[research-upload] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to process upload request." },
      { status: 500 }
    )
  }
}
