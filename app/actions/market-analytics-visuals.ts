"use server"

import { unstable_cache } from "next/cache"
import { buildReportData } from "@/app/actions/build-report-data"
import { buildAnalyticsVisuals, type AnalyticsVisuals } from "@/lib/analytics/visuals"

/**
 * A day less an hour, matching the other FDIC-derived caches. See the note in
 * confluence on why 23 rather than 24: the 05:00 UTC cron has to find the entry
 * already expired, or it returns early and leaves it to lapse in front of a
 * user later in the day.
 */
const VISUALS_REVALIDATE_SECONDS = 60 * 60 * 23

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
 * The version is part of the key. Bump it whenever a chart derivation changes,
 * or cached entries keep serving series computed the old way.
 */
export async function getAnalyticsVisuals(scope: string): Promise<AnalyticsVisualsResult> {
  const cached = unstable_cache(
    () => computeVisuals(scope),
    ["market-analytics-visuals-v1", scope],
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
