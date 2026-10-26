/**
 * Structure, terms and people across a layer's real Form D filings.
 *
 *   npm run verify:peer-structure                    # the US layer: every tracked manager
 *   npm run verify:peer-structure -- --layer florida
 *
 * Read-only; touches no cache. What it establishes:
 *
 *  1. Coverage — how many vehicles carry each field, so the drawer's empty
 *     states are the exception rather than the rule.
 *  2. Co-issuers, and the one that matters most: any **double count**, where a
 *     co-issuer is tracked as a vehicle of its own and its trail holds the same
 *     filing, so its capital is in a manager's total twice. Fails if found.
 *  3. Exemptions and commissions across the layer — which managers can
 *     advertise, which take only qualified purchasers, who pays to raise.
 *  4. Cross-manager name matches, each to be read as a name match, not a
 *     verified identity.
 *  5. The payload cost of carrying terms, against the 2 MB cache entry ceiling.
 */

import type { PeerLayer } from "../lib/peer-intel/edgar-contract"
import { buildPeerCohort } from "../lib/peer-intel/cohort"
import { fetchCohortOfferings } from "../app/services/peer-intel"
import { describeExemptions, minimumChanges, structureRows } from "../lib/peer-intel/structure"
import { buildPeopleIndex, managerPeople, sharedPeople } from "../lib/peer-intel/people"

const args = process.argv.slice(2)
const layer = ((): PeerLayer => {
  const i = args.indexOf("--layer")
  return (i >= 0 ? args[i + 1] : "national") as PeerLayer
})()

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}
const usd = (v: number | null) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`)

async function main() {
  const t = Date.now()
  const offerings = await fetchCohortOfferings(layer)
  const asOf = new Date().toISOString().slice(0, 10)
  const cohort = buildPeerCohort(layer, offerings.byCik, asOf)
  const raises = cohort.managers.flatMap((m) => m.raises.map((r) => ({ m, r })))
  console.log(`${layer}: ${cohort.managers.length} managers, ${raises.length} vehicles with a Form D, fetched in ${((Date.now() - t) / 1000).toFixed(0)}s\n`)

  console.log("1. Coverage")
  const withTerms = raises.filter(({ r }) => r.raise.terms)
  check("every vehicle with a Form D was read with terms", withTerms.length === raises.length, `${withTerms.length}/${raises.length}`)
  const has = (pred: (x: (typeof raises)[number]) => boolean) => raises.filter(pred).length
  console.log(`      exemptions stated            ${has(({ r }) => (r.raise.terms?.exemptions.length ?? 0) > 0)}/${raises.length}`)
  console.log(`      entity type stated           ${has(({ r }) => r.raise.terms?.entityType != null)}/${raises.length}`)
  console.log(`      sales commissions > 0        ${has(({ r }) => (r.raise.terms?.salesCommissions.amount ?? 0) > 0)}/${raises.length}`)
  console.log(`      a fee or proceeds note       ${has(({ r }) => Boolean(r.raise.terms?.feesClarification || r.raise.terms?.proceedsClarification))}/${raises.length}`)
  console.log(`      related persons listed       ${has(({ r }) => r.raise.relatedPersons.length > 0)}/${raises.length}`)
  console.log(`      minimum changed over trail   ${has(({ r }) => minimumChanges(r.raise).length > 0)}/${raises.length}`)

  console.log("\n2. Co-issuers")
  let coCount = 0
  for (const m of cohort.managers) {
    for (const row of structureRows(m, cohort.managers)) {
      for (const c of row.coIssuers) {
        coCount++
        console.log(`      ${m.manager} · ${row.vehicleName}\n         + ${c.name} (${c.jurisdiction ?? "?"}) — ${c.tracking}${c.trackedAs ? ` as "${c.trackedAs}"` : ""}${c.doubleCounted ? "  ⚠ SAME FILING IN BOTH TRAILS" : ""}${c.firstSeen ? `, first listed ${c.firstSeen}` : ""}`)
        if (c.doubleCounted) failures++
      }
    }
  }
  if (!coCount) console.log("      none in this layer")
  check("no co-issuer's capital is counted twice", !cohort.managers.some((m) => structureRows(m, cohort.managers).some((r) => r.coIssuers.some((c) => c.doubleCounted))))

  console.log("\n3. Exemptions and commissions, by fund")
  // Keyed by the filed code, so the label check below tests the mapping itself.
  const tally = new Map<string, number>()
  for (const m of cohort.managers) {
    for (const row of structureRows(m, cohort.managers).filter((r) => r.role === "fund")) {
      for (const e of row.exemptions) tally.set(e.code, (tally.get(e.code) ?? 0) + 1)
      const fees = row.terms.salesCommissions.amount
      console.log(
        `      ${`${m.manager} · ${row.vehicleName}`.slice(0, 66).padEnd(66)} ${row.exemptions.map((e) => e.label).join(", ").padEnd(36)} commissions ${usd(fees)}${row.terms.salesCommissions.estimate ? " (est)" : ""}${row.commissionShare != null ? ` = ${(row.commissionShare * 100).toFixed(2)}% of offering` : ""}`
      )
      for (const ch of row.exemptionChanges) console.log(`         changed ${ch.filedAt}: +${ch.added.map((e) => e.label).join(", ") || "—"} −${ch.removed.map((e) => e.label).join(", ") || "—"}`)
    }
  }
  console.log(`      tally: ${[...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${describeExemptions([k])[0].label} ${n}`).join(" · ")}`)
  check("every exemption code maps to a known label", ![...tally.keys()].some((k) => describeExemptions([k])[0].meaning === "as filed"))

  console.log("\n4. People")
  const index = buildPeopleIndex(cohort.managers)
  const persons = [...index.keys()].filter((k) => k.startsWith("person:")).length
  console.log(`      ${persons} distinct people, ${index.size - persons} entities`)
  const shared = sharedPeople(index)
  if (!shared.length) console.log("      no name appears at two managers")
  for (const s of shared) console.log(`      "${s.name}" at ${s.managers.join(" and ")}  (name match)`)
  const placeholderLeak = [...index.keys()].some((k) => /^(person|entity):(\[none\]|none|--|\.)\s/.test(k))
  check("no placeholder first name leaked into a name", !placeholderLeak)
  const sample = cohort.self ? managerPeople(cohort.self, index) : []
  if (sample.length) console.log(`      Safe Harbor: ${sample.map((p) => `${p.name} (${p.kind}; ${p.roles.join("/")})`).join(", ")}`)

  console.log("\n5. Payload")
  const bytes = Buffer.byteLength(JSON.stringify(cohort), "utf8")
  const termBytes = Buffer.byteLength(JSON.stringify(raises.map(({ r }) => r.raise.terms)), "utf8")
  console.log(`      cohort ${(bytes / 1024).toFixed(0)} KB, of which terms ${(termBytes / 1024).toFixed(0)} KB`)
  check("the cohort stays well inside the 2 MB cache entry ceiling", bytes < 1.5 * 1024 * 1024)

  console.log(`\n${failures ? `${failures} check(s) failed` : "all checks passed"}`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
