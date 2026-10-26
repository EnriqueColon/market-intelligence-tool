/**
 * Propose, or verify, each tracked manager's SEC adviser (CRD) from IAPD.
 *
 *   npm run resolve:peer-crds                 # propose: a review table for every manager
 *   npm run resolve:peer-crds -- --layer florida
 *   npm run verify:peer-crds                  # verify: every CRD in the registry still resolves
 *
 * Read-only against IAPD and EDGAR; writes nothing to the registry. The
 * propose run prints a review table and saves the full candidate lists as
 * JSON (path in `--out`, default the scratchpad) so a person can confirm each
 * CRD and record it in `lib/peer-intel/registry.ts` with its basis.
 *
 * Each manager is searched under its registry name, its aliases, and the GP
 * and investment-manager entities its own Form D filings list — which is how
 * a manager IAPD cannot find by name (BH3 Management) is found under the name
 * it actually registered (BH3 Fund Advisors, LLC). The Form D trails come from
 * `fetchCohortOfferings`, the same live pull the other verify scripts use.
 *
 * Verify mode checks that each recorded CRD still returns from IAPD under a
 * name that matches the recorded adviser, and is still active.
 */

import type { PeerLayer } from "../lib/peer-intel/edgar-contract"
import { buildPeerCohort } from "../lib/peer-intel/cohort"
import { fetchCohortOfferings } from "../app/services/peer-intel"
import {
  IAPD_SPACING_MS,
  firmKey,
  iapdSearchUrl,
  parseIapdHit,
  resolveManager,
  type IapdHit,
  type Resolution,
} from "../lib/peer-intel/iapd"
import { PEERS, peersInScope } from "../lib/peer-intel/registry"
import { writeFileSync } from "node:fs"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const VERIFY = args.includes("--verify")
const layer = (flag("layer") ?? "national") as PeerLayer
const OUT =
  flag("out") ??
  `${process.env.CLAUDE_SCRATCHPAD ?? "/tmp"}/peer-crd-proposals-${new Date().toISOString().slice(0, 10)}.json`

const HEADERS = {
  "User-Agent": `MarketIntelligence/1.0 (${process.env.SEC_EDGAR_CONTACT?.trim() || "market-intelligence@safeharborcp.com"})`,
  Accept: "application/json",
}

let last = 0
async function search(query: string): Promise<{ total: number; hits: IapdHit[] }> {
  const wait = Math.max(0, IAPD_SPACING_MS - (Date.now() - last))
  if (wait) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  const res = await fetch(iapdSearchUrl(query), { headers: HEADERS })
  if (!res.ok) throw new Error(`IAPD ${res.status} for "${query}"`)
  const body = (await res.json()) as { hits?: { total?: number; hits?: Array<{ _source?: unknown }> } }
  const hits = (body.hits?.hits ?? []).map((h) => parseIapdHit((h._source ?? {}) as Parameters<typeof parseIapdHit>[0])).filter((h): h is IapdHit => h != null)
  return { total: body.hits?.total ?? hits.length, hits }
}

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

async function propose() {
  console.log(`Resolving ${layer} managers to IAPD adviser records…\n`)
  const offerings = await fetchCohortOfferings(layer)
  const cohort = buildPeerCohort(layer, offerings.byCik, new Date().toISOString().slice(0, 10))
  const entitiesByPeer = new Map<string, string[]>()
  for (const m of cohort.managers) {
    const names = new Set<string>()
    for (const r of m.raises) for (const p of r.raise.relatedPersons) if (p.kind === "entity") names.add(p.name)
    entitiesByPeer.set(m.peerId, [...names])
  }

  const results: Resolution[] = []
  for (const peer of peersInScope(layer)) {
    const related = entitiesByPeer.get(peer.id) ?? []
    // Search the manager, its aliases of two words or more, and its Form D entities.
    const terms = [...new Set([peer.manager, ...peer.aliases.filter((a) => a.trim().split(/\s+/).length >= 2), ...related])]
    const seen: IapdHit[] = []
    let total = 0
    for (const term of terms) {
      try {
        const { total: t, hits } = await search(term)
        total = Math.max(total, t)
        seen.push(...hits)
      } catch (e) {
        console.log(`  ${peer.manager}: search "${term}" failed — ${(e as Error).message}`)
      }
    }
    results.push(resolveManager(peer, related, seen, total))
  }

  console.log(`${"manager".padEnd(32)} ${"status".padEnd(10)} ${"CRD".padEnd(8)} ${"SEC no.".padEnd(11)} ${"score".padEnd(5)} adviser name on IAPD / note`)
  for (const r of results) {
    const b = r.best
    console.log(
      `${r.manager.slice(0, 31).padEnd(32)} ${r.status.padEnd(10)} ${(b?.hit.crd ?? "—").padEnd(8)} ${(b?.hit.secNumber ?? "—").padEnd(11)} ${String(b?.score ?? "").padEnd(5)} ${b ? b.hit.name : ""}${r.status !== "resolved" ? `  ← ${r.note}` : ""}`
    )
    if (r.status === "ambiguous") {
      for (const c of r.candidates.slice(0, 4)) console.log(`${"".padEnd(43)} ${c.hit.crd.padEnd(8)} ${(c.hit.secNumber ?? "—").padEnd(11)} ${String(c.score).padEnd(5)} ${c.hit.name} [${c.hit.city ?? "?"}, ${c.hit.state ?? "?"}] — ${c.reasons.join("; ")}`)
    }
  }
  const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>)
  console.log(`\n${results.length} managers: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`)
  console.log(`Already recorded in the registry: ${PEERS.filter((p) => p.adviser).length} advisers, ${PEERS.filter((p) => p.noAdviser).length} reviewed as none.`)
  writeFileSync(OUT, JSON.stringify(results, null, 2))
  console.log(`Full candidate lists written to ${OUT}`)
}

async function verify() {
  console.log("Verifying the registry's adviser records against IAPD…\n")
  const recorded = PEERS.filter((p) => p.adviser)
  for (const p of recorded) {
    const a = p.adviser!
    const { hits } = await search(a.name)
    const match = hits.find((h) => h.crd === a.crd)
    check(`${p.manager}: CRD ${a.crd} returns from IAPD`, Boolean(match))
    if (!match) continue
    check(`${p.manager}: IAPD name matches the recorded "${a.name}"`, firmKey(match.name) === firmKey(a.name), match.name)
    check(`${p.manager}: adviser is active`, match.scope === "ACTIVE", match.scope ?? "no scope")
    if (a.secNumber) check(`${p.manager}: SEC number unchanged`, match.secNumber === a.secNumber, `${match.secNumber}`)
  }
  check("every manager-level CRD in the registry is unique", new Set(recorded.map((p) => p.adviser!.crd)).size === recorded.length)

  // Vehicle-level advisers, where a vehicle's differs from its manager's.
  const vehicleAdvisers = PEERS.flatMap((p) => p.vehicles.filter((v) => v.adviser).map((v) => ({ peer: p, vehicle: v, adviser: v.adviser! })))
  for (const { peer, vehicle, adviser } of vehicleAdvisers) {
    const { hits } = await search(adviser.name)
    const match = hits.find((h) => h.crd === adviser.crd)
    check(`${peer.manager} · ${vehicle.name}: CRD ${adviser.crd} returns from IAPD`, Boolean(match))
    if (!match) continue
    check(`${peer.manager} · ${vehicle.name}: IAPD name matches "${adviser.name}"`, firmKey(match.name) === firmKey(adviser.name), match.name)
    check(`${peer.manager} · ${vehicle.name}: adviser is active`, match.scope === "ACTIVE", match.scope ?? "no scope")
  }
  console.log(`\n${recorded.length} manager advisers and ${vehicleAdvisers.length} vehicle advisers recorded; ${failures ? `${failures} check(s) failed` : "all checks passed"}`)
  process.exit(failures ? 1 : 0)
}

;(VERIFY ? verify() : propose()).catch((e) => {
  console.error(e)
  process.exit(1)
})
