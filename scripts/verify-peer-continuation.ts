/**
 * Continuation-vehicle detection against live EDGAR, for one layer.
 *
 *   npm run verify:peer-continuation -- national      # or miami-dade, florida
 *
 * Reads the layer's Form D trails (the expensive part, the same fetch the
 * tab's build makes), attaches the committed ADV extract, runs the search and
 * prints every manager's result: the terms searched, each vehicle with its
 * kind, what attributed it, what its Form D and ADV say, and the hits dropped
 * for lack of attribution. Fails if any manager's search failed, or if the
 * national layer does not find the vehicles the ADV already names — Bridge
 * Multifamily CV, Pretium's Residential Credit Annex Fund and H.I.G.'s Europe
 * Realty III Annex Fund — since those are the check that the two sources meet.
 */

import type { PeerLayer } from "../lib/peer-intel/edgar-contract"
import { buildPeerCohort } from "../lib/peer-intel/cohort"
import { peersInScope } from "../lib/peer-intel/registry"
import { buildLayerAdv, fetchCohortOfferings, fetchContinuationVehicles } from "../app/services/peer-intel"
import { money } from "../lib/peer-intel/panel"

const layer = (process.argv[2] ?? "national") as PeerLayer
if (!["miami-dade", "florida", "national"].includes(layer)) {
  console.error(`unknown layer ${layer}`)
  process.exit(2)
}

const EXPECTED: Record<string, RegExp[]> = {
  "bridge-investment-group": [/Bridge Multifamily CV/i],
  "pretium-partners": [/Pretium Residential Credit Annex/i],
  "hig-bayside": [/H\.I\.G\. Europe Realty Partners III Annex/i],
}

async function main() {
  const asOf = new Date().toISOString().slice(0, 10)
  const t = Date.now()
  const offerings = await fetchCohortOfferings(layer)
  const cohort = buildPeerCohort(layer, offerings.byCik, asOf)
  const adv = buildLayerAdv(layer, cohort)
  console.log(`${layer}: ${cohort.managers.length} managers, ${offerings.requests} Form D requests, ${((Date.now() - t) / 1000).toFixed(0)}s\n`)

  const t2 = Date.now()
  const result = await fetchContinuationVehicles(layer, cohort, adv)
  console.log(`search: ${result.requests} requests, ${((Date.now() - t2) / 1000).toFixed(0)}s\n`)

  let shown = 0
  const problems: string[] = []
  for (const peer of peersInScope(layer)) {
    const v = result.byManager[peer.id]
    if (!v) {
      problems.push(`${peer.manager}: no view`)
      continue
    }
    console.log(`${peer.manager} — ${v.searched ? `searched ${v.terms.length} terms` : "NOT searched"}; ${v.vehicles.length} vehicles, ${v.unconfirmed.length} unconfirmed`)
    for (const x of v.vehicles) {
      shown++
      const by = x.attribution.map((a) => (a.basis === "adv" ? "ADV" : a.basis === "name" ? `name "${a.phrase}"` : `people ${a.names.join(", ")}`)).join(" · ")
      console.log(`    [${x.kind}] ${x.name}${x.tracked ? " (tracked)" : ""} — by ${by}`)
      if (x.formD) {
        const sales = !x.formD.sold && !x.formD.investorCount ? "no sale reported yet" : `first sale ${x.formD.firstSale ?? "—"}, raised ${money(x.formD.sold)} from ${x.formD.investorCount ?? "—"} investors`
        console.log(`        Form D: ${sales}, offering ${money(x.formD.target)}, ${x.formD.filings} filings, last ${x.formD.lastFiled ?? "—"}`)
      }
      if (x.adv) console.log(`        ADV: gross ${money(x.adv.grossAssetValue)}, ${x.adv.fundTypes.join(", ") || "type not reported"}, ${x.adv.beneficialOwners ?? "—"} owners${x.adv.isFeederFund ? ", feeder" : ""}`)
      if (x.predecessor) console.log(`        likely continues ${x.predecessor.name}`)
    }
    for (const u of v.unconfirmed) console.log(`    unconfirmed: ${u.name} (CIK ${u.cik})`)
    for (const want of EXPECTED[peer.id] ?? []) {
      if (!v.vehicles.some((x) => want.test(x.name))) problems.push(`${peer.manager}: expected a vehicle matching ${want}`)
    }
  }
  for (const f of result.failures) problems.push(`${f.manager}: ${f.reason}`)

  console.log(`\n${shown} vehicles shown across ${Object.keys(result.byManager).length} managers`)
  if (problems.length) {
    console.log(`\n${problems.length} problems:\n  ${problems.join("\n  ")}`)
    process.exit(1)
  }
  console.log("OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
