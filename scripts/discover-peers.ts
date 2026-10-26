/**
 * Peer discovery: find the Miami-Dade and Florida layers from EDGAR.
 *
 * Run with `npm run discover:peers`. Writes nothing — it prints a candidate
 * list for review, which is then curated into `lib/peer-intel/registry.ts`.
 * Discovery is deliberately a separate step from the registry so that a human
 * decides who counts as a peer; the search only proposes.
 *
 *   npm run discover:peers                 # Florida, last three years
 *   npm run discover:peers -- --years 5
 *   npm run discover:peers -- --state NY
 */

import {
  DISCOVERY_NAME_PATTERNS,
  layerForLocation,
  type PeerLayer,
} from "../lib/peer-intel/edgar-contract"
import { buildRaise } from "../lib/peer-intel/form-d"
import { discoverFilers, fetchFilerProfile, fetchOfferingHistory } from "../app/services/peer-intel"

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function usd(v: number | "indefinite" | null): string {
  if (v === "indefinite") return "indefinite"
  if (v == null) return "—"
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toLocaleString()}`
}

async function main() {
  const state = arg("state", "FL").toUpperCase()
  const years = Number(arg("years", "3"))
  const enddt = new Date().toISOString().slice(0, 10)
  const start = new Date()
  start.setFullYear(start.getFullYear() - years)
  const startdt = start.toISOString().slice(0, 10)
  const asOf = enddt

  console.log(`Peer discovery — ${state}, Form D filings ${startdt} to ${enddt}`)
  console.log(`${DISCOVERY_NAME_PATTERNS.length} name patterns; Form D full-text matches names only.\n`)

  const filers = await discoverFilers({
    locationCodes: state,
    patterns: DISCOVERY_NAME_PATTERNS,
    startdt,
    enddt,
  })
  console.log(`${filers.length} candidate filers after name exclusions.\n`)

  const rows: Array<{
    layer: PeerLayer
    cik: string
    name: string
    location: string
    kind: string
    target: string
    sold: string
    progress: string
    investors: string
    lastFiled: string
    open: string
    cut: string
  }> = []

  for (const filer of filers) {
    try {
      const profile = await fetchFilerProfile(filer.cik)
      const history = await fetchOfferingHistory(profile)
      const raise = buildRaise(history, asOf)
      rows.push({
        // The submissions profile carries the filer's *current* business
        // address; a full-text hit carries whatever the matched filing had,
        // which may be years stale. So the profile wins, and the hit is only a
        // fallback for a profile that reports no address at all.
        layer: profile.location ? profile.layer : layerForLocation(filer.location),
        cik: filer.cik,
        name: (raise?.fundName || profile.name || filer.name).slice(0, 54),
        location: (profile.location ?? filer.location ?? "—").slice(0, 22),
        kind: profile.kind,
        target: usd(raise?.target ?? null),
        sold: usd(raise?.sold ?? null),
        progress: raise?.progress == null ? "—" : `${(raise.progress * 100).toFixed(1)}%`,
        investors: raise?.investorCount == null ? "—" : String(raise.investorCount),
        lastFiled: raise?.lastFiled ?? filer.latestFiling.filedAt,
        open: raise == null ? "?" : raise.quartersSinceFiling != null && raise.quartersSinceFiling < 4 ? "open" : "quiet",
        cut: raise?.targetCut ? `cut from ${usd(raise.targetHigh)}` : "",
      })
    } catch (error) {
      console.warn(`  ! ${filer.cik} ${filer.name}: ${error instanceof Error ? error.message : error}`)
    }
  }

  for (const layer of ["miami-dade", "florida", "national"] as const) {
    const group = rows.filter((r) => r.layer === layer)
    if (!group.length) continue
    console.log(`\n=== ${layer.toUpperCase()} (${group.length}) ===`)
    group.sort((a, b) => (a.lastFiled < b.lastFiled ? 1 : -1))
    for (const r of group) {
      console.log(
        `  ${r.lastFiled}  ${r.kind.padEnd(10)} ${r.open.padEnd(5)} ` +
          `${r.name.padEnd(54)} ${r.location.padEnd(22)} ` +
          `target ${r.target.padEnd(12)} sold ${r.sold.padEnd(10)} ${r.progress.padStart(6)} ` +
          `${r.investors.padStart(4)} LPs  ${r.cut}`
      )
      console.log(`${" ".repeat(13)}CIK ${r.cik}`)
    }
  }

  const registered = rows.filter((r) => r.kind === "registered").length
  console.log(
    `\n${rows.length} resolved; ${registered} registered (quarterly figures observable), ` +
      `${rows.length - registered} private (fundraising depth only).`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
