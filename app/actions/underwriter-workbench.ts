"use server"

/**
 * Data for the Underwriter Workbench.
 *
 * Returns the whole scope's latest quarter in one cached payload rather than
 * one request per institution. Two reasons: the peer cohort is a property of
 * the population, so it cannot be computed from a single institution anyway;
 * and switching institutions is then instant, which is what makes the lens
 * usable for working through a list of names.
 *
 * Only the columns the workbench uses are returned. The full row carries about
 * forty fields, most of which the lens never reads, and shipping them all
 * across the wire for eleven hundred institutions is pure cost.
 */

import { unstable_cache } from "next/cache"
import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { normalizeQuarter } from "@/lib/scoring/quarter"
import { toWorkbenchRows, type WorkbenchInput } from "@/lib/scoring/workbench-analysis"

/**
 * One institution at the latest reported quarter.
 *
 * The row shape is defined by the analysis module, not here, so the server
 * action cannot drift from what the analysis expects.
 */
export type WorkbenchRow = WorkbenchInput

export type WorkbenchUniverse = {
  scope: string
  asOfQuarter: string | null
  rows: WorkbenchRow[]
  /** True when the FDIC row cap bound the query rather than the population. */
  capped: boolean
  error?: string
}

/** Matches the screening tab and the Executive Brief, so all three agree. */
const ROW_CAP = 10000

const EMPTY = (scope: string, error?: string): WorkbenchUniverse => ({
  scope,
  asOfQuarter: null,
  rows: [],
  capped: false,
  error,
})

async function computeUniverse(scope: string): Promise<WorkbenchUniverse> {
  const state = scope === "National" || scope === "national" ? undefined : scope
  const { data, error } = await fetchFDICFinancials(state, ROW_CAP, false)
  if (error) return EMPTY(scope, error)
  if (!data.length) return EMPTY(scope)

  let latestQuarter = ""
  for (const row of data) {
    const q = normalizeQuarter(row.reportDate)
    if (q > latestQuarter) latestQuarter = q
  }

  // Latest quarter only, via the shared mapping rather than a copy of it. An
  // institution that did not file for that quarter is left out rather than
  // compared on stale figures: the Executive Brief surfaces those separately,
  // and mixing quarters inside a peer cohort would rank one bank's year-old
  // numbers against everyone else's current ones.
  return {
    scope,
    asOfQuarter: latestQuarter || null,
    rows: toWorkbenchRows(data, latestQuarter),
    capped: data.length >= ROW_CAP,
  }
}

/**
 * Cached for 23 hours under a versioned key, matching the Executive Brief.
 *
 * **Bump the version when the row shape or the quarter rule changes**, or
 * clients will keep deserialising the old shape until the window expires.
 *
 * See `executive-brief.ts` for why the window is 23 hours rather than 24: the
 * daily warm-cache cron has to find the entry expired, or it returns early and
 * leaves a user to pay the cold cost later in the day.
 */
export async function getWorkbenchUniverse(scope: string): Promise<WorkbenchUniverse> {
  const cached = unstable_cache(() => computeUniverse(scope), ["underwriter-workbench-v1", scope], {
    revalidate: 60 * 60 * 23,
  })
  return cached()
}
