/**
 * Earnings Resilience Score
 *
 * A 0–100 score measuring the bank's income strength and trend as a cushion
 * against potential CRE losses. Uses min-max normalization within cohort.
 */

export type EarningsInput = {
  earningsBufferPct?: number | null
  roaLatest?: number | null
  roaDelta4Q?: number | null
  netIncomeYoYPct?: number | null
}

const BASE_WEIGHTS = {
  earningsBuffer: 0.4,
  roaLatest: 0.25,
  netIncomeYoYPct: 0.2,
  roaDelta4Q: 0.15,
} as const

const NI_YOY_CAP = 100

/**
 * Winsorize Net Income YoY % to [-100, +100] to avoid extreme distortion.
 */
function winsorizeNiYoY(value: number): number {
  return Math.max(-NI_YOY_CAP, Math.min(NI_YOY_CAP, value))
}

/**
 * Min-max normalize a value within [min, max]. Higher is better (no inversion).
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0
  const raw = (value - min) / (max - min)
  return Math.max(0, Math.min(1, raw))
}

/**
 * Compute Earnings Resilience Score for a single row given cohort ranges.
 * Missing metrics are excluded; weights are rebalanced proportionally.
 */
export function computeEarningsScore(
  row: EarningsInput,
  ranges: {
    earningsBufferPct: { min: number; max: number }
    roaLatest: { min: number; max: number }
    roaDelta4Q: { min: number; max: number }
    netIncomeYoYPct: { min: number; max: number }
  }
): number {
  const metrics: { value: number; weight: number }[] = []

  // Earnings Buffer %: if < 0, treat as 0 for scoring
  const buffer = row.earningsBufferPct != null && Number.isFinite(row.earningsBufferPct)
    ? Math.max(0, row.earningsBufferPct)
    : null
  if (buffer !== null) {
    metrics.push({
      value: normalize(buffer, ranges.earningsBufferPct.min, ranges.earningsBufferPct.max),
      weight: BASE_WEIGHTS.earningsBuffer,
    })
  }

  // ROA (Latest)
  if (row.roaLatest != null && Number.isFinite(row.roaLatest)) {
    metrics.push({
      value: normalize(row.roaLatest, ranges.roaLatest.min, ranges.roaLatest.max),
      weight: BASE_WEIGHTS.roaLatest,
    })
  }

  // Net Income YoY % (winsorized)
  const niYoY = row.netIncomeYoYPct != null && Number.isFinite(row.netIncomeYoYPct)
    ? winsorizeNiYoY(row.netIncomeYoYPct)
    : null
  if (niYoY !== null) {
    metrics.push({
      value: normalize(niYoY, ranges.netIncomeYoYPct.min, ranges.netIncomeYoYPct.max),
      weight: BASE_WEIGHTS.netIncomeYoYPct,
    })
  }

  // ROA Δ 4Q
  if (row.roaDelta4Q != null && Number.isFinite(row.roaDelta4Q)) {
    metrics.push({
      value: normalize(row.roaDelta4Q, ranges.roaDelta4Q.min, ranges.roaDelta4Q.max),
      weight: BASE_WEIGHTS.roaDelta4Q,
    })
  }

  if (metrics.length === 0) return 0

  const totalWeight = metrics.reduce((s, m) => s + m.weight, 0)
  const weightedSum = metrics.reduce((s, m) => s + m.value * m.weight, 0)
  const reweighted = totalWeight > 0 ? weightedSum / totalWeight : 0

  return Number((reweighted * 100).toFixed(1))
}

/**
 * Compute min-max ranges for a cohort of rows.
 */
export function computeEarningsRanges(
  rows: EarningsInput[]
): {
  earningsBufferPct: { min: number; max: number }
  roaLatest: { min: number; max: number }
  roaDelta4Q: { min: number; max: number }
  netIncomeYoYPct: { min: number; max: number }
} {
  const metricRange = (values: number[]) => {
    const filtered = values.filter((v) => Number.isFinite(v))
    return {
      min: filtered.length ? Math.min(...filtered) : 0,
      max: filtered.length ? Math.max(...filtered) : 0,
    }
  }

  const buffers: number[] = []
  const roas: number[] = []
  const roaDeltas: number[] = []
  const niYoYs: number[] = []

  for (const row of rows) {
    const buffer = row.earningsBufferPct != null && Number.isFinite(row.earningsBufferPct)
      ? Math.max(0, row.earningsBufferPct)
      : null
    if (buffer !== null) buffers.push(buffer)

    if (row.roaLatest != null && Number.isFinite(row.roaLatest)) roas.push(row.roaLatest)
    if (row.roaDelta4Q != null && Number.isFinite(row.roaDelta4Q)) roaDeltas.push(row.roaDelta4Q)

    const niYoY = row.netIncomeYoYPct != null && Number.isFinite(row.netIncomeYoYPct)
      ? winsorizeNiYoY(row.netIncomeYoYPct)
      : null
    if (niYoY !== null) niYoYs.push(niYoY)
  }

  return {
    earningsBufferPct: metricRange(buffers),
    roaLatest: metricRange(roas),
    roaDelta4Q: metricRange(roaDeltas),
    netIncomeYoYPct: metricRange(niYoYs),
  }
}
