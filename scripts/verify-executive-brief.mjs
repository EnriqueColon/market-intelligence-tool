/**
 * Checks that the Executive Brief is brief, and that what leads it deserves to.
 *
 * The brief fails in two directions. If nothing surfaces nationally it is dead
 * weight. If the top of each section is filled by reporting artifacts — an
 * institution leaping from near-zero, a threshold grazed by a hair — executives
 * stop trusting it. Run this after changing a threshold, the trajectory run
 * length, or either ranking function, and read the sample rather than only the
 * counts.
 *
 * Imports the real ranking from lib/scoring, so this exercises shipped code.
 *
 *   node --experimental-strip-types scripts/verify-executive-brief.mjs [STATE]
 */

import { detectChanges, groupForBrief } from "../lib/scoring/institution-change.ts"

const scope = process.argv[2] ?? "National"
const start = new Date()
start.setMonth(start.getMonth() - 27)
const window = `[${start.toISOString().slice(0, 7)}-01 TO *]`

const filters =
  scope === "National"
    ? `REPDTE:${window}`
    : `REPDTE:${window} AND STNAME:${scope.toUpperCase()}`

const params = new URLSearchParams({
  filters,
  fields: "CERT,NAME,STNAME,REPDTE,LNRENRES,LNRECONS,LNREMULT,LNLSNET,LNATRES,NCLNLSR,RBCT1J,RBCT2,RBCT1CER",
  limit: "10000",
  format: "json",
})

const res = await fetch(`https://banks.data.fdic.gov/api/financials?${params}`)
if (!res.ok) throw new Error(`FDIC returned ${res.status}`)
const raw = (await res.json()).data.map((d) => d.data)

const byCert = new Map()
for (const r of raw) {
  if (!byCert.has(r.CERT)) byCert.set(r.CERT, { name: r.NAME, state: r.STNAME, rows: [] })
  byCert.get(r.CERT).rows.push(r)
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

const events = []
let movedCount = 0

for (const [cert, { name, state, rows }] of byCert) {
  const observations = rows.map((r) => {
    const capital = num(r.RBCT1J) + num(r.RBCT2)
    const cre = num(r.LNRENRES) + num(r.LNRECONS) + num(r.LNREMULT)
    const loans = num(r.LNLSNET)
    return {
      quarter: String(r.REPDTE),
      creToCapital: capital > 0 ? cre / capital : null,
      constructionToCapital: capital > 0 ? num(r.LNRECONS) / capital : null,
      noncurrentRatio: num(r.NCLNLSR) / 100,
      reserveCoverage: loans > 0 ? num(r.LNATRES) / loans : null,
      capitalRatio: num(r.RBCT1CER) || null,
    }
  })

  const changes = detectChanges(observations)
  if (changes.length === 0) continue
  movedCount++
  for (const c of changes) events.push({ ...c, cert, name, state })
}

const groups = groupForBrief(events, 6)
const total = byCert.size

console.log(
  `Scope: ${scope}   institutions: ${total}   quarters: ${new Set(raw.map((r) => r.REPDTE)).size}`
)
console.log(`moved: ${movedCount} (${((movedCount / total) * 100).toFixed(1)}%)`)
console.log(`events: ${events.length}\n`)

for (const [label, list] of Object.entries(groups)) {
  console.log(`${label}: showing ${list.length}`)
  for (const e of list) {
    const past = e.threshold ? ` [${((e.to / e.threshold - 1) * 100).toFixed(0)}% past level]` : ""
    console.log(`   ${e.name}${e.state ? ` (${e.state})` : ""}${past}`)
    console.log(`      ${e.description}`)
  }
  console.log()
}
