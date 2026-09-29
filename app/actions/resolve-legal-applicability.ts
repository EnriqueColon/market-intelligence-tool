"use server"

/**
 * Turns a legal development's stated scope into a count of institutions it touches.
 *
 * ## Why this is not inside `fetchLegalUpdates`
 *
 * Three reasons:
 *
 * 1. **The watchlist must not enter a cache key.** It is team state that changes whenever someone
 *    adds an institution, while the feed is a day-keyed payload shared by everyone. Cache the
 *    data, shape it in the component.
 * 2. **The two caches expire on different clocks.** The legal feed is keyed to the calendar day;
 *    screening is keyed to the published FDIC quarter and held for a week. Folding the counts
 *    into the legal entry would freeze figures from the previous quarter for up to a day after
 *    FDIC publishes.
 * 3. The legal feed is one cached payload shared by every visitor. This is not.
 *
 * ## Why the universe is Florida
 *
 * `getScreeningPayload("national")` fetches at most `TAB_ROW_CAP` rows sorted by assets across
 * nine quarters, so nationally it covers roughly the largest thousand institutions rather than
 * all ~4,350. A national denominator built on it would be biased towards large banks and wrong
 * in a way the reader could not see. Filtered to Florida the same cap is never approached, so
 * the universe is complete — and Florida is the tool's focus anyway. `capped` is returned rather
 * than assumed, so a future change to the cap surfaces instead of silently skewing counts.
 */

import { getScreeningPayload } from "@/app/actions/market-analytics-screening"
import { getWatchlist } from "@/app/actions/institution-watchlist"
import type { WatchlistEntry } from "@/app/actions/institution-watchlist"
import {
  type ApplicabilityExample,
  describeTest,
  normalizeApplicability,
  selectMatching,
  summarizeMatches,
} from "@/lib/legal-applicability"
import { TAB_ROW_CAP } from "@/lib/analytics/screening"

const UNIVERSE_SCOPE = "Florida"

export type ResolvedApplicability = {
  /** Institutions in the universe the rule's own scope test selects. */
  matched: number
  /** The whole universe the test was applied to, so `matched` reads as a share. */
  universe: number
  /** The largest matches, for checking the test against the linked document. */
  examples: ApplicabilityExample[]
  /** How many of the matches are on the team's watchlist. */
  onWatchlist: number
  /** Names of watchlisted matches — the part that turns a headline into a call. */
  watchlistNames: string[]
  /** The test as applied, derived from the sanitized numbers rather than the model's prose. */
  test: string
  /** The document's own words on scope, when it gave them. */
  basis?: string
  /** True if the FDIC row cap was reached, meaning the universe is a subset. */
  capped: boolean
}

export type ApplicabilityRequest = {
  id: string
  applicability: unknown
}

export type ResolveApplicabilityResult = {
  /** Keyed by item id. Items whose scope was unstated or unusable are simply absent. */
  resolved: Record<string, ResolvedApplicability>
  /** The state the counts are measured over, for the interface to label them honestly. */
  scope: string
  /** Absent without Postgres, which is the normal state on `dev`. */
  watchlistAvailable: boolean
}

const EMPTY = (watchlistAvailable: boolean): ResolveApplicabilityResult => ({
  resolved: {},
  scope: UNIVERSE_SCOPE,
  watchlistAvailable,
})

/**
 * Tests arrive from the client, which received them in the cached legal payload. They are
 * re-normalized here rather than trusted: the trip through the client is untyped at runtime, and
 * `normalizeApplicability` is the only thing standing between a malformed threshold and a
 * confident number on the card.
 */
export async function resolveLegalApplicability(
  requests: ApplicabilityRequest[]
): Promise<ResolveApplicabilityResult> {
  if (!Array.isArray(requests) || requests.length === 0) return EMPTY(false)

  const screening = await getScreeningPayload(UNIVERSE_SCOPE)
  if (!screening.ok) return EMPTY(false)

  const universe = screening.payload.rows
  if (universe.length === 0) return EMPTY(false)
  const capped = screening.payload.rawRowCount >= TAB_ROW_CAP

  const { entries: watchlist, available: watchlistAvailable } = await readWatchlist()
  const watchlistCerts = new Set(watchlist.map((e) => e.cert))

  const resolved: Record<string, ResolvedApplicability> = {}

  for (const request of requests) {
    if (typeof request?.id !== "string") continue
    const test = normalizeApplicability(request.applicability)
    if (!test) continue

    // One pass, reused for both the summary and the overlap, so the count on the card and the
    // names beside it cannot disagree.
    const matchedRows = selectMatching(test, universe)
    const summary = summarizeMatches(matchedRows, universe.length)
    const watchlistHits = matchedRows.filter((row) => watchlistCerts.has(row.id))

    resolved[request.id] = {
      ...summary,
      onWatchlist: watchlistHits.length,
      watchlistNames: watchlistHits.slice(0, 3).map((row) => row.name),
      test: describeTest(test),
      basis: test.basis,
      capped,
    }
  }

  return { resolved, scope: UNIVERSE_SCOPE, watchlistAvailable }
}

/**
 * `available` distinguishes "no database, so we cannot tell you" from "the watchlist is empty",
 * which the card has to say differently. Without Postgres — the normal state on `dev` — the
 * overlap line is omitted rather than shown as a reassuring zero.
 */
async function readWatchlist(): Promise<{ entries: WatchlistEntry[]; available: boolean }> {
  const result = await getWatchlist()
  return result.ok
    ? { entries: result.entries, available: true }
    : { entries: [], available: false }
}
