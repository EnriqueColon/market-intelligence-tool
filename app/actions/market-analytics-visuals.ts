"use server"

import { unstable_cache } from "next/cache"
import { buildReportData } from "@/app/actions/build-report-data"
import { buildAnalyticsVisuals, type AnalyticsVisuals } from "@/lib/analytics/visuals"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"

/**
 * A week, matching the screening cache, and for the same reason: the published
 * quarter is part of the key, so a new quarter refreshes this by itself and the
 * timer only exists to pick up amended call reports.
 *
 * This is the payload where the old daily expiry hurt most — 22 seconds and
 * 31MB out of FDIC, repeated every day to rebuild an identical set of charts.
 */
const VISUALS_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

export type AnalyticsVisualsResult =
  | { ok: true; visuals: AnalyticsVisuals }
  | { ok: false; error: string }

/**
 * Chart series for the Visual Analysis panel.
 *
 * `buildReportData` is still the source, because the charts must cover the full
 * cohort — all ~4,600 institutions — rather than the largest ~1,100 the tab's
 * screening table is capped at. What changed is that its 5.46MB result no
 * longer travels or gets cached: it is reduced to the finished chart series
 * first, which is both small enough to cache and all the panel ever used.
 *
 * The key carries a version and the published quarter. Bump the version
 * whenever a chart derivation changes, or cached entries keep serving series
 * computed the old way. The quarter ties the 22-second recompute to FDIC
 * publishing rather than to a timer.
 */
export async function getAnalyticsVisuals(scope: string): Promise<AnalyticsVisualsResult> {
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    () => computeVisuals(scope),
    ["market-analytics-visuals-v1", scope, quarter],
    { revalidate: VISUALS_REVALIDATE_SECONDS }
  )
  try {
    return { ok: true, visuals: await cached() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to build charts." }
  }
}

/**
 * Throws rather than returning a failure, so `unstable_cache` stores only
 * successes. Caching an FDIC outage here would blank the charts for a day.
 */
async function computeVisuals(scope: string): Promise<AnalyticsVisuals> {
  const data = await buildReportData(scope)
  if (data.rows.length === 0) throw new Error("FDIC returned no rows for this scope.")
  return buildAnalyticsVisuals(data.rows)
}
