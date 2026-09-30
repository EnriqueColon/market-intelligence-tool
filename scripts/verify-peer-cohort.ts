/**
 * Measures what the matched peer cohort does to the drawer's percentiles on live data.
 *
 * The bug being fixed is not a crash, it is a number that looks fine. Ranking a $180m
 * single-branch bank against every institution in the scope produces a percentile dominated by
 * size, and nothing about the figure says so. Building and unit tests both pass either way, which
 * is exactly the class of defect this repository has shipped before, so the check that counts is
 * reading the two numbers side by side against real call reports.
 *
 * Three things are asserted, each one a way the wiring could be wrong while still rendering:
 *
 *  1. The percentile actually moves. If matched and scope-wide percentiles agree for nearly every
 *     institution, the cohort is not being applied.
 *  2. Small institutions move most. Size is the axis the old comparison was dominated by, so if
 *     the change were cosmetic the smallest banks would be unaffected.
 *  3. Every cohort is describable and no description claims a national cohort inside a
 *     single-state universe.
 *
 * It is informational about how often a percentile is withheld, because that depends on the state
 * rather than on the code being right.
 *
 *   npm run verify:peer-cohort
 *   STATE=Georgia npm run verify:peer-cohort
 */
import { FDIC_CONFIG, FDIC_ENDPOINTS, FDIC_FIELDS } from "../lib/fdic-config"
import { transformFinancialData, type BankFinancialData } from "../lib/fdic-data-transformer"
import { buildScreeningPayload, TAB_ROW_CAP } from "../lib/analytics/screening"
import {
  MIN_COHORT,
  percentileIn,
  selectPeers,
  type PeerCandidate,
} from "../lib/scoring/peer-cohort"

const STATE = process.env.STATE ?? "Florida"

async function fetchLive(): Promise<BankFinancialData[]> {
  const d = new Date()
  d.setMonth(d.getMonth() - 27)
  const filters = [`REPDTE:[${d.toISOString().slice(0, 7)}-01 TO *]`, `STNAME:"${STATE.toUpperCase()}"`]

  const params = new URLSearchParams({
    format: "json",
    limit: String(TAB_ROW_CAP),
    filters: filters.join(" AND "),
    fields: FDIC_FIELDS.financials.join(","),
    sort_by: "ASSET",
    sort_order: "DESC",
  })
  const res = await fetch(`${FDIC_CONFIG.baseUrl}${FDIC_ENDPOINTS.financials}?${params}`)
  if (!res.ok) throw new Error(`FDIC ${res.status}`)
  const json = await res.json()
  return transformFinancialData(json.data.map((r: any) => r?.data ?? r))
}

/** The scope-wide percentile the drawer used to show, on the same midrank convention. */
function scopeWidePercentile(values: number[], value: number): number | null {
  if (values.length === 0) return null
  let below = 0
  let equal = 0
  for (const v of values) {
    if (v < value) below++
    else if (v === value) equal++
  }
  return Math.round(((below + equal / 2) / values.length) * 100)
}

function fmtMoney(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}bn`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}m`
  return `$${v}`
}

async function main() {
  const raw = await fetchLive()
  const payload = buildScreeningPayload(raw, STATE)
  const rows = payload.rows

  const universe: (PeerCandidate & { creConc: number | null })[] = rows.map((r) => ({
    cert: r.id,
    name: r.name,
    state: r.state,
    totalAssets: r.totalAssets,
    creLoans: r.creLoans ?? Number.NaN,
    totalLoans: r.totalLoans ?? Number.NaN,
    creConc: r.creConcentration ?? null,
  }))

  const scopeValues = universe
    .map((u) => u.creConc)
    .filter((v): v is number => v != null && Number.isFinite(v))

  console.log(`scope=${STATE}  institutions=${universe.length}  rawRows=${raw.length}`)
  console.log(`metric=CRE/Assets  reporting=${scopeValues.length}\n`)

  let moved = 0
  let comparable = 0
  let withheld = 0
  let maxShift = 0
  let nationalClaimInSingleState = 0
  const shiftsBySize: { small: number[]; large: number[] } = { small: [], large: [] }

  for (const subject of universe) {
    if (subject.creConc == null) continue
    const cohort = selectPeers(subject, universe)

    if (!cohort.description) throw new Error(`cohort for ${subject.name} has no description`)
    if (/nationally/.test(cohort.description)) nationalClaimInSingleState++

    const peerValues = cohort.peers
      .map((p) => p.creConc)
      .filter((v): v is number => v != null && Number.isFinite(v))

    const matched = percentileIn(peerValues, subject.creConc)
    const scopeWide = scopeWidePercentile(scopeValues, subject.creConc)

    if (matched == null) {
      withheld++
      continue
    }
    comparable++
    const matchedPct = Math.round(matched * 100)
    const shift = Math.abs(matchedPct - (scopeWide ?? 0))
    if (shift > 0) moved++
    if (shift > maxShift) maxShift = shift
    if (subject.totalAssets < 1e9) shiftsBySize.small.push(shift)
    else shiftsBySize.large.push(shift)
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const smallMean = mean(shiftsBySize.small)
  const largeMean = mean(shiftsBySize.large)

  console.log(`ranked against matched peers : ${comparable}`)
  console.log(`withheld (fewer than ${MIN_COHORT} peers) : ${withheld}`)
  console.log(`percentile changed           : ${moved} of ${comparable}`)
  console.log(`largest single shift         : ${maxShift} percentile points`)
  console.log(`mean shift, under $1bn       : ${smallMean.toFixed(1)} points (n=${shiftsBySize.small.length})`)
  console.log(`mean shift, $1bn and over    : ${largeMean.toFixed(1)} points (n=${shiftsBySize.large.length})`)

  // A few worked examples, so the cohorts can be read rather than trusted.
  console.log("\nexamples:")
  for (const subject of [...universe].sort((a, b) => a.totalAssets - b.totalAssets).slice(0, 3)) {
    if (subject.creConc == null) continue
    const cohort = selectPeers(subject, universe)
    const peerValues = cohort.peers
      .map((p) => p.creConc)
      .filter((v): v is number => v != null && Number.isFinite(v))
    const matched = percentileIn(peerValues, subject.creConc)
    const scopeWide = scopeWidePercentile(scopeValues, subject.creConc)
    console.log(
      `  ${subject.name} (${fmtMoney(subject.totalAssets)})\n` +
        `    scope-wide ${scopeWide}th  ->  matched ${matched == null ? "withheld" : `${Math.round(matched * 100)}th`}` +
        `  [${cohort.peers.length} peers: ${cohort.description}]`
    )
  }

  const failures: string[] = []
  if (comparable === 0) {
    failures.push(`no institution could be ranked against peers at all — the cohort is never reaching ${MIN_COHORT}`)
  }
  if (comparable > 0 && moved / comparable < 0.5) {
    failures.push(
      `only ${moved}/${comparable} percentiles changed; the matched cohort is probably not being applied`
    )
  }
  if (shiftsBySize.small.length > 0 && shiftsBySize.large.length > 0 && smallMean <= largeMean) {
    failures.push(
      `small institutions moved no more than large ones (${smallMean.toFixed(1)} vs ${largeMean.toFixed(1)}); ` +
        `size was the axis the old comparison was dominated by, so this is backwards`
    )
  }
  if (nationalClaimInSingleState > 0) {
    failures.push(
      `${nationalClaimInSingleState} cohorts describe themselves as national inside a single-state universe`
    )
  }

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL ${f}`)
    process.exit(1)
  }
  console.log("PASS")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
