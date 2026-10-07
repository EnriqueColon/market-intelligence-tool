import { requireApiKey, ok, badRequest, upstreamFailure, buildMeta } from "@/lib/analytics-api"
import { normalizeScope } from "@/lib/analytics/api-contract"
import { getAnalyticsVisuals } from "@/app/actions/market-analytics-visuals"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"

export const runtime = "nodejs"
export const maxDuration = 120

/** Chart series behind the tab's Visual Analysis panel, for the scope. */
export async function GET(request: Request) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const scope = normalizeScope(new URL(request.url).searchParams.get("scope"))
  if (!scope) return badRequest("Unknown scope. Use National, a state name, or a two-letter state code.")

  const [quarter, result] = await Promise.all([getLatestFdicQuarter(), getAnalyticsVisuals(scope)])
  if (!result.ok) return upstreamFailure(result.error)
  return ok({ visuals: result.visuals }, buildMeta(quarter, scope))
}
