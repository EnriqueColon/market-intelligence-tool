"use server"

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
 * Build full report data with earnings and vulnerability scores.
 * Used for financial-report-grade PDF rendering.
 */
export async function buildReportData(scope: string): Promise<ReportData> {
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
