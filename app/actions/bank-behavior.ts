"use server"

import { unstable_cache } from "next/cache"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"
import { fetchBehaviorHistory } from "@/app/services/bank-behavior"
import { buildInstitutionBehavior, type InstitutionBehavior } from "@/lib/analytics/bank-behavior-panel"

/** A week, like the trend: a new published quarter changes the key by itself. */
const BEHAVIOR_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

export type InstitutionBehaviorResult = { ok: true; behavior: InstitutionBehavior } | { ok: false; error: string }

/**
 * The Balance-Sheet Actions panel for one institution: nine quarters of
 * behaviour fields for that CERT, shaped into chart points, the CRE nonaccrual
 * roll-forward, the signals that fired each quarter and the deterministic
 * reading. One FDIC call of about nine rows, cached per CERT and published
 * quarter for a week; only successes are cached.
 *
 * Signals are scope-independent, so this needs no cohort — the percentiles
 * that do depend on scope live in `getBehaviorSignals` and are not shown here.
 *
 * Bump the key version when `BehaviorPanelPoint`, the roll-forward or the
 * reading change shape, or cached entries keep the old one for a week.
 */
export async function getInstitutionBehavior(cert: string): Promise<InstitutionBehaviorResult> {
  if (!cert) return { ok: false, error: "No institution selected." }
  try {
    const quarter = await getLatestFdicQuarter()
    const cached = unstable_cache(
      async () => buildInstitutionBehavior(await fetchBehaviorHistory(cert), quarter),
      ["institution-behavior-v1", cert, quarter],
      { revalidate: BEHAVIOR_REVALIDATE_SECONDS }
    )
    return { ok: true, behavior: await cached() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to load the institution's balance-sheet actions." }
  }
}
