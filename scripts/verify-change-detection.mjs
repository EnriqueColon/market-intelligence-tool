/**
 * Calibrates the change engine against a live FDIC cohort.
 *
 * Thresholds are only useful in a narrow band: fire on every institution and
 * the signal is noise, fire on none and the feature is dead. Run this after
 * changing any threshold or the trajectory run length, and check that the share
 * of institutions with an event stays plausible — a few percent for supervisory
 * crossings, a larger but still minority share for trajectories.
 *
 *   node --experimental-strip-types scripts/verify-change-detection.mjs [STATE]
 */

import { detectChanges } from "../lib/scoring/institution-change.ts"

const state = process.argv[2] ?? "Florida"
const start = new Date()
start.setMonth(start.getMonth() - 27)
const window = `[${start.toISOString().slice(0, 7)}-01 TO *]`

const params = new URLSearchParams({
  filters: `REPDTE:${window} AND STNAME:${state.toUpperCase()}`,
  fields: "CERT,NAME,REPDTE,LNRENRES,LNRECONS,LNREMULT,LNLSNET,LNATRES,NCLNLSR,RBCT1J,RBCT2,RBCT1CER",
  limit: "10000",
  format: "json",
})

const res = await fetch(`https://banks.data.fdic.gov/api/financials?${params}`)
if (!res.ok) throw new Error(`FDIC returned ${res.status}`)
const raw = (await res.json()).data.map((d) => d.data)

const byCert = new Map()
for (const r of raw) {
  if (!byCert.has(r.CERT)) byCert.set(r.CERT, { name: r.NAME, rows: [] })
  byCert.get(r.CERT).rows.push(r)
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

let withAny = 0
let withSupervisory = 0
let withTrajectory = 0
const samples = []

for (const [cert, { name, rows }] of byCert) {
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

  withAny++
  if (changes.some((c) => c.kind === "crossing" && c.supervisory)) withSupervisory++
  if (changes.some((c) => c.kind === "trajectory")) withTrajectory++
  if (samples.length < 6) samples.push({ cert, name, changes: changes.slice(0, 2) })
}

const total = byCert.size
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`

console.log(`Scope: ${state}   institutions: ${total}   quarters: ${new Set(raw.map((r) => r.REPDTE)).size}\n`)
console.log(`with any event:            ${withAny} (${pct(withAny)})`)
console.log(`with supervisory crossing: ${withSupervisory} (${pct(withSupervisory)})`)
console.log(`with trajectory:           ${withTrajectory} (${pct(withTrajectory)})`)
console.log(`\nSample:`)
for (const s of samples) {
  console.log(`\n  ${s.name} (CERT ${s.cert})`)
  for (const c of s.changes) console.log(`    [${c.kind}] ${c.description}`)
}
