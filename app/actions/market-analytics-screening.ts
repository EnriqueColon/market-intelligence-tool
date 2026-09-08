"use server"

import { unstable_cache } from "next/cache"
import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { buildScreeningPayload, TAB_ROW_CAP, type ScreeningPayload } from "@/lib/analytics/screening"

/**
 * A day less an hour, matching the department lenses.
 *
 * FDIC publishes quarterly, so a day-old entry is never meaningfully stale, and
 * the 05:00 UTC cron re-warms this before anyone is working. A shorter window
 * would expire mid-morning and hand the next visitor the full FDIC round trip
 * for no freshness gain.
 */
const SCREENING_REVALIDATE_SECONDS = 60 * 60 * 23

export type ScreeningResult =
  | { ok: true; payload: ScreeningPayload }
  | { ok: false; error: string }

/**
 * The Market Analytics screening cohort, reduced and scored on the server.
 *
 * Previously the tab fetched ~10,000 raw rows per visit and reduced them in the
 * browser. That could not be cached: at 10.8MB the response exceeded the 2MB
 * data-cache entry limit, so `lib/fdic-client.ts` correctly fetched it with
 * `cache: "no-store"` and every visitor paid the ~6s FDIC round trip. Reducing
 * first brings the payload to about 1.26MB, which fits, so this is cacheable
 * and the cost is paid once a day by the cron rather than once per visit.
 *
 * The key is versioned. Scores are cohort-relative, so a change to the scoring
 * or to the transported row shape must bump it or stale entries will be served
 * under the new code until the window expires.
 */
export async function getScreeningPayload(scope: string): Promise<ScreeningResult> {
  const cached = unstable_cache(
    () => computeScreening(scope),
    ["market-analytics-screening-v1", scope],
    { revalidate: SCREENING_REVALIDATE_SECONDS }
  )
  try {
    return { ok: true, payload: await cached() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to reach FDIC." }
  }
}

/**
 * Throws rather than returning a failure, so that `unstable_cache` stores only
 * successes. Returning an error object here would cache an FDIC outage for the
 * full 23 hours and leave the tab broken for a day after a momentary blip.
 */
async function computeScreening(scope: string): Promise<ScreeningPayload> {
  const state = scope === "national" || scope === "National" ? undefined : scope
  const { data, error } = await fetchFDICFinancials(state, TAB_ROW_CAP, false)

  if (error) throw new Error(error)
  if (data.length === 0) throw new Error("FDIC returned no rows for this scope.")

  return buildScreeningPayload(data, state)
}
