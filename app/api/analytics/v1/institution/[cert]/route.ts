import { requireApiKey, ok, badRequest, buildMeta } from "@/lib/analytics-api"
import { normalizeCert } from "@/lib/analytics/api-contract"
import {
  getInstitutionHistory,
  getInstitutionTrend,
  getInstitutionTrendNarrative,
} from "@/app/actions/market-analytics-watch"
import { getInstitutionBehavior } from "@/app/actions/bank-behavior"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * Everything the institution drawer loads for one bank: the eight-quarter
 * trend, corporate history, and the Balance-Sheet Actions panel (signals by
 * quarter, roll-forward, deterministic reading). The model-written trend
 * narrative is opt-in (`?include=narrative`) because it can take several
 * seconds cold and calls OpenAI.
 *
 * Each section fails independently: a bank with a trend but no behaviour
 * history returns the trend and an error for behaviour, not a 502.
 */
export async function GET(request: Request, context: { params: Promise<{ cert: string }> }) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const cert = normalizeCert((await context.params).cert)
  if (!cert) return badRequest("CERT must be an FDIC certificate number.")

  const wantNarrative = (new URL(request.url).searchParams.get("include") ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes("narrative")

  const [quarter, trend, history, behavior, narrative] = await Promise.all([
    getLatestFdicQuarter(),
    getInstitutionTrend(cert),
    getInstitutionHistory(cert).catch((e: unknown) => ({ cert, acquisitions: [], error: String(e) })),
    getInstitutionBehavior(cert),
    wantNarrative ? getInstitutionTrendNarrative(cert).catch(() => null) : Promise.resolve(undefined),
  ])

  return ok(
    {
      cert,
      trend: trend.ok ? trend.trend : null,
      trendError: trend.ok ? undefined : trend.error,
      history,
      behavior: behavior.ok ? behavior.behavior : null,
      behaviorError: behavior.ok ? undefined : behavior.error,
      ...(wantNarrative ? { narrative } : {}),
    },
    buildMeta(quarter)
  )
}
