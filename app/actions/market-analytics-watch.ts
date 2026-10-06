"use server"

import { unstable_cache } from "next/cache"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"
import { computeCohortWatch } from "@/app/services/cohort-watch"
import { fetchAcquisitionsBy } from "@/app/services/fdic-structure-events"
import { describeAcquisition, type StructureEvent } from "@/lib/fdic-structure-events"
import type { CohortWatch } from "@/lib/analytics/cohort-watch"

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
