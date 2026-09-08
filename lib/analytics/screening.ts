/**
 * The Market Analytics screening reduction.
 *
 * This used to run in the browser: the tab fetched roughly ten thousand raw
 * FDIC rows — nine or ten quarters of history for about eleven hundred
 * institutions — shipped all 10.8MB of it across the server-action boundary,
 * and collapsed it to one row per institution in a `useMemo`. Every visitor
 * paid the full FDIC round trip, because a response that large cannot go in the
 * Next data cache and so was fetched with `cache: "no-store"` every time.
 *
 * Running the reduction here instead makes the result small enough to cache:
 * 1.26MB against a 2MB ceiling. Two things get it under the line, and both are
 * load-bearing rather than incidental tidying:
 *
 *  - only fields something actually renders are kept. The capital *dollar*
 *    inputs exist solely to produce `capitalRatios`, and the `CapitalRatios`
 *    internals (`tier1Capital`, `coverage`, `basis` and the rest) are never
 *    read by the table or the drawer, so none of them travel;
 *  - each trend quarter keeps only the two series that are charted. It carried
 *    five, and `trend` was the single heaviest field on the row at 627 bytes.
 *
 * Numbers are rounded for transport at the very end, after ranking. Doing it
 * before would let rounding create ties in the percentile scores.
 *
 * **The headroom is finite and worth respecting.** Next enforces the ceiling as
 * `JSON.stringify(entry).length > 2 * 1024 * 1024` (see
 * `next/dist/server/lib/incremental-cache/index.js`), and 1.26MB of that is
 * spent. Adding a field costs about 1KB per hundred institutions, but the real
 * cliff is the cohort: closing the national coverage gap to all ~4,450
 * institutions projects to about 5.5MB, which does not fit and would need a
 * different store rather than more trimming. `npm run verify:screening-parity`
 * prints the current payload size on every run, so a regression is visible.
 */

import { computeCapitalRatios } from "@/lib/fdic-ratio-helpers"
import type { BankFinancialData } from "@/lib/fdic-data-transformer"
import {
  computeOpportunityDistributions,
  computeOpportunityScore,
} from "@/lib/scoring/opportunity-score"
import { computeEarningsRanges, computeEarningsScore } from "@/lib/scoring/earnings-score"
import { computeVulnerabilityScore } from "@/lib/scoring/vulnerability-score"

/**
 * Row cap for the tab's single-page FDIC fetch. Eight to ten quarters per
 * institution means this covers roughly 1,100 institutions nationally; state
 * scopes are far smaller than the cap and so are complete.
 *
 * Lives here rather than beside the server action because a `"use server"`
 * module may only export async functions.
 */
export const TAB_ROW_CAP = 10000

/** Quarters kept for the on-screen sparklines. */
const TREND_QUARTERS = 4
/** Quarters needed for the trailing-twelve-month year-over-year comparison. */
const QUARTER_WINDOW = 8

export type ScreeningTrendPoint = {
  reportDate: string
  creConcentration?: number
  nplRatio?: number
}

/** Only the four ratios the table and drawer display. */
export type ScreeningCapitalRatios = {
  creToTier1Tier2: number | null
  creToEquity: number | null
  constructionToTier1Tier2: number | null
  multifamilyToTier1Tier2: number | null
}

export type ScreeningRow = {
  id: string
  name: string
  city?: string
  state?: string
  reportDate?: string
  totalAssets: number
  totalLoans?: number
  creLoans?: number
  creConcentration?: number
  nonaccrualLoans?: number
  nplRatio?: number
  noncurrent_to_loans_ratio?: number
  noncurrent_to_assets_ratio?: number
  pastDue3090?: number
  pastDue90Plus?: number
  loanLossReserve?: number
  loansToDeposits?: number
  cet1Ratio?: number | null
  leverageRatio?: number | null
  totalUnusedCommitments?: number
  creUnusedCommitments?: number
  constructionLoans?: number
  multifamilyLoans?: number
  nonResidentialLoans?: number
  ownerOccupiedLoans?: number
  nonOwnerOccupiedLoans?: number
  roaLatest?: number | null
  roaDelta4Q?: number | null
  netIncomeTTM?: number | null
  netIncomeYoYPct?: number | null
  nimLatest?: number | null
  nimDelta4Q?: number | null
  earningsBufferPct?: number | null
  opportunityScore: number
  earningsScore: number
  vulnerabilityScore: number
  capitalRatios?: ScreeningCapitalRatios
  trend: ScreeningTrendPoint[]
}

export type ScreeningNplSummary = {
  totalLoans: number
  totalNpl: number
  totalCre: number
  totalAssets: number
  avgNpl: number
  avgCreToAssets: number
  count: number
}

export type ScreeningKpis = {
  institutionsScreened: number
  avgNplRatio: number
  avgNoncurrentToLoans: number
  avgReserveCoverage: number
  avgCreConcentration: number
}

export type ScreeningPayload = {
  rows: ScreeningRow[]
  kpis: ScreeningKpis
  nplSummary: ScreeningNplSummary | null
  /** Newest first, as FDIC reports them, at most eight. */
  quarters: string[]
  /** The four the sparklines label. */
  quartersDisplay: string[]
  /** Raw rows the FDIC returned, so the tab can tell whether it hit the cap. */
  rawRowCount: number
}

export function normalizeReportDate(dateStr: string | undefined): string {
  if (!dateStr) return ""
  if (/^\d{8}$/.test(dateStr)) return dateStr
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[1] + m[2] + m[3]
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}${mo}${day}`
}

/**
 * Six significant figures. Every value here is displayed to at most two decimal
 * places, and the smallest meaningful one is a ratio in the 1e-4 range, so this
 * cannot move a rendered figure.
 */
function roundForTransport<T>(value: T): T {
  if (typeof value === "number") {
    return (Number.isFinite(value) ? Number(value.toPrecision(6)) : value) as T
  }
  if (Array.isArray(value)) return value.map(roundForTransport) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = roundForTransport(v)
    return out as T
  }
  return value
}

const average = (values: number[]) =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

/**
 * Collapse multi-quarter FDIC rows into one scored row per institution.
 *
 * `scope` is the state name, or undefined for national. The fetch is already
 * scoped, so this filter is a safeguard against a stray row rather than the
 * primary mechanism.
 */
export function buildScreeningPayload(
  financials: BankFinancialData[],
  scope?: string
): ScreeningPayload {
  const inScope = scope
    ? financials.filter((f) => f.state && f.state.toUpperCase() === scope.toUpperCase())
    : financials

  const quarters = Array.from(
    new Set(inScope.map((item) => item.reportDate).filter((d): d is string => Boolean(d)))
  )
    .sort((a, b) => normalizeReportDate(b).localeCompare(normalizeReportDate(a)))
    .slice(0, QUARTER_WINDOW)
  const quartersDisplay = quarters.slice(0, TREND_QUARTERS)

  const withinWindow = inScope.filter(
    (item) => quarters.length === 0 || !item.reportDate || quarters.includes(item.reportDate)
  )

  // The latest row per institution, used by the KPI cards and the NPL summary.
  const latestById = new Map<string, BankFinancialData>()
  for (const item of withinWindow) {
    const existing = latestById.get(item.id)
    const existingDate = existing?.reportDate ? Date.parse(existing.reportDate) : 0
    const nextDate = item.reportDate ? Date.parse(item.reportDate) : 0
    if (!existing || nextDate > existingDate) latestById.set(item.id, item)
  }
  const latestRows = Array.from(latestById.values())

  const nplSummary: ScreeningNplSummary | null =
    latestRows.length === 0
      ? null
      : (() => {
          const totalAssets = latestRows.reduce((s, i) => s + i.totalAssets, 0)
          const totalCre = latestRows.reduce((s, i) => s + (i.creLoans ?? 0), 0)
          return {
            totalLoans: latestRows.reduce((s, i) => s + (i.totalLoans ?? 0), 0),
            totalNpl: latestRows.reduce((s, i) => s + (i.nonaccrualLoans ?? 0), 0),
            totalCre,
            totalAssets,
            avgNpl: average(latestRows.map((i) => (i.nplRatio ?? 0) * 100)),
            avgCreToAssets: totalAssets > 0 ? (totalCre / totalAssets) * 100 : 0,
            count: latestRows.length,
          }
        })()

  const kpis: ScreeningKpis = {
    institutionsScreened: latestRows.length,
    avgNplRatio: average(latestRows.map((i) => i.nplRatio || 0)),
    avgNoncurrentToLoans: average(latestRows.map((i) => (i.noncurrent_to_loans_ratio ?? 0) * 100)),
    avgReserveCoverage: average(latestRows.map((i) => i.loanLossReserve || 0)),
    avgCreConcentration: average(latestRows.map((i) => i.creConcentration || 0)),
  }

  const grouped = new Map<string, BankFinancialData[]>()
  for (const item of withinWindow) {
    if (!grouped.has(item.id)) grouped.set(item.id, [])
    grouped.get(item.id)!.push(item)
  }

  const mostRecentNorm = normalizeReportDate(quarters[0])
  type Unscored = Omit<ScreeningRow, "opportunityScore" | "earningsScore" | "vulnerabilityScore">
  const rows: Unscored[] = []

  for (const items of grouped.values()) {
    const byDateNorm = new Map(items.map((entry) => [normalizeReportDate(entry.reportDate), entry]))
    // An institution that did not file for the quarter the tab is headed with
    // is dropped rather than shown with a stale figure under a current date.
    if (mostRecentNorm && !byDateNorm.has(mostRecentNorm)) continue
    const latest = mostRecentNorm
      ? byDateNorm.get(mostRecentNorm)!
      : [...items].sort((a, b) =>
          normalizeReportDate(b.reportDate).localeCompare(normalizeReportDate(a.reportDate))
        )[0]

    const trend: ScreeningTrendPoint[] = quartersDisplay.filter(Boolean).map((date) => {
      const entry = byDateNorm.get(normalizeReportDate(date))
      return {
        reportDate: date,
        creConcentration: entry?.creConcentration,
        nplRatio: entry?.nplRatio,
      }
    })

    const full = computeCapitalRatios({
      totalAssets: latest.totalAssets,
      creLoans: latest.creLoans ?? 0,
      constructionLoans: latest.constructionLoans ?? 0,
      multifamilyLoans: latest.multifamilyLoans ?? 0,
      leverageRatio: latest.leverageRatio,
      tier1RbcRatio: latest.tier1RbcRatio,
      totalRbcRatio: latest.totalRbcRatio,
      cet1Ratio: latest.cet1Ratio,
      totalEquityDollars: latest.totalEquityDollars,
      tier1Dollars: latest.tier1Dollars,
      tier2Dollars: latest.tier2Dollars,
      riskWeightedAssets: latest.riskWeightedAssets,
    })
    const capitalRatios: ScreeningCapitalRatios = {
      creToTier1Tier2: full.creToTier1Tier2,
      creToEquity: full.creToEquity,
      constructionToTier1Tier2: full.constructionToTier1Tier2,
      multifamilyToTier1Tier2: full.multifamilyToTier1Tier2,
    }

    const q3 = quarters[3]
    const roaLatest = latest.roa != null ? latest.roa : null
    const priorRoa = q3 != null ? byDateNorm.get(normalizeReportDate(q3))?.roa : undefined
    const roaDelta4Q =
      quarters.length >= 4 && roaLatest != null && priorRoa != null ? roaLatest - priorRoa : null

    const nimLatest = latest.netInterestMargin != null ? latest.netInterestMargin : null
    const priorNim = q3 != null ? byDateNorm.get(normalizeReportDate(q3))?.netInterestMargin : undefined
    const nimDelta4Q =
      quarters.length >= 4 && nimLatest != null && priorNim != null ? nimLatest - priorNim : null

    const niCurrent4 = quarters
      .slice(0, 4)
      .map((d) => byDateNorm.get(normalizeReportDate(d))?.netIncome)
    const hasAll4 = niCurrent4.length === 4 && niCurrent4.every((v) => v != null && Number.isFinite(v))
    const netIncomeTTM = hasAll4 ? (niCurrent4.reduce((s, v) => s! + v!, 0) as number) : null

    const niPrior4 = quarters
      .slice(4, 8)
      .map((d) => byDateNorm.get(normalizeReportDate(d))?.netIncome)
    const hasAll8 = niPrior4.length === 4 && niPrior4.every((v) => v != null && Number.isFinite(v))
    const netIncomeTTMPrior = hasAll8 ? (niPrior4.reduce((s, v) => s! + v!, 0) as number) : null

    const netIncomeYoYPct =
      netIncomeTTM != null && netIncomeTTMPrior != null && Math.abs(netIncomeTTMPrior) !== 0
        ? ((netIncomeTTM - netIncomeTTMPrior) / Math.abs(netIncomeTTMPrior)) * 100
        : null

    const creLoansLatest = latest.creLoans ?? 0
    const earningsBufferPct =
      netIncomeTTM != null && creLoansLatest > 0 ? (netIncomeTTM / creLoansLatest) * 100 : null

    rows.push({
      id: latest.id,
      name: latest.name,
      city: latest.city,
      state: latest.state,
      reportDate: latest.reportDate,
      totalAssets: latest.totalAssets,
      totalLoans: latest.totalLoans,
      creLoans: latest.creLoans,
      creConcentration: latest.creConcentration,
      nonaccrualLoans: latest.nonaccrualLoans,
      nplRatio: latest.nplRatio,
      noncurrent_to_loans_ratio: latest.noncurrent_to_loans_ratio,
      noncurrent_to_assets_ratio: latest.noncurrent_to_assets_ratio,
      pastDue3090: latest.pastDue3090,
      pastDue90Plus: latest.pastDue90Plus,
      loanLossReserve: latest.loanLossReserve,
      loansToDeposits: latest.loansToDeposits,
      cet1Ratio: latest.cet1Ratio,
      leverageRatio: latest.leverageRatio,
      totalUnusedCommitments: latest.totalUnusedCommitments,
      creUnusedCommitments: latest.creUnusedCommitments,
      constructionLoans: latest.constructionLoans,
      multifamilyLoans: latest.multifamilyLoans,
      nonResidentialLoans: latest.nonResidentialLoans,
      ownerOccupiedLoans: latest.ownerOccupiedLoans,
      nonOwnerOccupiedLoans: latest.nonOwnerOccupiedLoans,
      roaLatest,
      roaDelta4Q,
      netIncomeTTM,
      netIncomeYoYPct,
      nimLatest,
      nimDelta4Q,
      earningsBufferPct,
      capitalRatios,
      trend,
    })
  }

  // Every score below ranks a row against the cohort in view, so the same
  // institution scores differently nationally than within its state. That is
  // intended: the question is always "compared with what".
  const opportunityInputs = rows.map((r) => ({
    creConcentration: r.creConcentration,
    noncurrentToLoansRatio: r.noncurrent_to_loans_ratio,
    loanLossReserve: r.loanLossReserve,
    cet1Ratio: r.cet1Ratio,
    leverageRatio: r.leverageRatio,
  }))
  const distributions = computeOpportunityDistributions(opportunityInputs)

  const earningsInputs = rows.map((r) => ({
    earningsBufferPct: r.earningsBufferPct ?? null,
    roaLatest: r.roaLatest ?? null,
    roaDelta4Q: r.roaDelta4Q ?? null,
    netIncomeYoYPct: r.netIncomeYoYPct ?? null,
  }))
  const earningsRanges = computeEarningsRanges(earningsInputs)

  const scored: ScreeningRow[] = rows.map((row, i) => {
    const opportunityScore = computeOpportunityScore(opportunityInputs[i], distributions)
    const earningsScore = computeEarningsScore(earningsInputs[i], earningsRanges)
    return {
      ...row,
      opportunityScore,
      earningsScore,
      vulnerabilityScore: computeVulnerabilityScore(opportunityScore, earningsScore),
    }
  })

  return roundForTransport({
    rows: scored,
    kpis,
    nplSummary,
    quarters,
    quartersDisplay,
    rawRowCount: financials.length,
  })
}
