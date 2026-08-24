/**
 * Stress score computation for the Bank Stress Heat Map.
 *
 * Shares its weights and its percentile ranking with the screening table via
 * `lib/scoring/opportunity-score`, so the map and the table cannot drift apart.
 *
 * One input genuinely differs and is the reason the two were separate: the
 * table's capital slot holds CET1, where a *smaller* number means more stress,
 * while the map's holds CRE-to-(Tier 1 + Tier 2), where a *larger* number does.
 * Keeping both copies meant the map inherited the table's inversion and ranked
 * the least concentrated banks as the most stressed.
 */

import {
  computeEarningsScore,
  computeEarningsRanges,
} from "@/lib/scoring/earnings-score"
import { computeVulnerabilityScore } from "@/lib/scoring/vulnerability-score"
import {
  percentileRank,
  OPPORTUNITY_WEIGHTS,
} from "@/lib/scoring/opportunity-score"
import type { BankFinancialData } from "@/lib/fdic-data-transformer"
import { computeCapitalRatios } from "@/lib/fdic-ratio-helpers"

export type MapMetric =
  | "composite"
  | "creCapital"
  | "npl"
  | "reserve"
  | "chargeoffs"

export interface BankWithStress extends BankFinancialData {
  stressScore: number
  structuralScore: number
  earningsScore: number
  creToCapital?: number
  nplRatio: number
  loanLossReserve: number
  noncurrent_to_loans_ratio: number
  noncurrent_to_assets_ratio: number
}

function sortedFinite(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
}

/** CRE-to-(Tier 1 + Tier 2) as percent points, or 0 when it cannot be derived. */
function creToCapitalPct(b: BankFinancialData): number {
  const ratios = computeCapitalRatios({
    totalAssets: b.totalAssets,
    creLoans: b.creLoans ?? 0,
    constructionLoans: b.constructionLoans ?? 0,
    multifamilyLoans: b.multifamilyLoans ?? 0,
    leverageRatio: b.leverageRatio,
    tier1RbcRatio: b.tier1RbcRatio,
    totalRbcRatio: b.totalRbcRatio,
    cet1Ratio: b.cet1Ratio,
    totalEquityDollars: b.totalEquityDollars,
    tier1Dollars: b.tier1Dollars,
    tier2Dollars: b.tier2Dollars,
    riskWeightedAssets: b.riskWeightedAssets,
  })
  return ratios?.creToTier1Tier2 != null ? ratios.creToTier1Tier2 * 100 : 0
}

function earningsInputOf(b: BankFinancialData) {
  return {
    earningsBufferPct:
      b.totalAssets > 0 && (b.creLoans ?? 0) > 0 && b.netIncome != null
        ? (b.netIncome / (b.creLoans ?? 1)) * 100
        : null,
    roaLatest: b.roa,
    roaDelta4Q: null,
    netIncomeYoYPct: null,
  }
}

export function computeStressScores(
  banks: BankFinancialData[],
  metric: MapMetric = "composite"
): BankWithStress[] {
  // Capital ratios are expensive and were previously derived twice per bank —
  // once to build the range and once to score. Derive once and reuse.
  const capitalPcts = banks.map(creToCapitalPct)

  const dist = {
    cre: sortedFinite(banks.map((b) => b.creConcentration || 0)),
    npl: sortedFinite(banks.map((b) => (b.noncurrent_to_loans_ratio ?? 0) * 100)),
    reserve: sortedFinite(banks.map((b) => (b.loanLossReserve ?? 0) * 100)),
    capital: sortedFinite(capitalPcts),
  }

  // Hoisted out of the per-bank loop, where it rebuilt the whole cohort's
  // ranges once per bank and made this quadratic.
  const earningsRanges = computeEarningsRanges(banks.map(earningsInputOf))

  return banks.map((bank, i) => {
    const crePct = percentileRank(dist.cre, bank.creConcentration || 0)
    const nplPct = percentileRank(dist.npl, (bank.noncurrent_to_loans_ratio ?? 0) * 100)
    const reservePct = percentileRank(dist.reserve, (bank.loanLossReserve ?? 0) * 100)
    const capitalPct = percentileRank(dist.capital, capitalPcts[i])

    // Thin reserves mean stress, so that one inverts. CRE-to-capital does not:
    // a higher multiple is more concentration and more stress.
    const structuralRaw =
      crePct * OPPORTUNITY_WEIGHTS.cre +
      nplPct * OPPORTUNITY_WEIGHTS.npl +
      (1 - reservePct) * OPPORTUNITY_WEIGHTS.reserve +
      capitalPct * OPPORTUNITY_WEIGHTS.capital

    const structural = Number((structuralRaw * 100).toFixed(1))
    const earningsScore = computeEarningsScore(earningsInputOf(bank), earningsRanges)
    const vulnerabilityScore = computeVulnerabilityScore(structural, earningsScore)

    let stressScore: number
    switch (metric) {
      case "creCapital":
        stressScore = Number((capitalPct * 100).toFixed(1))
        break
      case "npl":
      case "chargeoffs":
        stressScore = Number((nplPct * 100).toFixed(1))
        break
      case "reserve":
        // Labelled "Reserve Coverage" in the UI: a level, so higher is better
        // reserved rather than more stressed.
        stressScore = Number((reservePct * 100).toFixed(1))
        break
      default:
        stressScore = vulnerabilityScore
    }

    return {
      ...bank,
      stressScore: Math.min(100, Math.max(0, stressScore)),
      structuralScore: structural,
      earningsScore,
      creToCapital: capitalPcts[i] > 0 ? capitalPcts[i] : undefined,
      nplRatio: bank.nplRatio ?? 0,
      loanLossReserve: bank.loanLossReserve ?? 0,
      noncurrent_to_loans_ratio: bank.noncurrent_to_loans_ratio ?? 0,
      noncurrent_to_assets_ratio: bank.noncurrent_to_assets_ratio ?? 0,
    }
  })
}
