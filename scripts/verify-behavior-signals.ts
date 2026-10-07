/**
 * The behaviour signals against live FDIC data, before anything shows them.
 *
 * Four checks, each a way the signals could be wrong while the code is green:
 *
 *  1. Known cases. BCB Community Bank (35541) moved $10.8M to held-for-sale and
 *     booked a $2.6M loan-sale loss in Q2 2026; Ocean Bank (24156) went from
 *     $0 to $60M of modifications. If those do not fire, the rules are wrong.
 *  2. Scope independence (the spec's acceptance check): every Florida bank's
 *     fired flags are identical whether it is judged in the Florida or the
 *     national cohort. Any difference fails the process.
 *  3. Storage. Each asset band's entry, serialised as the cache would store it,
 *     stays under Next's 2MB Data Cache ceiling — an oversized entry is not an
 *     error, it is a silent recompute on every read.
 *  4. Plausibility. How many banks fire each signal, and the top banks by
 *     action count, so a reader can see whether the thresholds are sensible
 *     before the backtest tunes them.
 *
 * Runs with `--conditions=react-server`, which makes the `server-only` marker
 * inert so the real service module can be imported.
 *
 *   npm run verify:behavior-signals
 *   CERTS=35541,24156 npm run verify:behavior-signals
 */
import { fetchFDICData } from "../lib/fdic-client"
import { FDIC_ENDPOINTS } from "../lib/fdic-config"
import { fetchBehaviorCohort } from "../app/services/bank-behavior"
import {
  ASSET_BANDS,
  CRE_CATEGORY_LABEL,
  SIGNALS,
  SIGNAL_KEYS,
  computeBehaviorSignals,
  rollForward,
  type BankBehaviorSummary,
  type BehaviorSignalsCohort,
} from "../lib/analytics/bank-behavior-signals"
import type { BehaviorHistory } from "../lib/analytics/bank-behavior"
import { formatQuarter } from "../lib/scoring/quarter"

const KNOWN = (process.env.CERTS ?? "35541,24156,14851").split(",").map((s) => s.trim())
const CACHE_CEILING = 2 * 1024 * 1024

const fmt = (v: number | null, dp = 0) => (v === null ? "null" : v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp }))

async function latestQuarter(): Promise<string> {
  const probe = await fetchFDICData<{ REPDTE?: string }>(FDIC_ENDPOINTS.financials, {
    limit: 1,
    fields: ["REPDTE"],
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  return String(probe.data?.[0]?.REPDTE ?? "").replace(/-/g, "")
}

function printBank(s: BankBehaviorSummary, h: BehaviorHistory | undefined): void {
  console.log(`\n--- ${s.cert} ${s.name} (${s.state}) — ${formatQuarter(s.quarter)}${s.current ? "" : " (stale filer)"}, assets ${fmt(s.totalAssets)}, CRE ${fmt(s.creLoans)}, HFS ${fmt(s.measures.hfsBalance)}`)
  console.log(`fired: ${s.fired.length ? s.fired.join(", ") : "none"}${s.unjudged.length ? `   unjudged: ${s.unjudged.join(", ")}` : ""}`)
  const m = s.measures
  console.log(
    `HFS ${fmt(m.hfsPct, 2)}% of loans (Δ ${fmt(m.hfsChangePct, 2)}%, prior high ${fmt(m.hfsTrailingMax)}) | loan-sale G/L Q ${fmt(m.loanSaleGainQ)} (sold in ${fmt(m.priorQuartersWithSales)} of prior 4) | CRE NCO Q ${fmt(m.creNcoRateQ, 3)}% (own avg ${fmt(m.creNcoRateTrailingMean, 3)}%)`
  )
  console.log(
    `nonaccrual Δ ${fmt(m.nonaccrualCreChange)} | unexplained exit ${fmt(m.unexplainedExit)} (${fmt(m.unexplainedExitPctOfCre, 2)}% of CRE, ${fmt(m.unexplainedExitShareOfPrior === null ? null : m.unexplainedExitShareOfPrior * 100, 0)}% of prior) | OREO ${fmt(m.oreoCrePct, 2)}% (Δ ${fmt(m.oreoCreChangePct, 3)}%) | mods ${fmt(m.modificationsCrePct, 2)}% (Δ ${fmt(m.modificationsCreChangePct, 2)}%, past-due Δ ${fmt(m.pastDueCreChange)}) | CRE runoff ${fmt(m.creRunoffPct, 2)}% (4q ${fmt(m.creRunoff4qPct, 2)}%)`
  )
  const pct = Object.entries(s.percentiles).map(([k, v]) => `${k} ${fmt(v, 0)}`).join(", ")
  console.log(`percentiles in scope: ${pct}`)
  if (h) {
    console.log("CRE nonaccrual roll-forward ($000s):")
    console.log("  quarter   prior NA  +90+ prior  − current  − chg-offs  − OREO Δ  = unexplained")
    for (const step of rollForward(h, "cre")) {
      console.log(
        `  ${step.label.padEnd(8)} ${fmt(step.priorNonaccrual).padStart(10)} ${fmt(step.newNonaccrualProxy).padStart(11)} ${fmt(step.currentNonaccrual).padStart(10)} ${fmt(step.chargeOffs).padStart(11)} ${fmt(step.oreoTransferProxy).padStart(9)} ${fmt(step.unexplainedExit).padStart(13)}`
      )
    }
    for (const cat of ["construction", "multifamily", "nonfarmNonres"] as const) {
      const last = rollForward(h, cat).at(-1)
      if (last && last.unexplainedExit !== null && last.unexplainedExit !== 0) console.log(`  ${CRE_CATEGORY_LABEL[cat]}: unexplained ${fmt(last.unexplainedExit)} in ${last.label}`)
    }
  }
}

function printDistribution(cohort: BehaviorSignalsCohort): void {
  console.log(`\n=== ${cohort.scope}: ${cohort.institutionCount} institutions judged (${cohort.currentCount} current at ${cohort.asOfQuarter}, ${cohort.unjudgedCount} with one quarter)`)
  const current = cohort.summaries.filter((s) => s.current)
  for (const spec of SIGNALS) {
    const fired = current.filter((s) => s.fired.includes(spec.key)).length
    const judged = current.filter((s) => !s.unjudged.includes(spec.key)).length
    console.log(`${spec.label.padEnd(28)} ${String(fired).padStart(5)} fired of ${judged} judged (${((fired / Math.max(1, judged)) * 100).toFixed(1)}%)`)
  }
  const multi = current.filter((s) => s.actionCount >= 2).sort((a, b) => b.actionCount - a.actionCount || (b.creLoans ?? 0) - (a.creLoans ?? 0))
  console.log(`\n${multi.length} banks with two or more action signals; top by count then CRE book:`)
  for (const s of multi.slice(0, 15)) {
    console.log(`  ${s.cert.padEnd(6)} ${s.name.slice(0, 32).padEnd(32)} ${(s.state ?? "").slice(0, 14).padEnd(14)} assets ${fmt(s.totalAssets).padStart(12)}  ${s.fired.join(", ")}`)
  }
}

function checkBandSizes(cohort: BehaviorSignalsCohort): boolean {
  console.log(`\n=== ${cohort.scope}: cache entry sizes by asset band (ceiling ${(CACHE_CEILING / 1024 / 1024).toFixed(0)}MB)`)
  let ok = true
  const total = JSON.stringify(cohort).length
  for (const band of ASSET_BANDS) {
    const entry = { ...cohort, band: band.key, summaries: cohort.summaries.filter((s) => s.band === band.key), computedAt: new Date().toISOString() }
    const bytes = JSON.stringify(entry).length
    const fits = bytes < CACHE_CEILING
    if (!fits) ok = false
    console.log(`${band.label.padEnd(14)} ${String(entry.summaries.length).padStart(5)} banks  ${(bytes / 1e6).toFixed(2)} MB ${fits ? "" : " OVER THE CEILING"}`)
  }
  console.log(`whole cohort unchunked: ${(total / 1e6).toFixed(2)} MB${total >= CACHE_CEILING ? " — which is why it is chunked" : ""}`)
  return ok
}

function checkScopeIndependence(national: BehaviorSignalsCohort, florida: BehaviorSignalsCohort): boolean {
  console.log("\n=== Scope independence: Florida banks judged in Florida vs nationally")
  const byCert = new Map(national.summaries.map((s) => [s.cert, s]))
  let compared = 0
  let differing = 0
  for (const fl of florida.summaries) {
    const us = byCert.get(fl.cert)
    if (!us) continue
    compared++
    for (const k of SIGNAL_KEYS) {
      const a = { fired: fl.fired.includes(k), judged: !fl.unjudged.includes(k) }
      const b = { fired: us.fired.includes(k), judged: !us.unjudged.includes(k) }
      if (a.fired !== b.fired || a.judged !== b.judged) {
        differing++
        console.log(`DIFFERS ${fl.cert} ${fl.name} ${k}: Florida ${JSON.stringify(a)} national ${JSON.stringify(b)}`)
      }
    }
  }
  console.log(`${compared} banks × ${SIGNAL_KEYS.length} signals compared, ${differing} differences`)
  return compared > 0 && differing === 0
}

async function main(): Promise<void> {
  const quarter = await latestQuarter()
  console.log(`FDIC latest quarter: ${quarter}`)

  let t = Date.now()
  const nationalPull = await fetchBehaviorCohort("National", quarter)
  console.log(`national pull: ${nationalPull.histories.length} institutions in ${((Date.now() - t) / 1000).toFixed(1)}s; empty quarters: ${nationalPull.emptyQuarters.join(", ") || "none"}`)
  t = Date.now()
  const national = computeBehaviorSignals(nationalPull.histories, "National", quarter)
  console.log(`national signals computed in ${((Date.now() - t) / 1000).toFixed(1)}s`)

  t = Date.now()
  const floridaPull = await fetchBehaviorCohort("Florida", quarter)
  const florida = computeBehaviorSignals(floridaPull.histories, "Florida", quarter)
  console.log(`Florida pull + compute: ${floridaPull.histories.length} institutions in ${((Date.now() - t) / 1000).toFixed(1)}s`)

  const histories = new Map(nationalPull.histories.map((h) => [h.cert, h]))
  console.log("\n=== Known cases")
  for (const cert of KNOWN) {
    const s = national.summaries.find((x) => x.cert === cert)
    if (!s) {
      console.log(`${cert}: not in the national cohort`)
      continue
    }
    printBank(s, histories.get(cert))
  }

  printDistribution(national)
  printDistribution(florida)

  const sizesOk = checkBandSizes(national)
  const scopeOk = checkScopeIndependence(national, florida)

  const bcb = national.summaries.find((s) => s.cert === "35541")
  const ocean = national.summaries.find((s) => s.cert === "24156")
  const knownOk =
    (!bcb || (bcb.fired.includes("hfsTransfer") && bcb.fired.includes("realizedSale"))) && (!ocean || ocean.fired.includes("modificationBuild"))
  console.log(`\nknown cases: ${knownOk ? "ok" : "FAILED (BCB should fire HFS transfer + realized sale; Ocean Bank modification build)"}`)

  if (!sizesOk || !scopeOk || !knownOk) {
    console.error("\nVerification failed.")
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
