/**
 * Step 2 acceptance: pull every vehicle's Form D trail in a layer and check the
 * aggregation against live data.
 *
 *   npm run verify:peer-raises                 # Miami-Dade (fast)
 *   npm run verify:peer-raises -- --layer florida
 *   npm run verify:peer-raises -- --layer national
 *
 * Read-only; touches no cache. The national layer issues a few hundred requests
 * and takes about a minute, which is also the measurement the weekly cron
 * budget in step 4 depends on — the script reports it.
 */

import type { PeerLayer } from "../lib/peer-intel/edgar-contract"
import { PRIVATE_FUND_LIMITS } from "../lib/peer-intel/catalog"
import {
  activeRaises,
  buildPeerCohort,
  newLaunches,
  selfPositioning,
  type PeerCohort,
} from "../lib/peer-intel/cohort"
import { fetchCohortOfferings } from "../app/services/peer-intel"

let failures = 0

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

function usd(v: number | "indefinite" | null): string {
  if (v === "indefinite") return "indefinite"
  if (v == null) return "—"
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toLocaleString()}`
}

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** Invariants that must hold whatever the live figures say. */
function checkInvariants(cohort: PeerCohort) {
  console.log("\n— Invariants")

  const funds = cohort.managers.flatMap((m) => m.raises.filter((r) => r.role === "fund"))
  const sleeves = cohort.managers.flatMap((m) => m.raises.filter((r) => r.role === "sleeve"))
  check(
    "raises are counted over funds, not filers",
    cohort.totals.raiseCount === funds.length,
    `${cohort.totals.raiseCount} raises across ${funds.length + sleeves.length} vehicles (${sleeves.length} sleeves)`
  )

  const everyVehicleSold = cohort.managers
    .flatMap((m) => m.raises.map((r) => r.raise.sold))
    .filter((v): v is number => v != null)
    .reduce((a, b) => a + b, 0)
  check(
    "capital sums over every vehicle, sleeves included",
    cohort.totals.totalRaised === everyVehicleSold,
    usd(cohort.totals.totalRaised)
  )

  const badProgress = funds.filter((r) => r.raise.target === "indefinite" && r.raise.progress != null)
  check("no percentage is computed against an indefinite offering", badProgress.length === 0, `${badProgress.length} bad`)

  const negative = funds.filter((r) => (r.raise.sold ?? 0) < 0)
  check("no raise reports negative capital", negative.length === 0)

  const closedButOpen = funds.filter((r) => r.open && (r.raise.quartersSinceFiling ?? 0) >= 4)
  check("open raises all filed within four quarters", closedButOpen.length === 0)

  const selfRows = cohort.managers.filter((m) => m.isSelf)
  check("exactly one manager is marked self", selfRows.length === 1)

  check(
    "every vehicle is accounted for as registered or private",
    cohort.coverage.registeredVehicles + cohort.coverage.privateVehicles === cohort.totals.vehicles,
    `${cohort.totals.vehicles} vehicles`
  )
  check(
    "no private vehicle is left unresolved",
    cohort.coverage.unresolvedVehicles === 0,
    `${cohort.coverage.unresolvedVehicles} unresolved, ${cohort.coverage.registeredWithoutFormD} registered without Form D (expected)`
  )
}

async function main() {
  const layer = arg("layer", "miami-dade") as PeerLayer
  const asOf = new Date().toISOString().slice(0, 10)
  console.log(`Peer raises verification — layer "${layer}", as of ${asOf}, live against SEC EDGAR`)

  const started = Date.now()
  const { byCik, failures: fetchFailures, noFormD, requests } = await fetchCohortOfferings(layer)
  const elapsed = (Date.now() - started) / 1000
  console.log(`\nFetched ${byCik.size} vehicles in ${requests} requests, ${elapsed.toFixed(1)}s.`)
  if (noFormD.length) {
    console.log(
      `${noFormD.length} registered vehicle(s) file no Form D, as expected — they raise through a ` +
        `registered offering, and step 3 reads their issuance from the periodic reports:`
    )
    for (const v of noFormD) console.log(`  · ${v.manager} / CIK ${v.cik}`)
  }
  if (fetchFailures.length) {
    console.log(`${fetchFailures.length} vehicle(s) unreadable — these are real gaps:`)
    for (const f of fetchFailures) console.log(`  ! ${f.manager} / CIK ${f.cik}: ${f.reason}`)
  }
  check("no private vehicle is missing its Form D", fetchFailures.length === 0, `${fetchFailures.length} gap(s)`)
  check(
    `the fetch fits warm-cache's 300s ceiling`,
    elapsed < 240,
    `${elapsed.toFixed(1)}s with ${(240 - elapsed).toFixed(0)}s of headroom`
  )

  const cohort = buildPeerCohort(layer, byCik, asOf)

  console.log(`\n— Raise environment, ${layer}`)
  const t = cohort.totals
  console.log(`  managers            ${t.managers} (${t.managersRaising} in market)`)
  console.log(`  raises              ${t.raiseCount} (${t.activeRaiseCount} open)`)
  console.log(`  capital raised      ${usd(t.totalRaised)}`)
  console.log(`  capital sought      ${usd(t.totalSought)}  (${t.indefiniteTargets} indefinite, excluded)`)
  console.log(`  launches, 12 months ${t.newLaunchCount}`)
  console.log(`  offerings cut       ${t.targetCutCount}`)
  console.log(
    `  coverage            ${cohort.coverage.registeredVehicles} registered ` +
      `(${cohort.coverage.registeredWithoutFormD} with no Form D, expected), ` +
      `${cohort.coverage.privateVehicles} private, ${cohort.coverage.unresolvedVehicles} unresolved`
  )

  console.log(`\n— Open raises (${activeRaises(cohort).length})`)
  for (const r of activeRaises(cohort).slice(0, 14)) {
    console.log(
      `  ${r.raise.lastFiled}  ${r.manager.slice(0, 26).padEnd(26)} ${r.vehicleName.slice(0, 44).padEnd(44)} ` +
        `target ${usd(r.raise.target).padEnd(12)} sold ${usd(r.raise.sold).padEnd(10)} ${pct(r.raise.progress).padStart(7)}` +
        `${r.raise.targetCut ? `  cut from ${usd(r.raise.targetHigh)}` : ""}`
    )
  }

  const launches = newLaunches(cohort)
  console.log(`\n— Launched in the last twelve months (${launches.length})`)
  for (const r of launches) {
    console.log(
      `  first sale ${r.raise.firstSale ?? r.raise.firstFiled}  ${r.manager.slice(0, 26).padEnd(26)} ` +
        `${r.vehicleName.slice(0, 44).padEnd(44)} sold ${usd(r.raise.sold)}`
    )
  }

  const pos = selfPositioning(cohort)
  console.log("\n— Safe Harbor against this layer")
  if (!pos) {
    console.log("  no open self raise, or fewer than three comparable peer raises — reported as nothing, by design.")
  } else {
    console.log(`  ${pos.selfRaise.vehicleName}`)
    console.log(`  raised       ${usd(pos.selfRaise.raise.sold)}  (${pct(pos.selfRaise.raise.progress)} of offering)`)
    console.log(`  rank by size ${pos.rankBySold} of ${pos.peerCount + 1} open raises`)
    console.log(`  peer median  ${usd(pos.medianSold)} raised, ${pct(pos.medianProgress)} of offering`)
  }

  checkInvariants(cohort)

  console.log("\n— What Form D cannot show (stated on every private-fund panel)")
  for (const limit of PRIVATE_FUND_LIMITS) console.log(`  · ${limit}`)

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
