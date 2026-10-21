/**
 * Step 1 acceptance: does the registry actually resolve against live EDGAR,
 * and does the Form D maths reproduce a known trail exactly?
 *
 * Run with `npm run verify:peer-registry`. Read-only; touches no cache.
 *
 * The control case is Safe Harbor's own Fund 4, because it is the one raise
 * whose figures were read by hand from the filings during the audit. If the
 * pipeline can reproduce those three rows it can be trusted on a competitor's.
 */

import { layerForLocation } from "../lib/peer-intel/edgar-contract"
import { buildRaise, isLikelyOpen } from "../lib/peer-intel/form-d"
import { PEERS, UNRESOLVED_WATCH, registeredVehiclesInScope, vehiclesInScope } from "../lib/peer-intel/registry"
import { fetchFilerProfile, fetchOfferingHistory } from "../app/services/peer-intel"

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

/** The figures read by hand from Fund 4's three filings during the audit. */
const FUND4_EXPECTED = [
  { filedAt: "2024-03-28", formType: "D", offeringAmount: 500_000_000, totalSold: 0, investorCount: 0 },
  { filedAt: "2025-07-22", formType: "D/A", offeringAmount: 300_000_000, totalSold: 52_918_863, investorCount: 30 },
  { filedAt: "2026-07-23", formType: "D/A", offeringAmount: 300_000_000, totalSold: 64_168_863, investorCount: 40 },
]

async function verifyFund4(asOf: string) {
  console.log("\n— Control case: Safe Harbor Equity Distressed Debt Fund 4 (CIK 2017189)")
  const profile = await fetchFilerProfile("2017189")
  check("profile resolves", profile.name.length > 0, profile.name)
  check("located in Miami Beach", profile.location?.toUpperCase().includes("MIAMI BEACH") === true, profile.location ?? "—")
  check("classified as a Miami-Dade filer", layerForLocation(profile.location) === "miami-dade")
  check("has no periodic reports, so it is private", profile.kind === "private", `${profile.periodic.length} periodic filings`)

  const history = await fetchOfferingHistory(profile)
  const raise = buildRaise(history, asOf)
  if (!raise) {
    check("raise builds", false)
    return
  }

  for (const want of FUND4_EXPECTED) {
    const got = raise.filings.find((f) => f.filedAt === want.filedAt)
    if (!got) {
      check(`filing ${want.filedAt} present`, false)
      continue
    }
    const ok =
      got.formType === want.formType &&
      got.offeringAmount === want.offeringAmount &&
      got.totalSold === want.totalSold &&
      got.investorCount === want.investorCount
    check(
      `${want.filedAt} ${want.formType} matches the filing read by hand`,
      ok,
      `target ${usd(got.offeringAmount)}, sold ${usd(got.totalSold)}, ${got.investorCount} LPs`
    )
  }

  check("target reads $300M", raise.target === 300_000_000, usd(raise.target))
  check("sold reads $64,168,863", raise.sold === 64_168_863, usd(raise.sold))
  check("40 investors", raise.investorCount === 40)
  check(
    "progress is 21.4% of target",
    raise.progress != null && Math.round(raise.progress * 1000) / 10 === 21.4,
    raise.progress == null ? "—" : `${(raise.progress * 100).toFixed(1)}%`
  )
  check(
    "average ticket is $1.60M",
    raise.averageTicket != null && Math.round(raise.averageTicket / 10_000) / 100 === 1.6,
    usd(raise.averageTicket)
  )
  check("twelve-month pace is +$11.25M", raise.soldLastYear === 11_250_000, usd(raise.soldLastYear))
  check("twelve-month pace is +10 investors", raise.investorsLastYear === 10, String(raise.investorsLastYear))
  check("target cut is detected", raise.targetCut === true)
  check("prior target was $500M", raise.targetHigh === 500_000_000, usd(raise.targetHigh))
  check("the raise reads as open", isLikelyOpen(raise))
}

async function verifyRegistry(asOf: string) {
  console.log(`\n— Registry: ${PEERS.length} managers, ${vehiclesInScope("national").length} vehicles`)
  let resolved = 0
  let kindMismatches = 0

  for (const peer of PEERS) {
    for (const vehicle of peer.vehicles) {
      try {
        const profile = await fetchFilerProfile(vehicle.cik)
        resolved++
        if (profile.kind !== vehicle.kind) {
          kindMismatches++
          console.log(
            `  note  ${peer.manager} / ${vehicle.name}: registry says ${vehicle.kind}, EDGAR says ${profile.kind}`
          )
        }
      } catch (error) {
        check(`${peer.manager} / ${vehicle.cik} resolves`, false, error instanceof Error ? error.message : String(error))
      }
    }
  }

  const total = vehiclesInScope("national").length
  check(`all ${total} vehicles resolve on EDGAR`, resolved === total, `${resolved}/${total}`)
  check("every vehicle's audited kind still matches what it files", kindMismatches === 0, `${kindMismatches} changed`)
}

async function verifyLayers() {
  console.log("\n— Layers")
  const local = vehiclesInScope("miami-dade").length
  const state = vehiclesInScope("florida").length
  const national = vehiclesInScope("national").length
  check("layers are cumulative upward", local < state && state < national, `${local} / ${state} / ${national} vehicles`)
  check(
    "the quarterly tier is national only",
    registeredVehiclesInScope("miami-dade").length === 0 && registeredVehiclesInScope("national").length > 0,
    `${registeredVehiclesInScope("national").length} registered vehicles nationally`
  )
  console.log(`  note  ${UNRESOLVED_WATCH.length} watched managers have no resolvable vehicle yet: ${UNRESOLVED_WATCH.join(", ")}`)
}

async function main() {
  const asOf = new Date().toISOString().slice(0, 10)
  console.log(`Peer registry verification — as of ${asOf}, live against SEC EDGAR`)
  await verifyFund4(asOf)
  await verifyRegistry(asOf)
  await verifyLayers()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
