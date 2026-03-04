import { NextRequest, NextResponse } from "next/server"
import { upsertResearchReport } from "@/app/ingestion/storage/upsert-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

type RegisterUploadBody = {
  blobUrl?: string
  blobPath?: string
  originalFilename?: string
  title?: string
}

function humanizeFilename(name: string): string {
  const noExt = name.replace(/\.pdf$/i, "")
  return noExt.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-admin-upload-token")
  if (!token || token !== process.env.ADMIN_UPLOAD_TOKEN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await request.json()) as RegisterUploadBody
    const blobUrl = (body.blobUrl || "").trim()
    if (!blobUrl) {
      return NextResponse.json({ ok: false, error: "Missing blobUrl" }, { status: 400 })
    }

    const originalFilename = (body.originalFilename || "").trim() || "uploaded.pdf"
    const title =
      (body.title || "").trim() || humanizeFilename(originalFilename) || "Untitled Report"

    const upsert = await upsertResearchReport({
      producer: "manual",
      title,
      landingUrl: blobUrl,
      documentUrl: blobUrl,
      documentType: "pdf",
      tags: {
        source: "manual_upload",
        originalFilename,
        blobPath: (body.blobPath || "").trim() || undefined,
        uploadedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({ ok: true, id: upsert.id, action: upsert.action })
  } catch (err) {
    console.error("[research-register-upload] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to register upload." },
      { status: 500 }
    )
  }
}
