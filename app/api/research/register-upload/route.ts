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

type ExtractedMetadata = {
  producer?: string
  title?: string
  periodLabel?: string
  publishedDateISO?: string
  propertyType?: string
}

function humanizeFilename(name: string): string {
  const noExt = name.replace(/\.pdf$/i, "")
  return noExt.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}

function firstMeaningfulLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, 40)

  for (const line of lines) {
    if (line.length < 12 || line.length > 140) continue
    if (/^page\s+\d+/i.test(line)) continue
    if (/copyright|all rights reserved|confidential/i.test(line)) continue
    if (!/[a-z]/i.test(line)) continue
    return line
  }
  return undefined
}

function detectProducer(text: string): string | undefined {
  const producers: Array<{ key: string; pattern: RegExp }> = [
    { key: "cbre", pattern: /\bcbre\b/i },
    { key: "jll", pattern: /\bjll\b|\bjones lang lasalle\b/i },
    { key: "cushman-wakefield", pattern: /\bcushman\b|\bwakefield\b/i },
    { key: "colliers", pattern: /\bcolliers\b/i },
    { key: "mhn", pattern: /\bmulti-housing news\b|\bmhn\b/i },
    { key: "commercialsearch", pattern: /\bcommercialsearch\b/i },
    { key: "naiop", pattern: /\bnaiop\b/i },
    { key: "uli", pattern: /\burban land institute\b|\buli\b/i },
    { key: "mba", pattern: /\bmortgage bankers association\b|\bmba\b/i },
  ]

  for (const item of producers) {
    if (item.pattern.test(text)) return item.key
  }
  return undefined
}

function detectPeriodLabel(text: string): string | undefined {
  const quarter = text.match(/\bQ([1-4])\s*(20\d{2})\b/i)
  if (quarter) return `Q${quarter[1]} ${quarter[2]}`

  const monthYear = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  )
  if (monthYear) return `${monthYear[1]} ${monthYear[2]}`

  return undefined
}

function toIsoDateFromMonthYear(month: string, year: string): string | undefined {
  const monthMap: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  }
  const mm = monthMap[month.toLowerCase()]
  if (!mm) return undefined
  return `${year}-${mm}-01`
}

function detectPublishedDateISO(text: string): string | undefined {
  const full = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),\s*(20\d{2})\b/i
  )
  if (full) {
    const day = String(Number(full[2])).padStart(2, "0")
    const base = toIsoDateFromMonthYear(full[1], full[3])
    if (base) return `${base.slice(0, 8)}${day}`
  }

  const monthYear = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  )
  if (monthYear) return toIsoDateFromMonthYear(monthYear[1], monthYear[2])

  const quarter = text.match(/\bQ([1-4])\s*(20\d{2})\b/i)
  if (quarter) {
    const q = Number(quarter[1])
    const year = quarter[2]
    const mm = q === 1 ? "03" : q === 2 ? "06" : q === 3 ? "09" : "12"
    return `${year}-${mm}-01`
  }

  return undefined
}

function detectPropertyType(text: string): string | undefined {
  if (/\bindustrial\b/i.test(text)) return "industrial"
  if (/\boffice\b/i.test(text)) return "office"
  if (/\bmultifamily\b|\bapartment\b/i.test(text)) return "multifamily"
  if (/\bretail\b/i.test(text)) return "retail"
  if (/\bhospitality\b|\bhotel\b/i.test(text)) return "hospitality"
  return undefined
}

async function extractMetadataFromPrivatePdf(blobUrl: string): Promise<ExtractedMetadata | null> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!blobToken) return null

  const response = await fetch(blobUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${blobToken}`,
    },
    cache: "no-store",
  })
  if (!response.ok) return null

  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (!contentType.includes("pdf")) return null

  const arrayBuffer = await response.arrayBuffer()
  const pdfBytes = Buffer.from(arrayBuffer)
  const { extractTextWithFallbacks } = require("../../../actions/pdf-text-extraction.js") as {
    extractTextWithFallbacks: (
      bytes: Buffer,
      opts?: { maxPages?: number; ocrPages?: number }
    ) => Promise<{ text?: string }>
  }

  const extraction = await extractTextWithFallbacks(pdfBytes, {
    maxPages: 8,
    ocrPages: 2,
  })
  const text = normalizeWhitespace(String(extraction?.text || "")).slice(0, 12000)
  if (!text || text.length < 100) return null

  return {
    producer: detectProducer(text),
    title: firstMeaningfulLine(text),
    periodLabel: detectPeriodLabel(text),
    publishedDateISO: detectPublishedDateISO(text),
    propertyType: detectPropertyType(text),
  }
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
    let title =
      (body.title || "").trim() || humanizeFilename(originalFilename) || "Untitled Report"
    let producer = "manual"
    let publishedDate: string | undefined
    let extracted: ExtractedMetadata | null = null

    try {
      extracted = await Promise.race([
        extractMetadataFromPrivatePdf(blobUrl),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ])
    } catch (err) {
      console.warn("[research-register-upload] Metadata extraction warning:", err)
    }

    if (extracted?.title) title = extracted.title
    if (extracted?.producer) producer = extracted.producer
    if (extracted?.publishedDateISO) publishedDate = extracted.publishedDateISO

    const upsert = await upsertResearchReport({
      producer,
      title,
      landingUrl: blobUrl,
      documentUrl: blobUrl,
      documentType: "pdf",
      publishedDate,
      tags: {
        source: "manual_upload",
        originalFilename,
        blobPath: (body.blobPath || "").trim() || undefined,
        uploadedAt: new Date().toISOString(),
        metadataStatus: extracted ? "extracted" : "fallback",
        extractedMetadata: extracted || undefined,
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
