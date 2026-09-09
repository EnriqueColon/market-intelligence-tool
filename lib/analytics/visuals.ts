/**
 * Chart-ready data for the Market Analytics Visual Analysis panel.
 *
 * The panel used to fetch `buildReportData` — the full export pipeline — and
 * derive its four charts in the browser. That meant every mount paginated the
 * entire national cohort from FDIC: five sequential requests, 31MB raw, 21.6s
 * measured. It was nominally cached, but the resulting `ReportData` is 5.46MB
 * against Next's 2MB entry ceiling, so Next refused the write and the whole
 * 21.6s ran again on every mount. The comment on `buildReportData` anticipated
 * exactly that; nobody had put a number to it.
 *
 * Deriving the charts here instead means only the finished series travel. Two
 * of the four are already tiny — the ranking is twenty bars and the mix fifteen
 * — and the histogram is ten bins. The scatter is the only one proportional to
 * the cohort, and it carries six numbers per institution rather than a full
 * export row. That is what brings the payload under the ceiling and makes it
 * genuinely cacheable.
 *
 * The derivations themselves are NOT reimplemented here. This calls the same
 * `lib/analytics-chart-data.ts` builders the PDF path still calls through
 * `useAnalyticsChartData`, because screen and PDF disagreeing is the failure
 * mode that produced the deleted capital-analytics-viz component.
 */

import {
  buildCapitalScatter,
  buildCreToCapitalRanking,
  buildExposureMix,
  type AnalyticsChartRow,
  type CapitalScatter,
  type CreToCapitalBar,
  type ExposureMixBar,
} from "@/lib/analytics-chart-data"
import { getHistogramData } from "@/lib/opportunity-score-dispersion"

export type AnalyticsVisuals = {
  histogram: { bin: string; count: number }[]
  creToCapitalRanking: CreToCapitalBar[]
  exposureMix: ExposureMixBar[]
  scatter: CapitalScatter
  /** Institutions behind the distribution, for the histogram caption. */
  institutionCount: number
}

/**
 * Six significant figures, applied after every derivation.
 *
 * Ranking, median selection and bubble scaling all happen first, so rounding
 * cannot reorder a chart or move a quadrant line. Nothing here is displayed to
 * more than one decimal place.
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

export function buildAnalyticsVisuals(rows: AnalyticsChartRow[]): AnalyticsVisuals {
  return roundForTransport({
    histogram: getHistogramData(rows.map((r) => r.opportunityScore)),
    creToCapitalRanking: buildCreToCapitalRanking(rows),
    exposureMix: buildExposureMix(rows),
    scatter: buildCapitalScatter(rows),
    institutionCount: rows.length,
  })
}
