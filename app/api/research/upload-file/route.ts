import { NextRequest, NextResponse } from "next/server"
import { reportStorageDriver, saveReportToDisk } from "@/lib/report-storage"

// Disk-storage counterpart of the Blob client-upload handshake: the browser
// posts the PDF here as multipart form data and gets back the document_url to
// register. Only answers when REPORT_STORAGE=disk; on Vercel uploads go to
// Blob through /api/blob/handle-upload and this route refuses.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_FILE_SIZE = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  const adminToken = request.headers.get("x-admin-upload-token")?.trim() || ""
  const expectedToken = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""
  if (!adminToken || !expectedToken || adminToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  if (reportStorageDriver() !== "disk") {
    return NextResponse.json(
      { ok: false, error: "Disk storage is not enabled here; uploads go to Blob." },
      { status: 400 }
    )
  }

  try {
    const form = await request.formData()
    const file = form.get("file")
    const pathname = String(form.get("pathname") || "").trim()
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file." }, { status: 400 })
    }
    const name = file.name || "unnamed.pdf"
    if (!(file.type === "application/pdf" || name.toLowerCase().endsWith(".pdf"))) {
      return NextResponse.json({ ok: false, error: "Only PDF files are allowed." }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ ok: false, error: "File exceeds 25MB limit." }, { status: 413 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const saved = await saveReportToDisk(pathname || `market-research/${Date.now()}-${name}`, bytes)
    return NextResponse.json({ ok: true, url: saved.url, pathname: saved.pathname, size: bytes.length })
  } catch (err) {
    console.error("[research-upload-file] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to store the file." },
      { status: 500 }
    )
  }
}
