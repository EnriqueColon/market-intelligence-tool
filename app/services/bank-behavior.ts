import "server-only"
import { fetchFDICData } from "@/lib/fdic-client"
import { FDIC_ENDPOINTS, FDIC_FIELDS } from "@/lib/fdic-config"
import {
  BEHAVIOR_QUARTERS,
  buildBehaviorHistory,
  groupBehaviorHistories,
  quarterEnds,
  type BehaviorHistory,
} from "@/lib/analytics/bank-behavior"

/**
 * The behaviour fields come down their own path rather than riding on the
 * screening pull: that pull's cached entry is already near the 2MB ceiling,
 * and widening the shared field list would widen every request on the tab.
 * Nothing here is cached. The reductions built on these histories (signals,
 * scores) are what get cached, because raw nine-quarter histories for 4,300
 * banks are ~12MB and could not be stored anyway.
 */

type RawRow = Record<string, unknown>

/** One FDIC page; the whole active population fits in it for any one quarter. */
const PAGE = 10000
/** Quarters fetched at once for the cohort pull. */
const CONCURRENCY = 3

/** 27 months: nine quarters, one of headroom for the FDIC's publication lag. */
function historyWindowFilter(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 27)
  return `[${d.toISOString().slice(0, 7)}-01 TO *]`
}

/** The last nine quarters of behaviour fields for one institution: one request, about nine rows. */
export async function fetchBehaviorHistory(cert: string): Promise<BehaviorHistory> {
  const response = await fetchFDICData<RawRow>(FDIC_ENDPOINTS.financials, {
    filters: { CERT: cert, REPDTE: historyWindowFilter() },
    fields: FDIC_FIELDS.behavior,
    limit: 12,
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  if (response.error) throw new Error(response.error)
  if (!response.data?.length) throw new Error(`No FDIC filings for CERT ${cert} in the last 27 months.`)
  return buildBehaviorHistory(cert, response.data)
}

export type BehaviorCohort = {
  scope: string
  /** `YYYYMMDD` of the newest quarter requested. */
  asOfQuarter: string
  /** The quarters requested, oldest first. */
  quarters: string[]
  /** Quarters FDIC returned no rows for — normally only the newest, before publication. */
  emptyQuarters: string[]
  histories: BehaviorHistory[]
}

/**
 * Full coverage: every institution filing in the scope, for the nine quarters
 * ending at `latestQuarter`. One request per quarter rather than paging a
 * 27-month window, because a single quarter's population (~4,300 rows) fits
 * one page while the window (~39,000 rows) would take four sequential pages;
 * three quarters run at a time. Measured with `npm run verify:behavior-fields`
 * (COHORT=1): national 40,318 rows, 31MB, 4,630 institutions in 12.8s;
 * Florida 93 institutions in 1.3s.
 */
export async function fetchBehaviorCohort(scope: string, latestQuarter: string): Promise<BehaviorCohort> {
  const state = scope === "National" || scope === "national" ? undefined : scope
  const quarters = quarterEnds(latestQuarter, BEHAVIOR_QUARTERS)
  if (quarters.length === 0) throw new Error(`Cannot derive quarter ends from "${latestQuarter}".`)

  const rows: RawRow[] = []
  const emptyQuarters: string[] = []
  for (let i = 0; i < quarters.length; i += CONCURRENCY) {
    const batch = quarters.slice(i, i + CONCURRENCY)
    const pages = await Promise.all(
      batch.map((quarter) =>
        fetchFDICData<RawRow>(FDIC_ENDPOINTS.financials, {
          filters: { REPDTE: quarter, ...(state ? { STNAME: state.toUpperCase() } : {}) },
          fields: FDIC_FIELDS.behavior,
          limit: PAGE,
          sort_by: "ASSET",
          sort_order: "DESC",
        }).then((response) => ({ quarter, response }))
      )
    )
    for (const { quarter, response } of pages) {
      if (response.error) throw new Error(`${quarter}: ${response.error}`)
      if (!response.data?.length) emptyQuarters.push(quarter)
      else rows.push(...response.data)
    }
  }

  return {
    scope,
    asOfQuarter: quarters[quarters.length - 1],
    quarters,
    emptyQuarters,
    histories: groupBehaviorHistories(rows),
  }
}
