import {
  requireApiKey,
  ok,
  badRequest,
  upstreamFailure,
  buildMeta,
  measureResponse,
  payloadTooLarge,
} from "@/lib/analytics-api"
import { normalizeScope } from "@/lib/analytics/api-contract"
import { getBehaviorSignals } from "@/app/actions/bank-behavior-signals"
import { ASSET_BANDS, type AssetBandKey } from "@/lib/analytics/bank-behavior-signals"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * Behaviour signals for every filer in the scope (full coverage, not just the
 * screening table). `band=` returns one asset band at a time (keys from
 * `/meta`), which is how the tab's cache stores it. The counts in the envelope
 * always describe the whole scope.
 *
 * **The whole-scope national response is refused when it would be too large to
 * send.** It measured 3.9 MB against Vercel's 4.5 MB ceiling when this API
 * shipped, and crossing that ceiling does not truncate the body — the function
 * fails, and the consumer sees an error that says nothing about the shape of
 * its request being the cause. So the body is measured before it is sent: at
 * 4,480,000 bytes it becomes a 413 naming `band=` and listing the bands, and
 * between 3.5 MB and that it is sent with its size in the envelope so a
 * consumer can see the ceiling approaching rather than meet it one quarter
 * later. The thresholds, and why they moved on 2026-10-26, are in
 * `lib/analytics/api-contract.ts`.
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

  const meta = buildMeta(quarter, scope)
  const size = measureResponse({ ok: true, meta, cohort })

  if (size.verdict === "too-large") {
    return payloadTooLarge(
      `This scope's signals are ${size.human}, which is more than can be returned in one response. ` +
        `Request one asset band at a time with band=, and concatenate: the bands partition the scope, so the union is the whole cohort.`,
      {
        responseBytes: size.bytes,
        responseSize: size.human,
        bands: ASSET_BANDS.map((b) => ({ key: b.key, label: b.label })),
        institutions: result.cohort.summaries.length,
      }
    )
  }

  // Sent, but with the size declared so a consumer sees the ceiling coming.
  return ok(
    {
      cohort,
      ...(size.verdict === "near-limit"
        ? {
            sizeWarning: `This response is ${size.human}, ${Math.round(size.share * 100)}% of the ${
              "4.5 MB"
            } ceiling. Switch to band= before it crosses.`,
          }
        : {}),
    },
    meta
  )
}
