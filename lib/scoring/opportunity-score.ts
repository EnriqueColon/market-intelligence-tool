/**
 * Structural Opportunity Score
 *
 * A 0–100 score ranking institutions by CRE concentration and credit stress
 * against thin capital and reserves. Higher means more structurally stressed,
 * and therefore more interesting as a distressed-debt opportunity.
 *
 * Scores are **relative to the cohort in view**, not absolute. The same bank
 * scores differently under a national screen than under a Florida one, which is
 * intended: the question is always "compared with what".
 *
 * ## Why percentile rank rather than min-max
 *
 * This previously normalised each input against the cohort's raw minimum and
 * maximum. One extreme institution then stretched the scale and compressed
 * everyone else toward the middle: Florida Q1 2026 produced a median of 51.6,
 * an interquartile range of 47.4–56.5 and nothing above 80, with roughly 4,000
 * of 4,543 institutions inside three adjacent bands. A ranking that puts almost
 * everything in one band is not ranking anything.
 *
 * Percentile rank is immune to that, because an outlier is simply the top
 * percentile rather than a new ceiling. It also spreads the cohort evenly by
 * construction, so score bands carry a consistent meaning: 90 always means
 * "top tenth of this cohort".
 *
 * The weights were never the problem and are unchanged.
 */

/** Relative weights of the four inputs. Must sum to 1. */
export const OPPORTUNITY_WEIGHTS = {
  cre: 0.35,
  npl: 0.35,
  reserve: 0.15,
  capital: 0.15,
} as const

/**
 * Values as they are stored on `BankFinancialData`, so callers do not have to
 * remember which fields are decimals and which are percent points.
 */
export type OpportunityInput = {
  /** CRE loans as a percent of assets, in percent points. */
  creConcentration?: number | null
  /** Noncurrent loans to gross loans, as a decimal (0.008 = 0.8%). */
  noncurrentToLoansRatio?: number | null
  /** Allowance over net loans, as a decimal (0.017 = 1.7%). */
  loanLossReserve?: number | null
  /** CET1 ratio in percent points; used in preference to leverage. */
  cet1Ratio?: number | null
  /** Leverage ratio in percent points; fallback when CET1 is absent. */
  leverageRatio?: number | null
}

/** Sorted ascending value arrays for the cohort, one per input. */
export type OpportunityDistributions = {
  cre: number[]
  npl: number[]
  reserve: number[]
  capital: number[]
}

const creOf = (r: OpportunityInput) => r.creConcentration ?? 0
const nplOf = (r: OpportunityInput) => (r.noncurrentToLoansRatio ?? 0) * 100
const reserveOf = (r: OpportunityInput) => (r.loanLossReserve ?? 0) * 100
const capitalOf = (r: OpportunityInput) => r.cet1Ratio ?? r.leverageRatio ?? 0

function sortedFinite(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
}

/** First index whose value is >= target. */
function lowerBound(sorted: number[], target: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index whose value is > target. */
function upperBound(sorted: number[], target: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Percentile rank of `value` within `sorted`, in [0, 1].
 *
 * Uses the midrank convention — ties receive the average of the positions they
 * span — because these metrics have heavy ties. Many institutions report
 * exactly zero noncurrent loans, and giving every one of them the bottom
 * percentile while the next distinct value jumps far up the scale would be an
 * artefact of the tie, not a real difference.
 *
 * An empty or single-valued cohort returns 0.5: no information, so no claim.
 */
export function percentileRank(sorted: number[], value: number): number {
  const n = sorted.length
  if (n === 0 || !Number.isFinite(value)) return 0.5
  const below = lowerBound(sorted, value)
  const ties = upperBound(sorted, value) - below
  return (below + ties / 2) / n
}

/** Build the cohort distributions the score is measured against. */
export function computeOpportunityDistributions(
  rows: OpportunityInput[]
): OpportunityDistributions {
  return {
    cre: sortedFinite(rows.map(creOf)),
    npl: sortedFinite(rows.map(nplOf)),
    reserve: sortedFinite(rows.map(reserveOf)),
    capital: sortedFinite(rows.map(capitalOf)),
  }
}

/**
 * Structural Opportunity Score for one row, 0–100.
 *
 * Reserve and capital are inverted: a thin allowance and a small capital
 * cushion both mean more stress, and therefore a higher score.
 */
export function computeOpportunityScore(
  row: OpportunityInput,
  dist: OpportunityDistributions
): number {
  const cre = percentileRank(dist.cre, creOf(row))
  const npl = percentileRank(dist.npl, nplOf(row))
  const reserve = 1 - percentileRank(dist.reserve, reserveOf(row))
  const capital = 1 - percentileRank(dist.capital, capitalOf(row))

  const total =
    cre * OPPORTUNITY_WEIGHTS.cre +
    npl * OPPORTUNITY_WEIGHTS.npl +
    reserve * OPPORTUNITY_WEIGHTS.reserve +
    capital * OPPORTUNITY_WEIGHTS.capital

  return Number((Math.max(0, Math.min(1, total)) * 100).toFixed(1))
}

/**
 * The previous min-max score, retained so the two can be shown side by side
 * while people recalibrate against rankings they already have opinions about.
 *
 * Delete once the transition is done — it is not a second opinion, it is the
 * known-compressed one.
 */
export function computeLegacyOpportunityScore(
  row: OpportunityInput,
  rows: OpportunityInput[]
): number {
  const range = (values: number[]) => {
    const finite = values.filter((v) => Number.isFinite(v))
    return {
      min: finite.length ? Math.min(...finite) : 0,
      max: finite.length ? Math.max(...finite) : 0,
    }
  }
  const norm = (v: number, r: { min: number; max: number }, invert = false) => {
    if (r.max === r.min) return 0
    const raw = (v - r.min) / (r.max - r.min)
    return Math.max(0, Math.min(1, invert ? 1 - raw : raw))
  }

  const total =
    norm(creOf(row), range(rows.map(creOf))) * OPPORTUNITY_WEIGHTS.cre +
    norm(nplOf(row), range(rows.map(nplOf))) * OPPORTUNITY_WEIGHTS.npl +
    norm(reserveOf(row), range(rows.map(reserveOf)), true) * OPPORTUNITY_WEIGHTS.reserve +
    norm(capitalOf(row), range(rows.map(capitalOf)), true) * OPPORTUNITY_WEIGHTS.capital

  return Number((total * 100).toFixed(1))
}

/** Convenience: score a whole cohort in one pass. */
export function scoreCohort<T extends OpportunityInput>(
  rows: T[]
): (T & { opportunityScore: number })[] {
  const dist = computeOpportunityDistributions(rows)
  return rows.map((r) => ({ ...r, opportunityScore: computeOpportunityScore(r, dist) }))
}
