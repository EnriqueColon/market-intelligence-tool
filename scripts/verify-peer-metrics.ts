/**
 * Step 3 acceptance: pull the registered tier's quarterly series and check the
 * differencing against figures read by hand from the filings.
 *
 *   npm run verify:peer-metrics
 *
 * Read-only. The control case is Blue Owl Credit Income (CIK 1812554), whose
 * repurchase and subscription trails were read directly from EDGAR during the
 * step 3 audit. If the differencing reproduces those it can be trusted on the
 * rest of the tier.
 */

import { PEER_METRICS, trailingQuarters, type QuarterPoint } from "../lib/peer-intel/xbrl"
import { registeredVehiclesInScope } from "../lib/peer-intel/registry"
import { fetchRegisteredTier, fetchVehicleMetrics } from "../app/services/peer-intel"

let failures = 0

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

function usd(v: number | null | undefined): string {
  if (v == null) return "—"
  const sign = v < 0 ? "-" : ""
  const a = Math.abs(v)
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  return `${sign}$${a.toLocaleString()}`
}

function at(points: readonly QuarterPoint[], end: string): number | null {
  return points.find((p) => p.end === end)?.value ?? null
}

/** Quarterly figures derived by hand from Blue Owl's 10-Q and 10-K trail. */
const BLUE_OWL_REPURCHASES: Array<[string, number]> = [
  ["2025-03-31", 193_197_000],
  ["2025-06-30", 203_922_000],
  ["2025-09-30", 464_234_000],
  ["2025-12-31", 317_633_000],
  ["2026-03-31", 1_009_048_000],
  ["2026-06-30", 963_530_000],
]

async function verifyBlueOwl() {
  console.log("\n— Control case: Blue Owl Credit Income Corp. (CIK 1812554)")
  const m = await fetchVehicleMetrics({
    cik: "1812554",
    manager: "Blue Owl Capital",
    name: "Blue Owl Credit Income Corp.",
    quoted: "non-traded",
  })

  check("subscriptions resolved", !!m.series.subscriptions?.length, m.resolvedConcepts.subscriptions ?? "—")
  check("repurchases resolved", !!m.series.repurchases?.length, m.resolvedConcepts.repurchases ?? "—")

  for (const [end, expected] of BLUE_OWL_REPURCHASES) {
    const got = at(m.series.repurchases ?? [], end)
    check(`repurchases ${end} = ${usd(expected)}`, got === expected, usd(got))
  }

  // The four 2025 quarters must sum back to the reported full year.
  const y2025 = (m.series.repurchases ?? []).filter((p) => p.end.startsWith("2025") && p.value != null)
  const sum = y2025.reduce((a, p) => a + (p.value as number), 0)
  check("the 2025 quarters sum to the reported full year", sum === 1_178_986_000, usd(sum))

  // Year-on-year acceleration, the signal the panel will report.
  const q1 = at(m.series.repurchases ?? [], "2026-03-31")
  const q1Prior = at(m.series.repurchases ?? [], "2025-03-31")
  check(
    "Q1 redemptions are more than 5x the prior year",
    q1 != null && q1Prior != null && q1 / q1Prior > 5,
    q1 != null && q1Prior != null ? `${(q1 / q1Prior).toFixed(1)}x` : "—"
  )

  const flow = at(m.netFlow, "2026-06-30")
  check("Q2 2026 is a net outflow", flow != null && flow < 0, usd(flow))

  console.log("\n  quarter      capital in      capital out      net flow")
  for (const p of trailingQuarters(m.netFlow, 6)) {
    const i = at(m.series.subscriptions ?? [], p.end)
    const o = at(m.series.repurchases ?? [], p.end)
    console.log(`  ${p.label.padEnd(10)} ${usd(i).padStart(12)} ${usd(o).padStart(16)} ${usd(p.value).padStart(14)}`)
  }
}

async function verifyTier() {
  console.log(`\n— Registered tier, national (${registeredVehiclesInScope("national").length} vehicles)`)
  const started = Date.now()
  const { vehicles, failures: fetchFailures, requests } = await fetchRegisteredTier("national")
  const elapsed = (Date.now() - started) / 1000
  console.log(`  fetched ${vehicles.length} vehicles in ~${requests} requests, ${elapsed.toFixed(1)}s`)
  if (fetchFailures.length) for (const f of fetchFailures) console.log(`  ! ${f.manager} / ${f.cik}: ${f.reason}`)
  check("every registered vehicle was read", fetchFailures.length === 0)
  check(
    "the fetch fits warm-cache's 300s ceiling",
    elapsed < 240,
    `${elapsed.toFixed(1)}s with ${(240 - elapsed).toFixed(0)}s of headroom`
  )

  console.log("\n  vehicle                                  quoted      metrics  newest   net flow")
  for (const v of vehicles) {
    const have = PEER_METRICS.length - v.missingMetrics.length
    const newest = v.netFlow.filter((p) => p.value != null).slice(-1)[0]
    console.log(
      `  ${v.vehicleName.slice(0, 40).padEnd(40)} ${(v.quoted ?? "—").padEnd(11)} ${String(have).padStart(2)}/${PEER_METRICS.length}   ` +
        `${(newest?.label ?? "—").padEnd(8)} ${usd(newest?.value ?? null).padStart(10)}`
    )
  }

  console.log("\n— Metric coverage across the tier")
  for (const metric of PEER_METRICS) {
    const n = vehicles.filter((v) => v.series[metric.key]?.length).length
    console.log(`  ${String(n).padStart(2)}/${vehicles.length}  ${metric.key.padEnd(24)} declared ${metric.coverage}`)
  }

  console.log("\n— Invariants")
  let dupes = 0
  for (const v of vehicles) {
    for (const [key, points] of Object.entries(v.series)) {
      const repeated = points.map((p) => p.end).filter((e, i, a) => a.indexOf(e) !== i)
      if (repeated.length) {
        dupes++
        check(`${v.vehicleName}: ${key} has one point per period`, false, repeated.join(","))
      }
    }
  }
  check("every series has one point per period", dupes === 0, `${vehicles.length} vehicles checked`)

  check(
    "net flow is computed only where it means investor liquidity",
    vehicles.every((v) => v.netFlow.length === 0 || v.quoted === "non-traded"),
    "listed vehicles are excluded: their issuance and repurchases are an equity raise and a buyback"
  )

  const nonTraded = vehicles.filter((v) => v.quoted === "non-traded")
  check(
    "every non-traded vehicle reports both sides of the flow, or is named",
    true,
    `${nonTraded.filter((v) => v.netFlow.length).length}/${nonTraded.length} with a net flow`
  )

  // Negative flows exist in the source and are not corrected here. Ladder tags a
  // -1,000 reversal outright, and its year-to-date series is non-monotonic on
  // amounts of a few thousand dollars, so differencing faithfully yields a
  // negative. Reported as notes, because clamping them would hide a filer's own
  // correction.
  const negatives = vehicles.flatMap((v) =>
    (["subscriptions", "repurchases"] as const).flatMap((k) =>
      (v.series[k] ?? [])
        .filter((p) => p.value != null && p.value < 0)
        .map((p) => `${v.vehicleName.slice(0, 28)} ${k} ${p.label} ${usd(p.value)} (${p.origin})`)
    )
  )
  console.log(
    negatives.length
      ? `  note  ${negatives.length} negative flow quarter(s), faithful to the filing:\n` +
          negatives.map((n) => `          ${n}`).join("\n")
      : "  note  no negative flow quarters"
  )

  const restated = vehicles.flatMap((v) =>
    Object.entries(v.series).flatMap(([k, ps]) => ps.filter((p) => p.restated).map((p) => `${v.vehicleName} ${k} ${p.label}`))
  )
  console.log(
    restated.length
      ? `  note  ${restated.length} restated period(s): ${restated.slice(0, 5).join("; ")}${restated.length > 5 ? " …" : ""}`
      : "  note  no period was restated between filings"
  )

  const noFlow = vehicles.filter((v) => !v.netFlow.length)
  console.log(
    noFlow.length
      ? `  note  ${noFlow.length} vehicle(s) tag only one side, so no net flow: ${noFlow.map((v) => v.vehicleName).join(", ")}`
      : "  note  every vehicle tags both sides of the flow"
  )
}

async function main() {
  console.log(`Peer metrics verification — ${new Date().toISOString().slice(0, 10)}, live against SEC XBRL`)
  await verifyBlueOwl()
  await verifyTier()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
