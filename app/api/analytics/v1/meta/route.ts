import { requireApiKey, ok, buildMeta } from "@/lib/analytics-api"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"
import { NATIONAL_SCOPE, STATE_BY_CODE } from "@/lib/analytics/api-contract"
import { ASSET_BANDS, CRE_CATEGORY_LABEL, SIGNALS, SIGNAL_THRESHOLDS } from "@/lib/analytics/bank-behavior-signals"

export const runtime = "nodejs"

/**
 * What a consumer needs before its first data call: the current quarter, the
 * scope strings, the asset bands the signals endpoint can be split by, and the
 * signal catalogue (label, meaning, firing rule) so a consumer can render chips
 * and tooltips without copying this repository's code.
 */
export async function GET(request: Request) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const quarter = await getLatestFdicQuarter()
  return ok(
    {
      scopes: { national: NATIONAL_SCOPE, states: STATE_BY_CODE },
      assetBands: ASSET_BANDS,
      signals: SIGNALS,
      signalThresholds: SIGNAL_THRESHOLDS,
      creCategoryLabels: CRE_CATEGORY_LABEL,
      endpoints: {
        screening: "/api/analytics/v1/screening?scope=National|<State name or code>",
        visuals: "/api/analytics/v1/visuals?scope=",
        cohortWatch: "/api/analytics/v1/cohort-watch?scope=",
        behaviorSignals: "/api/analytics/v1/behavior-signals?scope=&band=<optional asset band key>",
        institution: "/api/analytics/v1/institution/<CERT>?include=narrative (optional)",
      },
      cache: {
        note: "Objects are computed by the daily warm-cache job and keyed by the published quarter; they refresh when FDIC publishes and at most weekly otherwise. Consumers should cache responses for at least an hour and need not poll more than daily.",
      },
    },
    buildMeta(quarter)
  )
}
