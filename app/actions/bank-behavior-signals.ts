"use server"

import { unstable_cache } from "next/cache"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"
import { fetchBehaviorCohort } from "@/app/services/bank-behavior"
import {
  ASSET_BANDS,
  computeBehaviorSignals,
  type AssetBandKey,
  type BankBehaviorSummary,
  type BehaviorSignalsCohort,
} from "@/lib/analytics/bank-behavior-signals"

/**
 * A week, keyed by scope, asset band and published quarter, like the other
 * Market Analytics caches: a new quarter changes the key by itself.
 */
const SIGNALS_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

/**
 * Bump when a threshold, a measure or the summary shape changes, or cached
 * entries keep judging banks under the old rules for a week.
 */
const CACHE_VERSION = "behavior-signals-v1"

type BandEntry = Omit<BehaviorSignalsCohort, "summaries"> & {
  band: AssetBandKey
  summaries: BankBehaviorSummary[]
  computedAt: string
}

export type BehaviorSignalsResult = { ok: true; cohort: BehaviorSignalsCohort } | { ok: false; error: string }

/**
 * Behaviour signals for every institution in the scope.
 *
 * Full coverage (all ~4,600 filers, not the screening table's top 1,116),
 * computed once and stored in four asset-band chunks, because one entry for
 * the national scope would be ~1.8MB against the Data Cache's 2MB ceiling and
 * would grow with every signal added. The percentiles are scope-wide, so the
 * computation cannot be split by band — only the storage is. On a cold or
 * partly cold cache the first band's recompute is shared by the others
 * through `computeOnce`, so a request costs one FDIC pull (about 13s
 * nationally), never four.
 */
export async function getBehaviorSignals(scope: string): Promise<BehaviorSignalsResult> {
  const quarter = await getLatestFdicQuarter()

  let computing: Promise<BehaviorSignalsCohort> | null = null
  const computeOnce = (): Promise<BehaviorSignalsCohort> => {
    if (!computing) computing = computeCohort(scope, quarter)
    return computing
  }

  try {
    const entries = await Promise.all(
      ASSET_BANDS.map((band) =>
        unstable_cache(
          async (): Promise<BandEntry> => {
            const cohort = await computeOnce()
            return {
              ...cohort,
              band: band.key,
              summaries: cohort.summaries.filter((s) => s.band === band.key),
              computedAt: new Date().toISOString(),
            }
          },
          [CACHE_VERSION, scope, band.key, quarter],
          { revalidate: SIGNALS_REVALIDATE_SECONDS }
        )()
      )
    )
    const head = entries[0]
    return {
      ok: true,
      cohort: {
        scope: head.scope,
        asOfQuarter: head.asOfQuarter,
        institutionCount: head.institutionCount,
        currentCount: head.currentCount,
        unjudgedCount: head.unjudgedCount,
        summaries: entries.flatMap((e) => e.summaries),
      },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to compute behaviour signals." }
  }
}

/** Throws rather than returning a failure, so `unstable_cache` stores only successes. */
async function computeCohort(scope: string, quarter: string): Promise<BehaviorSignalsCohort> {
  const cohort = await fetchBehaviorCohort(scope, quarter)
  if (cohort.histories.length === 0) throw new Error(`FDIC returned no behaviour rows for ${scope}.`)
  // If the newest quarter has not been published for this scope yet, judge
  // banks as of the newest quarter that has, so "current" means something.
  const asOf = cohort.emptyQuarters.includes(cohort.asOfQuarter)
    ? [...cohort.quarters].reverse().find((q) => !cohort.emptyQuarters.includes(q)) ?? cohort.asOfQuarter
    : cohort.asOfQuarter
  return computeBehaviorSignals(cohort.histories, scope, asOf)
}
