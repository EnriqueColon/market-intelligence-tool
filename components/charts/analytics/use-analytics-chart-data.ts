"use client"

import { useMemo } from "react"
import { getHistogramData } from "@/lib/opportunity-score-dispersion"
import {
  buildCapitalScatter,
  buildCreToCapitalRanking,
  buildExposureMix,
  type AnalyticsChartRow,
} from "@/lib/analytics-chart-data"

/**
 * Every series the analytics charts need, derived once.
 *
 * Both the dashboard and the PDF report view call this, so the two renderings
 * are computed from identical code rather than parallel copies.
 */
export function useAnalyticsChartData(rows: AnalyticsChartRow[]) {
  const histogram = useMemo(() => getHistogramData(rows.map((r) => r.opportunityScore)), [rows])
  const creToCapitalRanking = useMemo(() => buildCreToCapitalRanking(rows), [rows])
  const exposureMix = useMemo(() => buildExposureMix(rows), [rows])
  const scatter = useMemo(() => buildCapitalScatter(rows), [rows])

  return { histogram, creToCapitalRanking, exposureMix, scatter }
}
