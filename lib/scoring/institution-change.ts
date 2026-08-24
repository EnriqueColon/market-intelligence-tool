/**
 * What changed, and what is about to.
 *
 * The tool has only ever shown the current quarter, which makes it a snapshot:
 * it can say an institution is stressed, but not that it is *becoming* stressed.
 * The eight-or-nine quarters already fetched to draw the trend sparklines carry
 * that information and were otherwise discarded.
 *
 * Two kinds of event come out of this, and the distinction is the point:
 *
 *  - **Crossings** — the institution passed a level that means something outside
 *    this tool, most importantly the 300% CRE-to-capital figure from the 2006
 *    interagency guidance. These are already-distressed: level-based.
 *  - **Trajectories** — nothing has been crossed, but the metric has moved the
 *    wrong way for several consecutive quarters. These are the early warnings,
 *    and they are the half nothing in the tool surfaces today.
 *
 * Thresholds below are labelled by origin. Only the CRE-to-capital and
 * construction figures are supervisory reference points; the rest are working
 * conventions and should be read as such.
 */

export type ChangeKind = "crossing" | "trajectory"

/** A single institution-quarter. Missing metrics are skipped, not treated as zero. */
export type QuarterObservation = {
  /** FDIC REPDTE, `YYYYMMDD`. Compared as a string, which sorts correctly. */
  quarter: string
  /** CRE loans over Tier 1 + Tier 2, as a multiple: 3.2 means 320%. */
  creToCapital?: number | null
  /** Construction and land development over Tier 1 + Tier 2, as a multiple. */
  constructionToCapital?: number | null
  /** Noncurrent loans over gross loans, as a decimal. */
  noncurrentRatio?: number | null
  /** Allowance over net loans, as a decimal. */
  reserveCoverage?: number | null
  /** CET1 or leverage ratio, in percent points. */
  capitalRatio?: number | null
}

export type MetricKey = keyof Omit<QuarterObservation, "quarter">

type Threshold = { value: number; label: string; supervisory: boolean }

type MetricSpec = {
  label: string
  /** Which direction counts as deterioration. */
  adverse: "rising" | "falling"
  thresholds: Threshold[]
  format: (value: number) => string
  /**
   * How large the metric must already be for a trend in it to be worth
   * reporting. A relative filter alone cannot do this: construction lending
   * going from 2% to 3% of capital is a 50% relative move and completely
   * uninteresting, and a metric starting at zero makes any increase look
   * infinite. Rising metrics need `atLeast`, falling ones `atMost` — a reserve
   * that slips from 2.44% to 2.08% is still amply reserved.
   *
   * Crossings ignore this, since a threshold is a materiality test already.
   */
  material: { atLeast?: number; atMost?: number }
}

const asMultiple = (v: number) => `${(v * 100).toFixed(0)}%`
const asPercent = (v: number) => `${(v * 100).toFixed(2)}%`
const asPoints = (v: number) => `${v.toFixed(2)}%`

export const METRIC_SPECS: Record<MetricKey, MetricSpec> = {
  creToCapital: {
    label: "CRE to capital",
    adverse: "rising",
    // 2006 Interagency Guidance on CRE Concentrations: total CRE at or above
    // 300% of total risk-based capital is one of two screening criteria for
    // heightened supervisory scrutiny.
    thresholds: [{ value: 3, label: "300% supervisory screen", supervisory: true }],
    format: asMultiple,
    // Below 100% of capital, CRE is not a concentration story.
    material: { atLeast: 1 },
  },
  constructionToCapital: {
    label: "Construction to capital",
    adverse: "rising",
    // The same guidance's other criterion, at 100%.
    thresholds: [{ value: 1, label: "100% supervisory screen", supervisory: true }],
    format: asMultiple,
    // A quarter of the way to the supervisory screen.
    material: { atLeast: 0.25 },
  },
  noncurrentRatio: {
    label: "Noncurrent loans",
    adverse: "rising",
    thresholds: [
      { value: 0.02, label: "2% of loans", supervisory: false },
      { value: 0.05, label: "5% of loans", supervisory: false },
    ],
    format: asPercent,
    material: { atLeast: 0.005 },
  },
  reserveCoverage: {
    label: "Reserve coverage",
    adverse: "falling",
    thresholds: [{ value: 0.01, label: "1% of loans", supervisory: false }],
    format: asPercent,
    // A fall only matters once coverage is getting thin.
    material: { atMost: 0.02 },
  },
  capitalRatio: {
    label: "Capital ratio",
    adverse: "falling",
    thresholds: [{ value: 8, label: "8% adequately capitalised", supervisory: false }],
    format: asPoints,
    material: { atMost: 15 },
  },
}

export type InstitutionChange = {
  kind: ChangeKind
  metric: MetricKey
  metricLabel: string
  /** Sentence describing the movement, suitable for display as-is. */
  description: string
  from: number
  to: number
  /** Quarters spanned. 1 for a crossing, the run length for a trajectory. */
  quarters: number
  /** Set on crossings: whether the level breached is a supervisory one. */
  supervisory?: boolean
  /** Set on crossings: the level breached, so callers can rank by overshoot. */
  threshold?: number
}

/** Minimum consecutive adverse quarters before a trend is worth reporting. */
const MIN_TRAJECTORY_RUN = 3

/** Ignore movements below this share of the value, so noise is not a trend. */
const MIN_RELATIVE_MOVE = 0.01

function sortOldestFirst(observations: QuarterObservation[]): QuarterObservation[] {
  return [...observations].sort((a, b) => String(a.quarter).localeCompare(String(b.quarter)))
}

function seriesFor(observations: QuarterObservation[], metric: MetricKey): { quarter: string; value: number }[] {
  return observations
    .map((o) => ({ quarter: o.quarter, value: o[metric] }))
    .filter((p): p is { quarter: string; value: number } => typeof p.value === "number" && Number.isFinite(p.value))
}

function movedAdversely(spec: MetricSpec, from: number, to: number): boolean {
  const delta = to - from
  if (Math.abs(delta) < Math.abs(from) * MIN_RELATIVE_MOVE) return false
  return spec.adverse === "rising" ? delta > 0 : delta < 0
}

function crossed(spec: MetricSpec, threshold: number, from: number, to: number): boolean {
  return spec.adverse === "rising"
    ? from < threshold && to >= threshold
    : from >= threshold && to < threshold
}

/**
 * Events for one institution, most significant first.
 *
 * Crossings outrank trajectories, and supervisory thresholds outrank
 * conventional ones, because that is the order someone would want to read them.
 */
export function detectChanges(observations: QuarterObservation[]): InstitutionChange[] {
  const ordered = sortOldestFirst(observations)
  if (ordered.length < 2) return []

  const changes: InstitutionChange[] = []

  for (const key of Object.keys(METRIC_SPECS) as MetricKey[]) {
    const spec = METRIC_SPECS[key]
    const series = seriesFor(ordered, key)
    if (series.length < 2) continue

    const latest = series[series.length - 1]
    const previous = series[series.length - 2]

    for (const threshold of spec.thresholds) {
      if (!crossed(spec, threshold.value, previous.value, latest.value)) continue
      const direction = spec.adverse === "rising" ? "rose above" : "fell below"
      changes.push({
        kind: "crossing",
        metric: key,
        metricLabel: spec.label,
        description: `${spec.label} ${direction} the ${threshold.label}, at ${spec.format(latest.value)} from ${spec.format(previous.value)}.`,
        from: previous.value,
        to: latest.value,
        quarters: 1,
        supervisory: threshold.supervisory,
        threshold: threshold.value,
      })
    }

    // Walk back from the latest quarter for as long as each step was adverse.
    let run = 0
    for (let i = series.length - 1; i > 0; i--) {
      if (!movedAdversely(spec, series[i - 1].value, series[i].value)) break
      run++
    }

    const { atLeast, atMost } = spec.material
    const material =
      (atLeast === undefined || latest.value >= atLeast) &&
      (atMost === undefined || latest.value <= atMost)

    if (run >= MIN_TRAJECTORY_RUN && material) {
      const start = series[series.length - 1 - run]
      const verb = spec.adverse === "rising" ? "risen" : "fallen"
      changes.push({
        kind: "trajectory",
        metric: key,
        metricLabel: spec.label,
        description: `${spec.label} has ${verb} for ${run} consecutive quarters, from ${spec.format(start.value)} to ${spec.format(latest.value)}.`,
        from: start.value,
        to: latest.value,
        quarters: run,
      })
    }
  }

  return changes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "crossing" ? -1 : 1
    if (a.kind === "crossing" && a.supervisory !== b.supervisory) return a.supervisory ? -1 : 1
    return b.quarters - a.quarters
  })
}

/**
 * Metrics are in different units, so rank on a unitless quantity.
 *
 * Crossings rank by how far past the level the institution landed: one well
 * over a threshold is a bigger finding than one that grazed it. Ranking by the
 * size of the quarterly step instead would put an institution that jumped from
 * near-zero at the top, which is usually a reporting artifact rather than news.
 */
export function rankBySeverity<T extends InstitutionChange>(a: T, b: T): number {
  const past = (e: T) => (e.threshold ? Math.abs((e.to - e.threshold) / e.threshold) : 0)
  return past(b) - past(a)
}

/** A longer adverse run is the stronger signal; relative move breaks ties. */
export function rankByRun<T extends InstitutionChange>(a: T, b: T): number {
  const move = (e: T) => (e.from === 0 ? 0 : Math.abs((e.to - e.from) / e.from))
  return b.quarters - a.quarters || move(b) - move(a)
}

/**
 * Split events into the three groups a brief shows, each capped at `perSection`.
 * Pure, so verification scripts can exercise the real ranking.
 */
export function groupForBrief<T extends InstitutionChange>(events: T[], perSection: number) {
  return {
    supervisoryCrossings: events
      .filter((e) => e.kind === "crossing" && e.supervisory)
      .sort(rankBySeverity)
      .slice(0, perSection),
    otherCrossings: events
      .filter((e) => e.kind === "crossing" && !e.supervisory)
      .sort(rankBySeverity)
      .slice(0, perSection),
    trajectories: events
      .filter((e) => e.kind === "trajectory")
      .sort(rankByRun)
      .slice(0, perSection),
  }
}
