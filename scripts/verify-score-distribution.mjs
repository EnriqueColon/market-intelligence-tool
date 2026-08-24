/**
 * Reports how the Opportunity Score is distributed across a live FDIC cohort,
 * alongside the previous min-max score for comparison.
 *
 * Run this after any change to the scoring inputs or weights. A score is only
 * useful if the cohort separates: watch the IQR and the most crowded band. If
 * one 10-point band holds most of the cohort, the score has stopped ranking.
 * Remember to bump the cache key version in build-report-data.ts as well, or
 * cached entries will keep serving the old scores.
 *
 *   node --experimental-strip-types scripts/verify-score-distribution.mjs [STATE]
 */

import {
  computeOpportunityDistributions,
  computeOpportunityScore,
  computeLegacyOpportunityScore,
} from "../lib/scoring/opportunity-score.ts"

const state = process.argv[2]
const start = new Date()
start.setMonth(start.getMonth() - 27)
const window = `[${start.toISOString().slice(0, 7)}-01 TO *]`

const filters = `REPDTE:${window}${state ? ` AND STNAME:${state.toUpperCase()}` : ""}`
const params = new URLSearchParams({
  filters,
  fields: "CERT,NAME,REPDTE,ASSET,LNRENROT,LNRECONS,LNREMULT,LNLSNET,LNATRES,NCLNLSR,RBCT1CER,RBC1AAJ",
  limit: "10000",
  sort_by: "ASSET",
  sort_order: "DESC",
  format: "json",
})

const res = await fetch(`https://banks.data.fdic.gov/api/financials?${params}`)
if (!res.ok) throw new Error(`FDIC returned ${res.status}`)
const payload = await res.json()
const raw = payload.data.map((d) => d.data)

// Keep only the most recent quarter per institution, mirroring the screening table.
const latest = new Map()
for (const r of raw) {
  const prev = latest.get(r.CERT)
  if (!prev || String(r.REPDTE) > String(prev.REPDTE)) latest.set(r.CERT, r)
}

const rows = [...latest.values()].map((r) => {
  const totalLoans = Number(r.LNLSNET || 0)
  // 2006 guidance definition: excludes owner-occupied, and never adds
  // LNREOTH, which is already inside these components.
  const creLoans = Number(r.LNRENROT || 0) + Number(r.LNRECONS || 0) + Number(r.LNREMULT || 0)
  const allowance = Number(r.LNATRES || 0)
  return {
    name: r.NAME,
    creConcentration: totalLoans > 0 ? (creLoans / totalLoans) * 100 : 0,
    noncurrentToLoansRatio: Number(r.NCLNLSR || 0) / 100,
    loanLossReserve: totalLoans > 0 ? allowance / totalLoans : 0,
    cet1Ratio: Number(r.RBCT1CER || 0),
    leverageRatio: Number(r.RBC1AAJ || 0),
  }
})

const dist = computeOpportunityDistributions(rows)
const now = rows.map((r) => computeOpportunityScore(r, dist))
const before = rows.map((r) => computeLegacyOpportunityScore(r, rows))

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

function describe(label, scores) {
  const s = [...scores].sort((a, b) => a - b)
  const n = s.length
  const bands = new Array(10).fill(0)
  for (const v of s) bands[Math.min(9, Math.floor(v / 10))]++
  const widest = Math.max(...bands)
  console.log(`\n${label}`)
  console.log(`  median ${pct(s, 50).toFixed(1)}   IQR ${pct(s, 25).toFixed(1)}-${pct(s, 75).toFixed(1)}   range ${s[0].toFixed(1)}-${s[n - 1].toFixed(1)}`)
  console.log(`  share >=70: ${((s.filter((v) => v >= 70).length / n) * 100).toFixed(1)}%   >=80: ${((s.filter((v) => v >= 80).length / n) * 100).toFixed(1)}%`)
  console.log(`  most crowded 10-pt band holds ${((widest / n) * 100).toFixed(1)}% of the cohort`)
  console.log(`  bands: ${bands.map((c, i) => `${i * 10}-${i * 10 + 10}:${c}`).join("  ")}`)
}

console.log(`Scope: ${state ?? "National"}   institutions: ${rows.length}`)
describe("BEFORE (min-max)", before)
describe("AFTER (percentile rank)", now)
