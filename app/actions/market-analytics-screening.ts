"use server"

import { unstable_cache } from "next/cache"
import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { buildScreeningPayload, TAB_ROW_CAP, type ScreeningPayload } from "@/lib/analytics/screening"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"

/**
 * A week, because the published quarter is part of the cache key.
 *
 * A new quarter changes the key and recomputes on its own, so this timer is no
 * longer what keeps the tab current. It exists only to catch amended call
 * reports: banks do refile and FDIC restates prior quarters, but those land
 * over weeks rather than hours. The old 23-hour window bought no accuracy and
 * cost a full re-pagination every single day.
 */
const SCREENING_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

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
 * The key carries both a version and the published quarter. Bump the version
 * when scoring or the transported row shape changes, since scores are
 * cohort-relative and stale entries would otherwise be served under new code.
 * The quarter is what makes this refresh when FDIC publishes rather than when a
 * timer happens to lapse.
 */
export async function getScreeningPayload(scope: string): Promise<ScreeningResult> {
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    () => computeScreening(scope),
    ["market-analytics-screening-v1", scope, quarter],
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
 * full week and leave the tab broken long after a momentary blip.
 */
async function computeScreening(scope: string): Promise<ScreeningPayload> {
  const state = scope === "national" || scope === "National" ? undefined : scope
  const { data, error } = await fetchFDICFinancials(state, TAB_ROW_CAP, false)

  if (error) throw new Error(error)
  if (data.length === 0) throw new Error("FDIC returned no rows for this scope.")

  return buildScreeningPayload(data, state)
}
