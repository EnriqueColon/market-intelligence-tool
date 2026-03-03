import { NextRequest, NextResponse } from "next/server"
import { put } from "@vercel/blob"
import { upsertResearchReport } from "@/app/ingestion/storage/upsert-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const MAX_FILE_SIZE = 25 * 1024 * 1024
const MAX_FILES = 15

function isPdfLike(file: File): boolean {
  const name = file.name.toLowerCase()
  return file.type === "application/pdf" || name.endsWith(".pdf")
}

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
  const token = request.headers.get("x-admin-upload-token")
  if (!token || token !== process.env.ADMIN_UPLOAD_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const files = formData.getAll("files").filter((v): v is File => v instanceof File)

    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No files provided. Use multipart key 'files'." },
        { status: 400 }
      )
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { ok: false, error: `Too many files. Max ${MAX_FILES} per request.` },
        { status: 400 }
      )
    }

    const uploaded: Array<{ title: string; url: string; id: number }> = []
    const failed: Array<{ filename: string; error: string }> = []

    const now = new Date()
    const yyyy = String(now.getUTCFullYear())
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0")

    for (const file of files) {
      const originalFilename = file.name || "unnamed.pdf"
      if (!isPdfLike(file)) {
        failed.push({ filename: originalFilename, error: "Only PDF files are allowed." })
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        failed.push({ filename: originalFilename, error: "File exceeds 25MB limit." })
        continue
      }

      try {
        const safe = safeFilename(originalFilename)
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
        const blobPath = `market-research/${yyyy}/${mm}/${unique}`
        const blob = await put(blobPath, file, {
          access: "public",
          addRandomSuffix: false,
        })

        const title = humanizeFilename(originalFilename) || "Untitled Report"
        const upsert = await upsertResearchReport({
          producer: "manual",
          title,
          landingUrl: blob.url,
          documentUrl: blob.url,
          documentType: "pdf",
          tags: {
            source: "manual_upload",
            originalFilename,
            blobPath,
            uploadedAt: new Date().toISOString(),
          },
        })

        uploaded.push({
          title,
          url: blob.url,
          id: upsert.id,
        })
      } catch (err) {
        failed.push({
          filename: originalFilename,
          error: err instanceof Error ? err.message : "Upload failed",
        })
      }
    }

    return NextResponse.json({ ok: true, uploaded, failed })
  } catch (err) {
    console.error("[research-upload] Failed:", err)
    return NextResponse.json(
      { ok: false, error: "Failed to process upload request." },
      { status: 500 }
    )
  }
}
