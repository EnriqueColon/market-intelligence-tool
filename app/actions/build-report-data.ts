"use server"

import { unstable_cache } from "next/cache"
import { buildExportData, type ExportData, type ExportRow } from "@/app/actions/export-market-analytics-report"
import {
  computeEarningsScore,
  computeEarningsRanges,
} from "@/lib/scoring/earnings-score"
import { computeVulnerabilityScore } from "@/lib/scoring/vulnerability-score"

export type ReportRow = ExportRow & {
  earningsScore: number
  vulnerabilityScore: number
  roaLatest?: number | null
  roaDelta4Q?: number | null
  netIncomeYoYPct?: number | null
  earningsBufferPct?: number | null
}

export type ReportData = Omit<ExportData, "rows" | "topByCreToCapital" | "topByOpportunityScore"> & {
  rows: ReportRow[]
  topByCreToCapital: ReportRow[]
  topByOpportunityScore: ReportRow[]
}

/**
 * FDIC publishes quarterly, so anything shorter than a quarter is fresh enough.
 * Six hours keeps a stale entry from outliving a working day.
 */
const REPORT_DATA_REVALIDATE_SECONDS = 60 * 60 * 6

/**
 * Build full report data with earnings and vulnerability scores.
 * Used for financial-report-grade PDF rendering and the Visual Analysis panel.
 *
 * Cached because both callers pay the full FDIC pagination otherwise — around
 * 40k rows nationally, which is where the Visual Analysis load time came from.
 *
 * The key is versioned. Scores are cohort-relative percentile ranks as of v2,
 * so entries written by the previous min-max scoring must not be served.
 * Bump the version whenever the scoring changes, or old scores will persist
 * silently until the revalidation window expires.
 *
 * A national payload may exceed the 2MB data-cache entry limit, in which case
 * Next skips the write and logs a warning; smaller scopes still benefit.
 */
export async function buildReportData(scope: string): Promise<ReportData> {
  const cached = unstable_cache(
    () => computeReportData(scope),
    ["market-analytics-report-data-v2", scope],
    { revalidate: REPORT_DATA_REVALIDATE_SECONDS }
  )
  return cached()
}

async function computeReportData(scope: string): Promise<ReportData> {
  const data = await buildExportData(scope)

  const earningsRanges = computeEarningsRanges(data.rows)
  const rowsWithEarnings: ReportRow[] = data.rows.map((r) => {
    const earningsScore = computeEarningsScore(r, earningsRanges)
    const vulnerabilityScore = computeVulnerabilityScore(r.opportunityScore, earningsScore)
    return {
      ...r,
      earningsScore,
      vulnerabilityScore,
    }
  })

  const sortedByVuln = [...rowsWithEarnings].sort((a, b) => b.vulnerabilityScore - a.vulnerabilityScore)
  const topByCreToCapital = [...rowsWithEarnings]
    .filter((r) => r.capitalRatios?.creToTier1Tier2 != null && r.capitalRatios!.creToTier1Tier2! > 0)
    .sort((a, b) => (b.capitalRatios!.creToTier1Tier2 ?? 0) - (a.capitalRatios!.creToTier1Tier2 ?? 0))
    .slice(0, 25)
  const topByOpportunityScore = sortedByVuln.slice(0, 25)

  return {
    ...data,
    rows: sortedByVuln,
    topByCreToCapital,
    topByOpportunityScore,
  }
}
