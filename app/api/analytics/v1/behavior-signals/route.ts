import { requireApiKey, ok, badRequest, upstreamFailure, buildMeta } from "@/lib/analytics-api"
import { normalizeScope } from "@/lib/analytics/api-contract"
import { getBehaviorSignals } from "@/app/actions/bank-behavior-signals"
import { ASSET_BANDS, type AssetBandKey } from "@/lib/analytics/bank-behavior-signals"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * Behaviour signals for every filer in the scope (full coverage, not just the
 * screening table). Nationally this is about 4 MB; `band=` returns one asset
 * band at a time (keys from `/meta`), which is how the tab's cache stores it.
 * The counts in the envelope always describe the whole scope.
 */
export async function GET(request: Request) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const params = new URL(request.url).searchParams
  const scope = normalizeScope(params.get("scope"))
  if (!scope) return badRequest("Unknown scope. Use National, a state name, or a two-letter state code.")

  const bandParam = params.get("band")
  const band = bandParam ? ASSET_BANDS.find((b) => b.key === bandParam)?.key : undefined
  if (bandParam && !band) {
    return badRequest(`Unknown band. One of: ${ASSET_BANDS.map((b) => b.key).join(", ")}.`)
  }

  const [quarter, result] = await Promise.all([getLatestFdicQuarter(), getBehaviorSignals(scope)])
  if (!result.ok) return upstreamFailure(result.error)

  const cohort = band
    ? { ...result.cohort, band: band as AssetBandKey, summaries: result.cohort.summaries.filter((s) => s.band === band) }
    : result.cohort
  return ok({ cohort }, buildMeta(quarter, scope))
}
