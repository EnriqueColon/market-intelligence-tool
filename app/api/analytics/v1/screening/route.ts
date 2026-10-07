import { requireApiKey, ok, badRequest, upstreamFailure, buildMeta } from "@/lib/analytics-api"
import { normalizeScope } from "@/lib/analytics/api-contract"
import { getScreeningPayload } from "@/app/actions/market-analytics-screening"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"

export const runtime = "nodejs"
// A cold scope recomputes from FDIC (several seconds nationally); the cron keeps National and Florida warm.
export const maxDuration = 120

/**
 * The screening table exactly as the tab receives it: scored rows (Opportunity,
 * Earnings Resilience, Composite Vulnerability as percentile ranks within the
 * scope), KPIs, NPL summary, the quarter list and the raw row count.
 */
export async function GET(request: Request) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const scope = normalizeScope(new URL(request.url).searchParams.get("scope"))
  if (!scope) return badRequest("Unknown scope. Use National, a state name, or a two-letter state code.")

  const [quarter, result] = await Promise.all([getLatestFdicQuarter(), getScreeningPayload(scope)])
  if (!result.ok) return upstreamFailure(result.error)
  return ok({ payload: result.payload }, buildMeta(quarter, scope))
}
