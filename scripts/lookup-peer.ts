/**
 * Find a named manager's EDGAR vehicles.
 *
 * `scripts/discover-peers.ts` searches by location and name *pattern*, which
 * finds funds whose legal names happen to describe the strategy. A manager
 * whose funds are named after the firm rather than the strategy — Rialto Real
 * Estate Fund, Bridge Debt Strategies — is invisible to it. This looks a
 * specific manager up by name instead, which is what `UNRESOLVED_WATCH` in
 * `lib/peer-intel/registry.ts` needs before those managers can be added.
 *
 *   npm run lookup:peer -- "Rialto Capital"
 *   npm run lookup:peer -- "Madison Realty Capital" "Pretium"
 *
 * Prints one block per manager: the Form D filers whose names match, each with
 * its layer, kind and newest raise. Writes nothing — the registry stays a
 * reviewed file.
 */

import { layerForLocation } from "../lib/peer-intel/edgar-contract"
import { buildRaise, type OfferingRecord } from "../lib/peer-intel/form-d"
import { fetchFilerProfile, fetchOfferingHistory, searchFilings, type FtsHit } from "../app/services/peer-intel"

function usd(v: number | "indefinite" | null): string {
  if (v === "indefinite") return "indefinite"
  if (v == null) return "—"
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toLocaleString()}`
}

/** Does the filer name actually contain the manager's name, token for token? */
function nameMatches(filerName: string, manager: string): boolean {
  const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `
  return norm(filerName).includes(norm(manager).trim())
}

async function lookup(manager: string, asOf: string) {
  console.log(`\n=== ${manager} ===`)

  // Both forms: Form D finds private vehicles, 10-Q finds registered ones.
  const hits = new Map<string, FtsHit>()
  for (const forms of [["D"], ["10-Q"]]) {
    try {
      const page = await searchFilings({ q: `"${manager}"`, forms })
      for (const hit of page.hits) {
        if (!nameMatches(hit.name, manager)) continue
        const existing = hits.get(hit.cik)
        if (!existing || hit.filedAt > existing.filedAt) hits.set(hit.cik, hit)
      }
    } catch (error) {
      console.log(`  ! ${forms.join("/")} search failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  if (!hits.size) {
    console.log("  no EDGAR filer name contains this manager's name.")
    console.log("  Either it does not raise through Reg D / does not report, or its funds are named differently.")
    return
  }

  for (const hit of [...hits.values()].sort((a, b) => (a.filedAt < b.filedAt ? 1 : -1))) {
    try {
      const profile = await fetchFilerProfile(hit.cik)
      const layer = profile.location ? profile.layer : layerForLocation(hit.location)
      let history: OfferingRecord[] = []
      if (profile.formD.length) history = await fetchOfferingHistory(profile)
      const raise = history.length ? buildRaise(history, asOf) : null
      console.log(
        `  ${profile.name.slice(0, 56).padEnd(56)} CIK ${profile.cik.padEnd(8)} ${layer.padEnd(11)} ${profile.kind.padEnd(10)} ` +
          `${profile.location ?? "—"}`
      )
      if (raise) {
        console.log(
          `${" ".repeat(4)}target ${usd(raise.target).padEnd(12)} sold ${usd(raise.sold).padEnd(10)} ` +
            `${raise.investorCount ?? "—"} LPs  last filed ${raise.lastFiled}` +
            `${raise.targetCut ? `  (cut from ${usd(raise.targetHigh)})` : ""}`
        )
      } else if (profile.periodic.length) {
        const newest = profile.periodic[0]
        console.log(`${" ".repeat(4)}no Form D; reports quarterly — newest ${newest.form} ${newest.filedAt}`)
      }
    } catch (error) {
      console.log(`  ! CIK ${hit.cik} (${hit.name}): ${error instanceof Error ? error.message : error}`)
    }
  }
}

async function main() {
  const managers = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (!managers.length) {
    console.error('Usage: npm run lookup:peer -- "Manager Name" ["Another Manager"]')
    process.exitCode = 1
    return
  }
  const asOf = new Date().toISOString().slice(0, 10)
  for (const manager of managers) await lookup(manager, asOf)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
