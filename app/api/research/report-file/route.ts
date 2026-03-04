import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

function safeFilename(input: string): string {
  const base = input.trim().replace(/[/\\?%*:|"<>]/g, "-")
  const normalized = base.replace(/\s+/g, " ").trim()
  if (!normalized) return "report.pdf"
  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized}.pdf`
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const idRaw = searchParams.get("id")?.trim() || ""
  const asDownload = searchParams.get("download") === "1"

  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid report id." }, { status: 400 })
  }

  try {
    const row = await sql<{ title: string; document_url: string }>`
      SELECT title, document_url
      FROM research_reports
      WHERE id = ${id}
      LIMIT 1
    `

    const report = row.rows[0]
    if (!report?.document_url) {
      return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 })
    }

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || ""
    if (!blobToken) {
      return NextResponse.json(
        { ok: false, error: "Blob is not configured at runtime." },
        { status: 500 }
      )
    }

    const upstream = await fetch(report.document_url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${blobToken}`,
      },
      cache: "no-store",
    })

    if (!upstream.ok || !upstream.body) {
      const snippet = (await upstream.text().catch(() => "")).slice(0, 300)
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to fetch blob (${upstream.status}). ${snippet || "No details."}`,
        },
        { status: 502 }
      )
    }

    const contentType =
      upstream.headers.get("content-type")?.trim() || "application/pdf"
    const filename = safeFilename(report.title || `report-${id}.pdf`)
    const disposition = `${asDownload ? "attachment" : "inline"}; filename="${filename}"`

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": disposition,
        "cache-control": "private, no-store, max-age=0",
      },
    })
  } catch (err) {
    console.error("[research-report-file] Failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to open report file." },
      { status: 500 }
    )
  }
}
