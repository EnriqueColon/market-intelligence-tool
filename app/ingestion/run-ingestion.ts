import { FETCH_HEADERS } from "@/lib/report-scraper"
import { fetchWithTimeout } from "@/lib/http"
import { resolveReportDocument } from "@/lib/report-resolver"
import { scoreDistressedCreRelevance } from "@/app/ingestion/relevance"
import { upsertResearchReport } from "@/app/ingestion/storage/upsert-report"
import { federalReserveSource } from "@/app/ingestion/sources/federal-reserve"
import { fdicSource } from "@/app/ingestion/sources/fdic"
import { cbreSource } from "@/app/ingestion/sources/cbre"
import { fetchCbreCoveoResults } from "@/app/ingestion/sources/cbre-coveo"
import { jllSource } from "@/app/ingestion/sources/jll"
import { cushmanWakefieldSource } from "@/app/ingestion/sources/cushman-wakefield"
import { colliersSource } from "@/app/ingestion/sources/colliers"
import { naiopSource } from "@/app/ingestion/sources/naiop"
import { uliSource } from "@/app/ingestion/sources/uli"
import type { ExtractedReport, ProducerAdapter } from "@/app/ingestion/sources/types"

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

type IngestionError = {
  producer: string
  stage: "seed_fetch" | "extract" | "resolve" | "upsert"
  url?: string
  message: string
}

export type IngestionRunResult = {
  ok: true
  startedAt: string
  finishedAt: string
  elapsedMs: number
  producersPlanned: number
  producersRun: number
  candidatesFound: number
  processed: number
  inserted: number
  updated: number
  skipped: number
  errors: IngestionError[]
}

type IngestionLimits = {
  maxProducers: number
  maxReportsPerProducer: number
  maxTotalReports: number
  timeoutMs: number
  maxAcceptedPerProducer: number
}

type DebugItem = {
  title: string
  landingUrl: string
  producer: string
  note?: string
  score?: number
  reasons?: string[]
  documentUrl?: string
  documentType?: "pdf" | "html"
  blockedHost?: string
}

type ProducerDebugBucket = {
  rejectedIrrelevant: DebugItem[]
  blockedAllowlist: DebugItem[]
  accepted: DebugItem[]
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getIngestionLimits(): IngestionLimits {
  return {
    maxProducers: parseIntEnv("INGESTION_MAX_PRODUCERS", 3),
    maxReportsPerProducer: parseIntEnv("INGESTION_MAX_REPORTS_PER_PRODUCER", 5),
    maxTotalReports: parseIntEnv("INGESTION_MAX_TOTAL_REPORTS", 15),
    timeoutMs: parseIntEnv("INGESTION_TIMEOUT_MS", 20000),
    maxAcceptedPerProducer: parseIntEnv("INGESTION_MAX_ACCEPTED_PER_PRODUCER", 3),
  }
}

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
    const res = await fetchWithTimeout(url, {
      cache: "no-store",
      headers: FETCH_HEADERS,
      timeoutMs: 8000,
    })
    if (!res.ok) return null
    return await res.text()
  } catch (err) {
    console.error("[ingestion] Seed fetch failed:", url, err)
    return null
  }
}

function pushBounded<T>(arr: T[], item: T, limit = 5): void {
  if (arr.length >= limit) return
  arr.push(item)
}

const DEFAULT_CBRE_COVEO_QUERIES = [
  "south florida",
  "florida",
  "us multifamily",
  "us industrial",
  "us office",
  "us retail",
]

function getCbreCoveoQueries(): string[] {
  const raw = process.env.CBRE_COVEO_QUERIES?.trim()
  if (!raw) return DEFAULT_CBRE_COVEO_QUERIES
  const parsed = raw
    .split(",")
    .map((q) => q.trim())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : DEFAULT_CBRE_COVEO_QUERIES
}

export async function runInstitutionalResearchIngestion(): Promise<IngestionRunResult> {
  const limits = getIngestionLimits()
  const startedAt = new Date()
  const startedMs = Date.now()
  const errors: IngestionError[] = []
  let producersRun = 0
  let candidatesFound = 0
  let processed = 0
  let inserted = 0
  let updated = 0
  let skipped = 0
  let stopReason: string | null = null
  const acceptedByProducer: Record<string, number> = {}
  const debugByProducer: Record<string, ProducerDebugBucket> = {}

  const planned = ADAPTERS.slice(0, limits.maxProducers)
  console.log("[ingestion] start", {
    limits,
    maxAcceptedPerProducer: limits.maxAcceptedPerProducer,
    producersPlanned: planned.map((p) => p.producerId),
  })

  const shouldStop = (): boolean => {
    const elapsed = Date.now() - startedMs
    if (elapsed > limits.timeoutMs) {
      stopReason = "time budget reached"
      return true
    }
    if (processed >= limits.maxTotalReports) {
      stopReason = "max total reached"
      return true
    }
    return false
  }

  for (const adapter of planned) {
    if (shouldStop()) break
    producersRun += 1
    let producerCandidates = 0
    let producerProcessed = 0
    let producerInserted = 0
    let producerUpdated = 0
    let producerSkipped = 0
    let producerRejectedIrrelevant = 0
    const producerId = adapter.producerId
    const producerDebug =
      debugByProducer[producerId] ??
      (debugByProducer[producerId] = {
        rejectedIrrelevant: [],
        blockedAllowlist: [],
        accepted: [],
      })

    console.log("[ingestion] producer start", { producer: producerId })

    const processReports = async (reports: ExtractedReport[]) => {
      for (const report of reports) {
        if (shouldStop()) break
        if (processed >= limits.maxTotalReports) {
          stopReason = "max total reached"
          break
        }
        processed += 1
        producerProcessed += 1

        const rel = scoreDistressedCreRelevance({
          producerId,
          title: report.title,
          landingUrl: report.landingUrl,
          publishedDate: report.publishedDate,
        })
        if (!rel.isRelevant) {
          pushBounded(producerDebug.rejectedIrrelevant, {
            title: report.title,
            landingUrl: report.landingUrl,
            producer: producerId,
            score: rel.score,
            reasons: rel.reasons,
            note: "irrelevant",
          })
          skipped += 1
          producerSkipped += 1
          producerRejectedIrrelevant += 1
          continue
        }

        let resolved: Awaited<ReturnType<typeof resolveReportDocument>>
        try {
          resolved = await resolveReportDocument(report.landingUrl, producerId)
        } catch (err) {
          errors.push({
            producer: producerId,
            stage: "resolve",
            url: report.landingUrl,
            message: err instanceof Error ? err.message : String(err),
          })
          skipped += 1
          producerSkipped += 1
          continue
        }

        if (resolved.blockedByAllowlist) {
          let blockedHost = ""
          try {
            blockedHost = new URL(resolved.documentUrl).hostname
          } catch {
            blockedHost = ""
          }
          pushBounded(producerDebug.blockedAllowlist, {
            title: report.title,
            landingUrl: report.landingUrl,
            producer: producerId,
            documentUrl: resolved.documentUrl,
            blockedHost,
            note: "blockedByAllowlist",
          })
          skipped += 1
          producerSkipped += 1
          continue
        }

        if ((acceptedByProducer[producerId] || 0) >= limits.maxAcceptedPerProducer) {
          skipped += 1
          producerSkipped += 1
          continue
        }

        try {
          const baseTags = deriveTags(report.title, adapter.producerId)
          const tags = {
            ...baseTags,
            relevance: rel,
            topic: "distressed_cre_debt_v1",
          }
          const result = await upsertResearchReport({
            producer: adapter.producerId,
            title: report.title,
            landingUrl: report.landingUrl,
            documentUrl: resolved.documentUrl,
            documentType: resolved.documentType,
            publishedDate: report.publishedDate,
            tags,
          })
          if (result.action === "inserted") {
            inserted += 1
            producerInserted += 1
          } else {
            updated += 1
            producerUpdated += 1
          }
          acceptedByProducer[producerId] = (acceptedByProducer[producerId] || 0) + 1
          pushBounded(producerDebug.accepted, {
            title: report.title,
            landingUrl: report.landingUrl,
            producer: producerId,
            documentUrl: resolved.documentUrl,
            documentType: resolved.documentType,
          })
        } catch (err) {
          errors.push({
            producer: producerId,
            stage: "upsert",
            url: report.landingUrl,
            message: err instanceof Error ? err.message : String(err),
          })
          skipped += 1
          producerSkipped += 1
        }
      }
    }

    if (producerId === "cbre") {
      console.log("[ingestion][cbre] USING COVEO PATH")
      const queries = getCbreCoveoQueries()
      const merged: ExtractedReport[] = []
      let rawResultsCount = 0
      let queriesRun = 0

      for (const query of queries) {
        if (shouldStop()) break
        try {
          const results = await fetchCbreCoveoResults({
            query,
            numberOfResults: 9,
            firstResult: 0,
          })
          queriesRun += 1
          rawResultsCount += results.length
          merged.push(...results)
        } catch (err) {
          errors.push({
            producer: producerId,
            stage: "extract",
            url: query,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const deduped = Array.from(new Map(merged.map((r) => [r.landingUrl, r])).values())
      const limited = deduped.slice(0, limits.maxReportsPerProducer)
      producerCandidates += limited.length
      candidatesFound += limited.length
      console.log("[ingestion] cbre coveo", {
        queriesRun,
        queries,
        rawResultsCount,
        dedupedCount: deduped.length,
        finalCandidateCount: limited.length,
      })
      await processReports(limited)
    } else {
      for (const seedUrl of adapter.seedUrls) {
        if (producerId === "cbre") {
          console.log("[ingestion][cbre] USING LEGACY SEED FETCH PATH")
        }
        if (shouldStop()) break
        const html = await fetchHtml(seedUrl)
        if (!html) {
          errors.push({
            producer: adapter.producerId,
            stage: "seed_fetch",
            url: seedUrl,
            message: "Seed page fetch failed or timed out.",
          })
          continue
        }

        let extracted: ReturnType<ProducerAdapter["extractReports"]> = []
        try {
          extracted = adapter.extractReports(html, seedUrl)
        } catch (err) {
          errors.push({
            producer: adapter.producerId,
            stage: "extract",
            url: seedUrl,
            message: err instanceof Error ? err.message : String(err),
          })
          continue
        }

        const limited = extracted.slice(0, limits.maxReportsPerProducer - producerCandidates)
        producerCandidates += limited.length
        candidatesFound += limited.length
        await processReports(limited)
      }
    }

    console.log("[ingestion] producer end", {
      producer: adapter.producerId,
      candidatesFound: producerCandidates,
      processed: producerProcessed,
      inserted: producerInserted,
      updated: producerUpdated,
      skipped: producerSkipped,
      producerRejectedIrrelevant,
      producerAccepted: acceptedByProducer[producerId] || 0,
      rejectedIrrelevantCount: producerDebug.rejectedIrrelevant.length,
      blockedAllowlistCount: producerDebug.blockedAllowlist.length,
      acceptedCount: producerDebug.accepted.length,
      rejectedIrrelevantSamples: producerDebug.rejectedIrrelevant,
      blockedAllowlistSamples: producerDebug.blockedAllowlist,
      acceptedSamples: producerDebug.accepted,
    })
  }

  const finishedAt = new Date()
  const elapsedMs = Date.now() - startedMs
  if (stopReason) {
    console.log("[ingestion] stop reason", { reason: stopReason, elapsedMs })
  }
  const summary: IngestionRunResult = {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs,
    producersPlanned: planned.length,
    producersRun,
    candidatesFound,
    processed,
    inserted,
    updated,
    skipped,
    errors,
  }
  const debugSummaryByProducer = Object.fromEntries(
    Object.entries(debugByProducer).map(([producer, bucket]) => [
      producer,
      {
        rejectedIrrelevantCount: bucket.rejectedIrrelevant.length,
        blockedAllowlistCount: bucket.blockedAllowlist.length,
        acceptedCount: bucket.accepted.length,
      },
    ])
  )
  console.log("[ingestion] final debug summary", {
    stopReason,
    elapsedMs,
    totals: {
      producersPlanned: planned.length,
      producersRun,
      candidatesFound,
      processed,
      inserted,
      updated,
      skipped,
    },
    debugSummaryByProducer,
  })
  console.log("[ingestion] end", summary)
  return summary
}
