import "server-only"
import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { fetchExitRecords } from "@/app/services/fdic-structure-events"
import { computeCapitalRatios } from "@/lib/fdic-ratio-helpers"
import type { BankFinancialData } from "@/lib/fdic-data-transformer"
import {
  MAX_EXITS,
  partitionCohort,
  resolveExits,
  type CohortWatch,
  type WatchInputRow,
} from "@/lib/analytics/cohort-watch"

/** Matches the screening tab, so the watch and the table see the same cohort. */
const ROW_CAP = 10000

function toInput(row: BankFinancialData): WatchInputRow {
  const ratios = computeCapitalRatios({
    totalAssets: row.totalAssets,
    creLoans: row.creLoans ?? 0,
    constructionLoans: row.constructionLoans ?? 0,
    multifamilyLoans: row.multifamilyLoans ?? 0,
    leverageRatio: row.leverageRatio,
    tier1RbcRatio: row.tier1RbcRatio,
    totalRbcRatio: row.totalRbcRatio,
    cet1Ratio: row.cet1Ratio,
    totalEquityDollars: row.totalEquityDollars,
    tier1Dollars: row.tier1Dollars,
    tier2Dollars: row.tier2Dollars,
    riskWeightedAssets: row.riskWeightedAssets,
  })
  return {
    id: String(row.id ?? ""),
    name: row.name,
    city: row.city,
    state: row.state,
    reportDate: row.reportDate,
    totalAssets: row.totalAssets,
    creLoans: row.creLoans,
    constructionLoans: row.constructionLoans,
    multifamilyLoans: row.multifamilyLoans,
    noncurrent_to_loans_ratio: row.noncurrent_to_loans_ratio,
    loanLossReserve: row.loanLossReserve,
    cet1Ratio: row.cet1Ratio,
    leverageRatio: row.leverageRatio,
    tier1RbcRatio: row.tier1RbcRatio,
    totalRbcRatio: row.totalRbcRatio,
    totalEquityDollars: row.totalEquityDollars,
    creToTier1Tier2: ratios?.creToTier1Tier2 ?? null,
    constructionToTier1Tier2: ratios?.constructionToTier1Tier2 ?? null,
  }
}

const EMPTY = (scope: string, error?: string): CohortWatch => ({
  scope,
  asOfQuarter: null,
  institutionCount: 0,
  capped: false,
  deteriorating: [],
  deterioratingCount: 0,
  exits: [],
  exitsCount: 0,
  exitsOlder: 0,
  error,
})

/**
 * One FDIC financials round trip (the same one the screening table makes) plus
 * a few small structure-record requests for the exits. Uncached here; the
 * action caches by scope and quarter.
 */
export async function computeCohortWatch(scope: string): Promise<CohortWatch> {
  const state = scope === "National" || scope === "national" ? undefined : scope
  const { data, error } = await fetchFDICFinancials(state, ROW_CAP, false)
  if (error) return EMPTY(scope, error)
  if (!data.length) return EMPTY(scope)

  const inScope = state
    ? data.filter((r) => r.state && r.state.toUpperCase() === state.toUpperCase())
    : data
  const partition = partitionCohort(inScope.map(toInput))

  const records = await fetchExitRecords(partition.exitCandidates.map((c) => c.cert))
  const exits = resolveExits(partition.exitCandidates, records)

  return {
    scope,
    asOfQuarter: partition.asOfQuarter || null,
    institutionCount: partition.institutionCount,
    capped: data.length >= ROW_CAP,
    deteriorating: partition.watched,
    deterioratingCount: partition.deterioratingCount,
    exits: exits.slice(0, MAX_EXITS),
    exitsCount: exits.length,
    exitsOlder: partition.exitsOlder,
  }
}
