/**
 * The whole-scope national behaviour-signals response, measured in bytes.
 *
 *   npm run measure:signals-response
 *
 * `/api/analytics/v1/behavior-signals` refuses a response at
 * `RESPONSE_REFUSE_BYTES`, and AMO Tracker requests the whole national scope
 * in one call — so whether AMO's page works is a question of this one number.
 * It moves whenever FDIC publishes a quarter or a summary gains a field, which
 * is how it went from 3.90 MB to 4.02 MB with Seller Likelihood.
 *
 * Builds exactly what the route serialises — the same cohort computation as
 * `app/actions/bank-behavior-signals.ts`, the same `{ ok, meta, cohort }`
 * envelope, the same byte count as `measureResponse` — from live FDIC data,
 * without the Next cache in the way. Read-only; touches no cache. About a
 * minute, most of it the national FDIC pull.
 */

import { fetchFDICData } from "../lib/fdic-client"
import { FDIC_ENDPOINTS } from "../lib/fdic-config"
import { fetchBehaviorCohort } from "../app/services/bank-behavior"
import { computeBehaviorSignals } from "../lib/analytics/bank-behavior-signals"
import { withSellerFields } from "../lib/analytics/seller-likelihood"
import {
  RESPONSE_BYTE_LIMIT,
  RESPONSE_REFUSE_BYTES,
  RESPONSE_WARN_BYTES,
  describeBytes,
  responseSizeVerdict,
} from "../lib/analytics/api-contract"

async function latestQuarter(): Promise<string> {
  const probe = await fetchFDICData<{ REPDTE?: string }>(FDIC_ENDPOINTS.financials, {
    limit: 1,
    fields: ["REPDTE"],
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  return String(probe.data?.[0]?.REPDTE ?? "").replace(/-/g, "")
}

async function main() {
  const quarter = await latestQuarter()
  const t = Date.now()
  const pull = await fetchBehaviorCohort("National", quarter)
  // Mirrors computeCohort in app/actions/bank-behavior-signals.ts.
  const asOf = pull.emptyQuarters.includes(pull.asOfQuarter)
    ? [...pull.quarters].reverse().find((q) => !pull.emptyQuarters.includes(q)) ?? pull.asOfQuarter
    : pull.asOfQuarter
  const scored = withSellerFields(computeBehaviorSignals(pull.histories, "National", asOf), pull.histories)
  const cohort = {
    scope: scored.scope,
    asOfQuarter: scored.asOfQuarter,
    institutionCount: scored.institutionCount,
    currentCount: scored.currentCount,
    unjudgedCount: scored.unjudgedCount,
    summaries: scored.summaries,
  }
  // The meta block the route adds is a few hundred bytes; this is its shape.
  const meta = {
    apiVersion: "v1",
    contractVersion: 1,
    quarter,
    scope: "National",
    servedAt: new Date().toISOString(),
  }
  const bytes = Buffer.byteLength(JSON.stringify({ ok: true, meta, cohort }), "utf8")

  const mb = (n: number) => `${n.toLocaleString()} bytes (${describeBytes(n)})`
  console.log(`FDIC latest quarter ${quarter}, judged as of ${asOf}; ${cohort.summaries.length} institutions; pulled in ${((Date.now() - t) / 1000).toFixed(0)}s`)
  console.log(`whole-scope national response: ${mb(bytes)}`)
  console.log(`  warn at           ${mb(RESPONSE_WARN_BYTES)}`)
  console.log(`  refuse at         ${mb(RESPONSE_REFUSE_BYTES)}   → headroom ${mb(RESPONSE_REFUSE_BYTES - bytes)}`)
  console.log(`  platform ceiling  ${mb(RESPONSE_BYTE_LIMIT)}   (the lower reading of Vercel's "4.5 MB")`)
  console.log(`verdict: ${responseSizeVerdict(bytes)}`)
  process.exit(responseSizeVerdict(bytes) === "too-large" ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
