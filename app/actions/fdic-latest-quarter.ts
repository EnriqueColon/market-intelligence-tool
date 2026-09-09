"use server"

import { unstable_cache } from "next/cache"
import { fetchFDICData } from "@/lib/fdic-client"
import { FDIC_ENDPOINTS } from "@/lib/fdic-config"

/**
 * Which quarter FDIC has actually published.
 *
 * Call report data changes four times a year, not daily, but the expensive
 * Market Analytics caches used to expire on a 23-hour timer — so the tool
 * re-paginated 31MB and recomputed 22 seconds of work every day to arrive at
 * an identical answer roughly ninety times per quarter.
 *
 * Asking FDIC what its newest filing date is costs one row, 266 bytes and
 * about 0.45s. Feeding that answer into the heavy cache keys inverts the
 * arrangement: the heavy work is keyed to the data rather than to the clock, so
 * a new quarter changes the key and triggers exactly one recompute, and the
 * rest of the quarter is served from cache.
 *
 * This probe is itself cached, on a timer, because it is the only thing left
 * that has to notice the world changing.
 */
const PROBE_REVALIDATE_SECONDS = 60 * 60 * 6

type FdicRow = { REPDTE?: string | number; data?: { REPDTE?: string | number } }

/** `YYYYMMDD`, e.g. `20260630`. Used as a cache-key component, not displayed. */
export async function getLatestFdicQuarter(): Promise<string> {
  const cached = unstable_cache(probeLatestQuarter, ["fdic-latest-quarter-v1"], {
    revalidate: PROBE_REVALIDATE_SECONDS,
  })
  try {
    return await cached()
  } catch {
    // Falling back to a date-derived quarter rather than something like
    // "unknown" keeps the key stable across a failure: every caller during the
    // outage agrees on one key, so they share a cache entry instead of each
    // paying the 22s recompute.
    return mostRecentLikelyPublishedQuarter()
  }
}

/**
 * Throws rather than returning a fallback, so `unstable_cache` never stores a
 * guess. A cached guess would pin the heavy payloads to the wrong quarter for
 * six hours after FDIC recovered.
 */
async function probeLatestQuarter(): Promise<string> {
  // Errors come back in the body rather than as a rejection.
  const response = await fetchFDICData<FdicRow>(FDIC_ENDPOINTS.financials, {
    limit: 1,
    fields: ["REPDTE"],
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  if (response.error) throw new Error(response.error)

  // FDIC nests each row under `data`; fetchFDICData flattens it. Reading both
  // shapes means a change on either side degrades to the date-derived fallback
  // instead of quietly keying every payload to the wrong quarter.
  const row = response.data?.[0]
  const repdte = row?.REPDTE ?? row?.data?.REPDTE
  const normalized = String(repdte ?? "").replace(/-/g, "")
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error(`FDIC returned an unusable REPDTE: ${String(repdte)}`)
  }
  return normalized
}

/**
 * The newest quarter FDIC would plausibly have published by now.
 *
 * Call reports land roughly 60-75 days after quarter end, so this looks back
 * 100 days and takes the quarter end on or before that date — deliberately
 * conservative, since naming a quarter that does not exist yet would key the
 * cache to an empty result.
 */
function mostRecentLikelyPublishedQuarter(): string {
  const d = new Date()
  d.setDate(d.getDate() - 100)
  const year = d.getUTCFullYear()
  const quarterEnds = [`${year}0331`, `${year}0630`, `${year}0930`, `${year}1231`]
  const asNumber = Number(
    `${year}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
  )
  const eligible = quarterEnds.filter((q) => Number(q) <= asNumber)
  return eligible.length > 0 ? eligible[eligible.length - 1] : `${year - 1}1231`
}
