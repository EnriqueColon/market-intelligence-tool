/**
 * Opportunity Score distribution statistics and narrative generation.
 * Investment-committee grade dispersion analysis.
 */

export type DispersionStats = {
  n: number
  min: number
  max: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  iqr: number
  top_decile_mean: number
  bottom_decile_mean: number
  spread_top_bottom: number
  share_ge_70: number
  share_ge_80: number
  dominant_bin: string
  dominant_bin_share: number
  dispersion_level: "Low" | "Moderate" | "High"
  top_heavy: boolean
  tail_description: string
  concentration_phrase: string
  high_score_cohort_phrase: string
}

const BINS = [
  "0–10",
  "10–20",
  "20–30",
  "30–40",
  "40–50",
  "50–60",
  "60–70",
  "70–80",
  "80–90",
  "90–100",
] as const

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

function binIndex(score: number): number {
  if (score <= 10) return 0
  if (score <= 20) return 1
  if (score <= 30) return 2
  if (score <= 40) return 3
  if (score <= 50) return 4
  if (score <= 60) return 5
  if (score <= 70) return 6
  if (score <= 80) return 7
  if (score <= 90) return 8
  return 9
}

export function computeDispersionStats(scores: number[]): DispersionStats {
  const sorted = [...scores].filter((s) => Number.isFinite(s)).sort((a, b) => a - b)
  const n = sorted.length

  const min = n > 0 ? sorted[0] : 0
  const max = n > 0 ? sorted[n - 1] : 0
  const p10 = percentile(sorted, 10)
  const p25 = percentile(sorted, 25)
  const p50 = percentile(sorted, 50)
  const p75 = percentile(sorted, 75)
  const p90 = percentile(sorted, 90)
  const iqr = p75 - p25

  const topDecileCount = Math.max(1, Math.ceil(n * 0.1))
  const bottomDecileCount = Math.max(1, Math.ceil(n * 0.1))
  const topDecile = sorted.slice(-topDecileCount)
  const bottomDecile = sorted.slice(0, bottomDecileCount)
  const top_decile_mean = topDecile.length > 0 ? topDecile.reduce((a, b) => a + b, 0) / topDecile.length : 0
  const bottom_decile_mean = bottomDecile.length > 0 ? bottomDecile.reduce((a, b) => a + b, 0) / bottomDecile.length : 0
  const spread_top_bottom = top_decile_mean - bottom_decile_mean

  const share_ge_70 = n > 0 ? (scores.filter((s) => s >= 70).length / n) * 100 : 0
  const share_ge_80 = n > 0 ? (scores.filter((s) => s >= 80).length / n) * 100 : 0

  const binCounts = new Array(10).fill(0)
  scores.forEach((s) => {
    const idx = binIndex(s)
    binCounts[idx]++
  })
  let maxIdx = 0
  let maxCount = 0
  binCounts.forEach((c, i) => {
    if (c > maxCount) {
      maxCount = c
      maxIdx = i
    }
  })
  const dominant_bin = BINS[maxIdx]
  const dominant_bin_share = n > 0 ? Math.round((maxCount / n) * 100) : 0

  const dispersion_level: DispersionStats["dispersion_level"] =
    iqr < 12 ? "Low" : iqr < 22 ? "Moderate" : "High"

  const top_heavy = (p90 - p50) > 1.25 * (p50 - p10)
  const tail_description = top_heavy ? "right-tailed" : "more evenly distributed"
  const concentration_phrase = top_heavy
    ? "concentrated within the upper tail"
    : "more broadly distributed across the cohort"
  const high_score_cohort_phrase =
    share_ge_80 >= 10
      ? "a meaningful high-score cohort"
      : share_ge_70 >= 10
        ? "a moderate high-score cohort"
        : "a limited high-score cohort"

  return {
    n,
    min,
    max,
    p10,
    p25,
    p50,
    p75,
    p90,
    iqr,
    top_decile_mean,
    bottom_decile_mean,
    spread_top_bottom,
    share_ge_70,
    share_ge_80,
    dominant_bin,
    dominant_bin_share,
    dispersion_level,
    top_heavy,
    tail_description,
    concentration_phrase,
    high_score_cohort_phrase,
  }
}

export function buildDispersionNarrative(stats: DispersionStats): {
  headerBlurb: string
  histogramLine: string
  interpretation: string
  actionLine: string
} {
  const {
    n,
    p25,
    p50,
    p75,
    top_decile_mean,
    bottom_decile_mean,
    spread_top_bottom,
    dispersion_level,
    tail_description,
    concentration_phrase,
    dominant_bin,
    dominant_bin_share,
  } = stats

  const headerBlurb = `Opportunity Scores exhibit ${dispersion_level} dispersion across ${n} institutions, with a median score of ${p50.toFixed(1)} and an interquartile range of ${p25.toFixed(1)}–${p75.toFixed(1)}. The distribution is ${tail_description}, indicating that elevated exposure is concentrated within a subset of the screened population.`

  const histogramLine = `The histogram indicates that most institutions cluster in the ${dominant_bin} band (${dominant_bin_share}% of the cohort), with a ${tail_description} extending into higher-score ranges.`

  const interpretation = `Dispersion in Opportunity Scores suggests that risk-adjusted CRE exposure is ${concentration_phrase} rather than uniformly distributed. Institutions in the upper decile score an average of ${top_decile_mean.toFixed(1)}, compared with ${bottom_decile_mean.toFixed(1)} in the lower decile (a spread of ${spread_top_bottom.toFixed(1)} points). This dispersion profile supports a selective screening approach focused on upper-tail institutions where concentration, asset-quality, and capital sensitivity metrics align.`

  const actionLine = `For prioritization, the current screen emphasizes institutions in the top decile and top quartile of scores, subject to confirmation via CRE mix, nonaccrual migration, and capital buffer metrics.`

  return { headerBlurb, histogramLine, interpretation, actionLine }
}

export function getHistogramData(scores: number[]): { bin: string; count: number }[] {
  const binCounts = new Array(10).fill(0)
  scores.forEach((s) => {
    const idx = binIndex(s)
    binCounts[idx]++
  })
  return BINS.map((bin, i) => ({ bin, count: binCounts[i] }))
}
