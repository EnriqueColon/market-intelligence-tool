import { FETCH_HEADERS } from "@/lib/report-scraper"
import { resolveReportDocument } from "@/lib/report-resolver"
import { upsertResearchReport } from "@/app/ingestion/storage/upsert-report"
import { federalReserveSource } from "@/app/ingestion/sources/federal-reserve"
import { fdicSource } from "@/app/ingestion/sources/fdic"
import { cbreSource } from "@/app/ingestion/sources/cbre"
import { jllSource } from "@/app/ingestion/sources/jll"
import { cushmanWakefieldSource } from "@/app/ingestion/sources/cushman-wakefield"
import { colliersSource } from "@/app/ingestion/sources/colliers"
import { naiopSource } from "@/app/ingestion/sources/naiop"
import { uliSource } from "@/app/ingestion/sources/uli"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

const ADAPTERS: ProducerAdapter[] = [
  federalReserveSource,
  fdicSource,
  cbreSource,
  jllSource,
  cushmanWakefieldSource,
  colliersSource,
  naiopSource,
  uliSource,
]

function deriveTags(title: string, producer: string) {
  const t = `${title} ${producer}`.toLowerCase()
  const assetType =
    t.includes("office") ? "Office" :
    t.includes("multifamily") ? "Multifamily" :
    t.includes("industrial") ? "Industrial" :
    t.includes("retail") ? "Retail" :
    t.includes("capital") ? "Capital Markets" :
    t.includes("bank") || t.includes("fdic") || t.includes("federal reserve") ? "Banking" :
    undefined

  const geography =
    t.includes("miami") ? "Miami" :
    t.includes("florida") ? "Florida" :
    t.includes("u.s.") || t.includes("us ") || t.includes("united states") ? "US" :
    undefined

  return { assetType, geography, topics: [] as string[] }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch (err) {
    console.error("[ingestion] Seed fetch failed:", url, err)
    return null
  }
}

export async function runInstitutionalResearchIngestion(): Promise<{
  ok: boolean
  scanned: number
  upserted: number
}> {
  let scanned = 0
  let upserted = 0

  for (const adapter of ADAPTERS) {
    for (const seedUrl of adapter.seedUrls) {
      const html = await fetchHtml(seedUrl)
      if (!html) continue
      const reports = adapter.extractReports(html, seedUrl)
      for (const report of reports) {
        scanned += 1
        try {
          const resolved = await resolveReportDocument(report.landingUrl, adapter.producerId)
          const tags = deriveTags(report.title, adapter.producerId)
          await upsertResearchReport({
            producer: adapter.producerId,
            title: report.title,
            landingUrl: report.landingUrl,
            documentUrl: resolved.documentUrl,
            documentType: resolved.documentType,
            publishedDate: report.publishedDate,
            tags,
          })
          upserted += 1
        } catch (err) {
          console.error("[ingestion] Upsert failed:", adapter.producerId, report.landingUrl, err)
        }
      }
    }
  }

  return { ok: true, scanned, upserted }
}
