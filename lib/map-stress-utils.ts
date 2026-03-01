/**
 * Stress score computation for Bank Stress Heat Map.
 * Reuses the same logic as Market Analytics (opportunity score + vulnerability).
 */

import {
  computeEarningsScore,
  computeEarningsRanges,
} from "@/lib/scoring/earnings-score"
import { computeVulnerabilityScore } from "@/lib/scoring/vulnerability-score"
import type { BankFinancialData } from "@/lib/fdic-data-transformer"
import { computeCapitalRatios } from "@/lib/fdic-ratio-helpers"

export type MapMetric =
  | "composite"
  | "creCapital"
  | "npl"
  | "reserve"
  | "chargeoffs"

const SCENARIO_WEIGHTS = {
  cre: 0.35,
  npl: 0.35,
  reserve: 0.15,
  capital: 0.15,
  capitalInvert: true,
} as const

function metricRange(values: number[]) {
  const filtered = values.filter((v) => Number.isFinite(v))
  const min = filtered.length ? Math.min(...filtered) : 0
  const max = filtered.length ? Math.max(...filtered) : 0
  return { min, max }
}

function normalize(
  value: number,
  range: { min: number; max: number },
  invert = false
) {
  if (range.max === range.min) return 0
  const raw = (value - range.min) / (range.max - range.min)
  const score = invert ? 1 - raw : raw
  return Math.max(0, Math.min(1, score))
}

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

export function computeStressScores(
  banks: BankFinancialData[],
  metric: MapMetric = "composite"
): BankWithStress[] {
  const creRange = metricRange(banks.map((b) => b.creConcentration || 0))
  const nplRange = metricRange(banks.map((b) => (b.noncurrent_to_loans_ratio ?? 0) * 100))
  const reserveRange = metricRange(banks.map((b) => (b.loanLossReserve ?? 0) * 100))
  const capitalRange = metricRange(
    banks.map((b) => {
      const cr = computeCapitalRatios({
        totalAssets: b.totalAssets,
        creLoans: b.creLoans ?? 0,
        constructionLoans: b.constructionLoans ?? 0,
        multifamilyLoans: b.multifamilyLoans ?? 0,
        leverageRatio: b.leverageRatio,
        tier1RbcRatio: b.tier1RbcRatio,
        totalRbcRatio: b.totalRbcRatio,
        cet1Ratio: b.cet1Ratio,
        totalEquityDollars: b.totalEquityDollars,
      })
      return cr?.creToTier1Tier2 != null ? cr.creToTier1Tier2 * 100 : 0
    })
  )

  const scored = banks.map((bank) => {
    const creScore = normalize(bank.creConcentration || 0, creRange)
    const nplScore = normalize((bank.noncurrent_to_loans_ratio ?? 0) * 100, nplRange)
    const reserveScore = normalize((bank.loanLossReserve ?? 0) * 100, reserveRange, true)
    const capitalVal =
      computeCapitalRatios({
        totalAssets: bank.totalAssets,
        creLoans: bank.creLoans ?? 0,
        constructionLoans: bank.constructionLoans ?? 0,
        multifamilyLoans: bank.multifamilyLoans ?? 0,
        leverageRatio: bank.leverageRatio,
        tier1RbcRatio: bank.tier1RbcRatio,
        totalRbcRatio: bank.totalRbcRatio,
        cet1Ratio: bank.cet1Ratio,
        totalEquityDollars: bank.totalEquityDollars,
      })?.creToTier1Tier2 ?? 0
    const capitalScore = normalize(
      capitalVal * 100,
      capitalRange,
      SCENARIO_WEIGHTS.capitalInvert
    )

    const structuralScore =
      creScore * SCENARIO_WEIGHTS.cre +
      nplScore * SCENARIO_WEIGHTS.npl +
      reserveScore * SCENARIO_WEIGHTS.reserve +
      capitalScore * SCENARIO_WEIGHTS.capital

    const structural = Number((structuralScore * 100).toFixed(1))
    const earningsInputs = banks.map((b) => ({
      earningsBufferPct:
        b.totalAssets > 0 && (b.creLoans ?? 0) > 0 && b.netIncome != null
          ? (b.netIncome / (b.creLoans ?? 1)) * 100
          : null,
      roaLatest: b.roa,
      roaDelta4Q: null,
      netIncomeYoYPct: null,
    }))
    const earningsRanges = computeEarningsRanges(earningsInputs)
    const earningsScore = computeEarningsScore(
      {
        earningsBufferPct:
          bank.totalAssets > 0 && (bank.creLoans ?? 0) > 0 && bank.netIncome != null
            ? (bank.netIncome / (bank.creLoans ?? 1)) * 100
            : null,
        roaLatest: bank.roa,
        roaDelta4Q: null,
        netIncomeYoYPct: null,
      },
      earningsRanges
    )
    const vulnerabilityScore = computeVulnerabilityScore(structural, earningsScore)

    let stressScore: number
    switch (metric) {
      case "creCapital":
        stressScore = Number((capitalScore * 100).toFixed(1))
        break
      case "npl":
        stressScore = Number((nplScore * 100).toFixed(1))
        break
      case "reserve":
        stressScore = Number(((1 - reserveScore) * 100).toFixed(1))
        break
      case "chargeoffs":
        stressScore = Number((nplScore * 100).toFixed(1))
        break
      default:
        stressScore = vulnerabilityScore
    }

    return {
      ...bank,
      stressScore: Math.min(100, Math.max(0, stressScore)),
      structuralScore: structural,
      earningsScore,
      creToCapital: capitalVal > 0 ? capitalVal * 100 : undefined,
      nplRatio: bank.nplRatio ?? 0,
      loanLossReserve: bank.loanLossReserve ?? 0,
      noncurrent_to_loans_ratio: bank.noncurrent_to_loans_ratio ?? 0,
      noncurrent_to_assets_ratio: bank.noncurrent_to_assets_ratio ?? 0,
    }
  })

  return scored
}
