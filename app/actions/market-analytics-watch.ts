"use server"

import { unstable_cache } from "next/cache"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"
import { computeCohortWatch, toInput } from "@/app/services/cohort-watch"
import { fetchAcquisitionsBy } from "@/app/services/fdic-structure-events"
import { describeAcquisition, type StructureEvent } from "@/lib/fdic-structure-events"
import type { CohortWatch } from "@/lib/analytics/cohort-watch"
import { buildInstitutionTrend, type InstitutionTrend } from "@/lib/analytics/institution-trend"
import { fetchFDICData } from "@/lib/fdic-client"
import { FDIC_ENDPOINTS, FDIC_FIELDS } from "@/lib/fdic-config"
import { transformFinancialData } from "@/lib/fdic-data-transformer"

/**
 * A week, keyed by scope and the published quarter, like the screening table:
 * a new quarter refreshes it by itself, and the timer only exists to pick up
 * amended call reports and FDIC structure records filed after the quarter —
 * a failure on 1 May shows up in `/failures` within days, not at quarter end.
 */
const WATCH_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

export type CohortWatchResult = { ok: true; watch: CohortWatch } | { ok: false; error: string }

/**
 * Deteriorating institutions and exits for the Market Analytics tab.
 *
 * Bump the key version when the change-detection thresholds, the PCA
 * classification or the exit window move, or cached entries keep reporting
 * under the old rules for a week.
 */
export async function getCohortWatch(scope: string): Promise<CohortWatchResult> {
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    async () => {
      const watch = await computeCohortWatch(scope)
      // Throw so unstable_cache stores only successes; an FDIC outage must not
      // blank the panel for a week.
      if (watch.error) throw new Error(watch.error)
      return watch
    },
    ["market-analytics-watch-v1", scope, quarter],
    { revalidate: WATCH_REVALIDATE_SECONDS }
  )
  try {
    return { ok: true, watch: await cached() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to build the cohort watch." }
  }
}

export type InstitutionHistory = {
  cert: string
  /** Institutions this bank has absorbed, newest first, as sentences. */
  acquisitions: { date: string; description: string; absorbedCert?: string }[]
}

/**
 * Corporate history for the institution drawer. Only acquisitions for now:
 * a bank in the drawer is by construction a going concern (it filed for the
 * headline quarter), so the events that can have happened *to* it are the
 * ones where it absorbed somebody else.
 */
export async function getInstitutionHistory(cert: string): Promise<InstitutionHistory> {
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    async () => {
      const events: StructureEvent[] = await fetchAcquisitionsBy(cert)
      return {
        cert,
        acquisitions: events.map((e) => ({
          date: e.date,
          description: describeAcquisition(e, { withDate: false }),
          absorbedCert: e.absorbed?.cert,
        })),
      }
    },
    ["institution-history-v1", cert, quarter],
    { revalidate: WATCH_REVALIDATE_SECONDS }
  )
  try {
    return await cached()
  } catch {
    return { cert, acquisitions: [] }
  }
}

export type InstitutionTrendResult = { ok: true; trend: InstitutionTrend } | { ok: false; error: string }

/** 27 months: nine quarters, one of headroom for the FDIC's publication lag. */
function trendWindowFilter(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 27)
  return `[${d.toISOString().slice(0, 7)}-01 TO *]`
}

/**
 * The last eight quarters for one institution, for the drawer's trend panels.
 *
 * One FDIC call for that CERT — about nine rows — rather than widening the
 * screening payload, which is already near the data-cache ceiling. Cached per
 * CERT and published quarter for a week; only successes are cached.
 */
export async function getInstitutionTrend(cert: string): Promise<InstitutionTrendResult> {
  if (!cert) return { ok: false, error: "No institution selected." }
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    async () => {
      const response = await fetchFDICData<Record<string, unknown>>(FDIC_ENDPOINTS.financials, {
        filters: { CERT: cert, REPDTE: trendWindowFilter() },
        fields: FDIC_FIELDS.financials,
        limit: 12,
        sort_by: "REPDTE",
        sort_order: "DESC",
      })
      if (response.error) throw new Error(response.error)
      const rows = transformFinancialData(response.data ?? []).map(toInput)
      if (rows.length === 0) throw new Error(`No FDIC filings for CERT ${cert} in the last 27 months.`)
      return buildInstitutionTrend(cert, rows)
    },
    ["institution-trend-v1", cert, quarter],
    { revalidate: WATCH_REVALIDATE_SECONDS }
  )
  try {
    return { ok: true, trend: await cached() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to load the institution's history." }
  }
}
