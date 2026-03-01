"use server"

import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { computeCapitalRatios, type CapitalRatios } from "@/lib/fdic-ratio-helpers"
import {
  computeDispersionStats,
  buildDispersionNarrative,
  type DispersionStats,
} from "@/lib/opportunity-score-dispersion"
import type { BankFinancialData } from "@/lib/fdic-data-transformer"

const SCENARIO_WEIGHTS = { cre: 0.35, npl: 0.35, reserve: 0.15, capital: 0.15, capitalInvert: true }

export type ExportRow = {
  id: string
  name: string
  city?: string
  state?: string
  totalAssets: number
  creLoans: number
  constructionLoans: number
  multifamilyLoans: number
  nonResidentialLoans?: number
  otherRealEstateLoans?: number
  totalUnusedCommitments?: number
  creUnusedCommitments?: number
  creConcentration?: number
  nplRatio?: number
  noncurrent_to_loans_ratio?: number
  noncurrent_to_assets_ratio?: number
  loanLossReserve?: number
  opportunityScore: number
  capitalRatios?: CapitalRatios
  cet1Ratio?: number
  leverageRatio?: number
  /** For earnings score: ROA latest quarter */
  roa?: number
  /** For earnings score: ROA change vs 4Q ago (pp) */
  roaDelta4Q?: number | null
  /** For earnings score: TTM net income */
  netIncomeTTM?: number | null
  /** For earnings score: YoY % change in TTM net income */
  netIncomeYoYPct?: number | null
  /** For earnings score: TTM net income / CRE loans * 100 */
  earningsBufferPct?: number | null
}

export type SummaryByStateRow = {
  state: string
  totalAssets: number
  creLoans: number
  constructionLoans: number
  multifamilyLoans: number
  nonResidentialLoans: number
  otherRealEstateLoans: number
  totalUnusedCommitments: number
  creUnusedCommitments: number
  bankCount: number
  weightedAvgCreToAssets: number | null
  weightedAvgCreToCap: number | null
  weightedAvgNpl: number | null
}

export type ExportData = {
  scope: string
  date: string
  /** Latest FDIC quarter in view (e.g. "Q4 2024") */
  asOfQuarter: string
  rows: ExportRow[]
  summaryByState: SummaryByStateRow[]
  topByCreToCapital: ExportRow[]
  topByOpportunityScore: ExportRow[]
  capitalKpis: {
    avgCreToTier1Tier2: number | null
    avgCreToEquity: number | null
    coveragePct: number
  }
  kpis: { label: string; value: string }[]
  dispersionStats: DispersionStats
  dispersionNarrative: ReturnType<typeof buildDispersionNarrative>
}

function formatCurrency(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100)
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—"
  return String(value)
}

function formatRatio(value: number | null | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return value.toFixed(2) + "x"
}

/**
 * Build export data from FDIC financials.
 * Replicates screening table + executive pack logic for server-side export.
 */
export async function buildExportData(scope: string): Promise<ExportData> {
  const stateFilter = scope === "National" ? undefined : scope
  const fetchAll = true
  const { data: financials } = await fetchFDICFinancials(stateFilter, 500, fetchAll)

  const regionFinancials = financials.filter((item: BankFinancialData) => {
    if (!stateFilter) return true
    return item.state && item.state.toUpperCase() === stateFilter.toUpperCase()
  }) as BankFinancialData[]

  const lastQuarterDates = Array.from(
    new Set(regionFinancials.map((item) => item.reportDate).filter(Boolean))
  ) as string[]
  const sortedQuarterDates = lastQuarterDates.sort((a, b) => (a < b ? 1 : -1)).slice(0, 8)

  const filteredFinancials = regionFinancials.filter((item) => {
    if (sortedQuarterDates.length > 0 && item.reportDate && !sortedQuarterDates.includes(item.reportDate)) return false
    return true
  })

  const grouped = new Map<string, BankFinancialData[]>()
  filteredFinancials.forEach((item) => {
    if (!grouped.has(item.id)) grouped.set(item.id, [])
    grouped.get(item.id)!.push(item)
  })

  const rows: ExportRow[] = []
  grouped.forEach((items) => {
    const sorted = [...items].sort((a, b) => {
      const aDate = a.reportDate ? Date.parse(a.reportDate) : 0
      const bDate = b.reportDate ? Date.parse(b.reportDate) : 0
      return bDate - aDate
    })
    const latest = sorted[0]
    const byDate = new Map(sorted.map((e) => [e.reportDate ?? "", e]))
    const q3 = sortedQuarterDates[3]
    const niCurrent4 = sortedQuarterDates.slice(0, 4).map((d) => byDate.get(d)?.netIncome)
    const hasAll4 = niCurrent4.length === 4 && niCurrent4.every((v) => v != null && Number.isFinite(v))
    const netIncomeTTM = hasAll4 ? (niCurrent4.reduce((s, v) => s! + v!, 0) as number) : null
    const niPrior4 = sortedQuarterDates.slice(4, 8).map((d) => byDate.get(d)?.netIncome)
    const hasAll8 = niPrior4.length === 4 && niPrior4.every((v) => v != null && Number.isFinite(v))
    const netIncomeTTMPrior = hasAll8 ? (niPrior4.reduce((s, v) => s! + v!, 0) as number) : null
    const netIncomeYoYPct =
      netIncomeTTM != null && netIncomeTTMPrior != null
        ? (() => {
            const denom = Math.abs(netIncomeTTMPrior)
            if (denom === 0) return null
            return ((netIncomeTTM - netIncomeTTMPrior) / denom) * 100
          })()
        : null
    const roaLatest = latest.roa != null ? latest.roa : null
    const roa4QAgo = q3 && byDate.get(q3)?.roa != null ? byDate.get(q3)!.roa : null
    const roaDelta4Q = roaLatest != null && roa4QAgo != null ? roaLatest - roa4QAgo : null
    const creLoansLatest = latest.creLoans ?? 0
    const earningsBufferPct = netIncomeTTM != null && creLoansLatest > 0 ? (netIncomeTTM / creLoansLatest) * 100 : null

    const capitalRatio = latest.cet1Ratio ?? latest.leverageRatio ?? 0
    const capitalRatios = computeCapitalRatios({
      totalAssets: latest.totalAssets,
      creLoans: latest.creLoans ?? 0,
      constructionLoans: latest.constructionLoans ?? 0,
      multifamilyLoans: latest.multifamilyLoans ?? 0,
      leverageRatio: latest.leverageRatio,
      tier1RbcRatio: latest.tier1RbcRatio,
      totalRbcRatio: latest.totalRbcRatio,
      cet1Ratio: latest.cet1Ratio,
      totalEquityDollars: latest.totalEquityDollars,
    })
    rows.push({
      id: latest.id,
      name: latest.name,
      city: latest.city,
      state: latest.state,
      totalAssets: latest.totalAssets,
      creLoans: latest.creLoans ?? 0,
      constructionLoans: latest.constructionLoans ?? 0,
      multifamilyLoans: latest.multifamilyLoans ?? 0,
      nonResidentialLoans: latest.nonResidentialLoans ?? 0,
      otherRealEstateLoans: latest.otherRealEstateLoans ?? 0,
      totalUnusedCommitments: latest.totalUnusedCommitments ?? 0,
      creUnusedCommitments: latest.creUnusedCommitments ?? 0,
      creConcentration: latest.creConcentration,
      nplRatio: latest.nplRatio,
      noncurrent_to_loans_ratio: latest.noncurrent_to_loans_ratio,
      noncurrent_to_assets_ratio: latest.noncurrent_to_assets_ratio,
      loanLossReserve: latest.loanLossReserve,
      opportunityScore: 0,
      capitalRatios,
      cet1Ratio: latest.cet1Ratio,
      leverageRatio: latest.leverageRatio,
      roa: latest.roa,
      roaDelta4Q,
      netIncomeTTM,
      netIncomeYoYPct,
      earningsBufferPct,
    })
  })

  const metricRange = (values: number[]) => {
    const filtered = values.filter((v) => Number.isFinite(v))
    const min = filtered.length ? Math.min(...filtered) : 0
    const max = filtered.length ? Math.max(...filtered) : 0
    return { min, max }
  }

  const creRange = metricRange(rows.map((r) => r.creConcentration || 0))
  const nplRange = metricRange(rows.map((r) => (r.noncurrent_to_loans_ratio ?? 0) * 100))
  const reserveRange = metricRange(rows.map((r) => (r.loanLossReserve ?? 0) * 100))
  const capitalRange = metricRange(rows.map((r) => r.cet1Ratio ?? r.leverageRatio ?? 0))

  const normalize = (value: number, range: { min: number; max: number }, invert = false) => {
    if (range.max === range.min) return 0
    const raw = (value - range.min) / (range.max - range.min)
    const score = invert ? 1 - raw : raw
    return Math.max(0, Math.min(1, score))
  }

  const capitalRatioValue = (r: ExportRow) => r.cet1Ratio ?? r.leverageRatio ?? 0

  const scored = rows.map((r) => {
    const creScore = normalize(r.creConcentration || 0, creRange)
    const nplScore = normalize((r.noncurrent_to_loans_ratio ?? 0) * 100, nplRange)
    const reserveScore = normalize((r.loanLossReserve ?? 0) * 100, reserveRange, true)
    const capVal = capitalRatioValue(r)
    const capitalScore = normalize(capVal, capitalRange, SCENARIO_WEIGHTS.capitalInvert)

    const total =
      creScore * SCENARIO_WEIGHTS.cre +
      nplScore * SCENARIO_WEIGHTS.npl +
      reserveScore * SCENARIO_WEIGHTS.reserve +
      capitalScore * SCENARIO_WEIGHTS.capital

    return { ...r, opportunityScore: Number((total * 100).toFixed(1)) }
  })

  const sortedRows = scored.sort((a, b) => b.opportunityScore - a.opportunityScore)

  const withCapital = sortedRows.filter((r) => r.capitalRatios?.coverage.hasTier1Tier2)
  const total = sortedRows.length
  const coveragePct = total > 0 ? (withCapital.length / total) * 100 : 0

  const assetWeighted = (values: { row: ExportRow; value: number | null }[]) => {
    const valid = values.filter((v) => v.value != null && Number.isFinite(v.value))
    if (valid.length === 0) return null
    const totalAssets = valid.reduce((s, v) => s + v.row.totalAssets, 0)
    if (totalAssets <= 0) return null
    return valid.reduce((s, v) => s + (v.value! * v.row.totalAssets) / totalAssets, 0)
  }

  const avgCreToTier1Tier2 = assetWeighted(
    sortedRows.map((r) => ({ row: r, value: r.capitalRatios?.creToTier1Tier2 ?? null }))
  )
  const avgCreToEquity = assetWeighted(
    sortedRows.map((r) => ({ row: r, value: r.capitalRatios?.creToEquity ?? null }))
  )

  const latestById = new Map<string, BankFinancialData>()
  filteredFinancials.forEach((item) => {
    const existing = latestById.get(item.id)
    const existingDate = existing?.reportDate ? Date.parse(existing.reportDate) : 0
    const nextDate = item.reportDate ? Date.parse(item.reportDate) : 0
    if (!existing || nextDate > existingDate) latestById.set(item.id, item)
  })
  const latest = Array.from(latestById.values())
  const average = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0

  const kpis = [
    { label: "Institutions Screened", value: formatNumber(latest.length) },
    { label: "Avg NPL Ratio", value: formatPercent(average(latest.map((i) => (i.nplRatio ?? 0) * 100))) },
    { label: "Avg Noncurrent / Loans", value: formatPercent(average(latest.map((i) => (i.noncurrent_to_loans_ratio ?? 0) * 100))) },
    { label: "Avg Reserve Coverage", value: formatPercent(average(latest.map((i) => (i.loanLossReserve ?? 0) * 100))) },
    { label: "Avg CRE Concentration", value: formatPercent(average(latest.map((i) => i.creConcentration || 0))) },
  ]

  let summaryByState: SummaryByStateRow[] = []
  if (scope === "National") {
    const byState = new Map<
      string,
      { totalAssets: number; creLoans: number; constructionLoans: number; multifamilyLoans: number; nonResidentialLoans: number; otherRealEstateLoans: number; totalUnusedCommitments: number; creUnusedCommitments: number; nplSum: number; nplWeight: number; creToCapSum: number; creToCapWeight: number; count: number }
    >()
    sortedRows.forEach((row) => {
      const state = row.state || "Unknown"
      const existing = byState.get(state) ?? {
        totalAssets: 0,
        creLoans: 0,
        constructionLoans: 0,
        multifamilyLoans: 0,
        nonResidentialLoans: 0,
        otherRealEstateLoans: 0,
        totalUnusedCommitments: 0,
        creUnusedCommitments: 0,
        nplSum: 0,
        nplWeight: 0,
        creToCapSum: 0,
        creToCapWeight: 0,
        count: 0,
      }
      existing.totalAssets += row.totalAssets
      existing.creLoans += row.creLoans
      existing.constructionLoans += row.constructionLoans
      existing.multifamilyLoans += row.multifamilyLoans
      existing.nonResidentialLoans += row.nonResidentialLoans ?? 0
      existing.otherRealEstateLoans += row.otherRealEstateLoans ?? 0
      existing.totalUnusedCommitments += row.totalUnusedCommitments ?? 0
      existing.creUnusedCommitments += row.creUnusedCommitments ?? 0
      existing.count += 1
      const npl = row.nplRatio ?? 0
      existing.nplSum += npl * row.totalAssets
      existing.nplWeight += row.totalAssets
      const cr = row.capitalRatios?.creToTier1Tier2
      if (cr != null && row.capitalRatios?.coverage.hasTier1Tier2) {
        existing.creToCapSum += cr * row.totalAssets
        existing.creToCapWeight += row.totalAssets
      }
      byState.set(state, existing)
    })
    summaryByState = Array.from(byState.entries())
      .map(([state, data]) => ({
        state,
        totalAssets: data.totalAssets,
        creLoans: data.creLoans,
        constructionLoans: data.constructionLoans,
        multifamilyLoans: data.multifamilyLoans,
        nonResidentialLoans: data.nonResidentialLoans,
        otherRealEstateLoans: data.otherRealEstateLoans,
        totalUnusedCommitments: data.totalUnusedCommitments,
        creUnusedCommitments: data.creUnusedCommitments,
        bankCount: data.count,
        weightedAvgCreToAssets: data.totalAssets > 0 ? (data.creLoans / data.totalAssets) * 100 : null,
        weightedAvgCreToCap: data.creToCapWeight > 0 ? data.creToCapSum / data.creToCapWeight : null,
        weightedAvgNpl: data.nplWeight > 0 ? data.nplSum / data.nplWeight : null,
      }))
      .sort((a, b) => a.state.localeCompare(b.state))
  }

  const scores = sortedRows.map((r) => r.opportunityScore)
  const dispersionStats = computeDispersionStats(scores)
  const dispersionNarrative = buildDispersionNarrative(dispersionStats)

  const topByCreToCapital = sortedRows
    .filter((r) => r.capitalRatios?.creToTier1Tier2 != null && r.capitalRatios!.creToTier1Tier2! > 0)
    .sort((a, b) => (b.capitalRatios!.creToTier1Tier2 ?? 0) - (a.capitalRatios!.creToTier1Tier2 ?? 0))
    .slice(0, 25)

  const topByOpportunityScore = sortedRows.slice(0, 25)

  const date = new Date().toISOString().slice(0, 10)

  const reportDates = Array.from(new Set(filteredFinancials.map((i) => i.reportDate).filter(Boolean))) as string[]
  const latestReportDate = reportDates.sort((a, b) => (a < b ? 1 : -1))[0]
  const asOfQuarter =
    latestReportDate && /^\d{8}$/.test(latestReportDate)
      ? `Q${Math.ceil(Number(latestReportDate.slice(4, 6)) / 3)} ${latestReportDate.slice(0, 4)}`
      : date

  return {
    scope,
    date,
    asOfQuarter,
    rows: sortedRows,
    summaryByState,
    topByCreToCapital,
    topByOpportunityScore,
    capitalKpis: {
      avgCreToTier1Tier2,
      avgCreToEquity,
      coveragePct,
    },
    kpis,
    dispersionStats,
    dispersionNarrative,
  }
}
