/**
 * Runs the Underwriter Workbench over live FDIC data and checks it against
 * figures FDIC publishes itself.
 *
 * Every data-accuracy bug this tool has shipped — the reserve-coverage field
 * mix-up, the capital-ratio rescaling, the CRE double-count — passed unit tests
 * and a clean build, and was caught only by looking at real numbers. So this
 * script imports the shipped pipeline end to end and reimplements none of it:
 *
 *   raw FDIC JSON
 *     -> transformFinancialData   (lib/fdic-data-transformer.ts)
 *     -> toWorkbenchRows          (lib/scoring/workbench-analysis.ts)
 *     -> analyseInstitution       (lib/scoring/workbench-analysis.ts)
 *
 * The reconciliation that matters is the last one: for risk-based filers the
 * scenario's base capital ratio must equal FDIC's published RBCRWAJ, and for
 * CBLR filers its published RBC1AAJ. If either drifts, the downside scenario is
 * being run off a denominator nobody can check.
 *
 * Run via tsx, which honours the `@/` path alias that the app's own imports use:
 *
 *   npm run verify:workbench            # Florida
 *   npm run verify:workbench -- Texas
 *   npm run verify:workbench -- National
 *
 * Kept as `.ts` rather than `.mts`, and wrapped in a `main()` rather than using
 * top-level await, because the package is CommonJS: as an ES module this ends
 * up importing CommonJS output, and Node's named-export detection does not see
 * through esbuild's export wrapper. Everything then fails at import time.
 */

import { transformFinancialData } from "@/lib/fdic-data-transformer"
import { analyseInstitution, toWorkbenchRows } from "@/lib/scoring/workbench-analysis"

async function main() {
const scope = process.argv[2] ?? "Florida"

const start = new Date()
start.setMonth(start.getMonth() - 27)
const window = `[${start.toISOString().slice(0, 7)}-01 TO *]`
const filters =
  scope === "National" ? `REPDTE:${window}` : `REPDTE:${window} AND STNAME:${scope.toUpperCase()}`

// Every field the transformer reads, plus the two published ratios this script
// reconciles against. Requested by name so a field silently dropped from
// FDIC_FIELDS shows up here as a failure rather than as a quiet null.
const params = new URLSearchParams({
  filters,
  fields: [
    "CERT", "NAME", "CITY", "STNAME", "REPDTE", "ASSET", "DEP",
    "LNRECONS", "LNREMULT", "LNRENRES", "LNRENROW", "LNRENROT", "LNREOTH", "LNREDOM",
    "LNLSNET", "NALNLS", "NCLNLSR", "NCLNLS", "LNATRES", "LNLSDEPR",
    "P3ASSET", "P9ASSET", "ROA", "ROE", "EEFFR", "NIMR", "NETINC",
    "RBCT1CER", "RBC1AAJ", "RBC1RWAJ", "RBCRWAJ", "RBCT1J", "RBCT2", "RWAJ", "EQTOT",
    "UCLN", "UCCOMRE",
  ].join(","),
  limit: "10000",
  format: "json",
})

console.log(`Fetching ${scope}…`)
const res = await fetch(`https://banks.data.fdic.gov/api/financials?${params}`)
if (!res.ok) throw new Error(`FDIC returned ${res.status}`)
const raw = (await res.json()).data.map((d: any) => d.data)

// Published ratios, kept aside by institution-quarter so the reconciliation
// compares against FDIC's own numbers rather than against the tool's.
const published = new Map<string, { rbc: number; leverage: number }>()
for (const r of raw) {
  published.set(`${r.CERT}_${r.REPDTE}`, {
    rbc: Number(r.RBCRWAJ ?? 0),
    leverage: Number(r.RBC1AAJ ?? 0),
  })
}

const transformed = transformFinancialData(raw)
const latestQuarter = transformed.reduce(
  (max, r) => (String(r.reportDate ?? "") > max ? String(r.reportDate ?? "") : max),
  ""
)
const universe = toWorkbenchRows(transformed, latestQuarter)

console.log(`\n${scope} · ${latestQuarter} · ${universe.length} institutions reporting\n`)

let riskBased = 0
let cblr = 0
let noScenario = 0
let rbcMismatch = 0
let levMismatch = 0
let thinCohort = 0
let flagged = 0
let alreadyBelow = 0
const breakEvens: number[] = []
const worst: { name: string; mark: number; regime: string }[] = []

for (const subject of universe) {
  const analysis = analyseInstitution(subject, universe)
  if (analysis.flags.length > 0) flagged++
  if (!analysis.cohortIsRankable) thinCohort++

  const d = analysis.downside
  if (!d) {
    noScenario++
    continue
  }
  if (d.regime === "risk-based") riskBased++
  else cblr++
  if (d.alreadyBelowFloor) alreadyBelow++

  // The reconciliation. The base ratio must be FDIC's published figure.
  const pub = published.get(`${subject.cert}_${latestQuarter}`)
  if (pub) {
    const expected = d.regime === "risk-based" ? pub.rbc : pub.leverage
    if (Math.abs(d.baseRatio - expected) > 1e-6) {
      if (d.regime === "risk-based") rbcMismatch++
      else levMismatch++
      if (rbcMismatch + levMismatch <= 5) {
        console.log(
          `  MISMATCH ${subject.name}: ${d.regime} base ${d.baseRatio.toFixed(6)} vs published ${expected.toFixed(6)}`
        )
      }
    }
  }

  if (d.breakEvenMark != null) {
    breakEvens.push(d.breakEvenMark)
    worst.push({ name: subject.name, mark: d.breakEvenMark, regime: d.regime })
  }
}

const pct = (n: number) => `${((n / universe.length) * 100).toFixed(0)}%`

console.log("Capital regime")
console.log(`  risk-based filers      ${riskBased} (${pct(riskBased)})`)
console.log(`  CBLR / leverage filers ${cblr} (${pct(cblr)})`)
console.log(`  no usable capital      ${noScenario} (${pct(noScenario)})`)

console.log("\nReconciliation against FDIC published ratios")
console.log(`  RBCRWAJ mismatches  ${rbcMismatch}`)
console.log(`  RBC1AAJ mismatches  ${levMismatch}`)
if (rbcMismatch + levMismatch === 0) console.log("  clean — every base ratio equals FDIC's own")

console.log("\nCohorts and flags")
console.log(`  cohort too small to rank against  ${thinCohort} (${pct(thinCohort)})`)
console.log(`  at or near a threshold            ${flagged} (${pct(flagged)})`)
console.log(`  already below their capital floor ${alreadyBelow}`)

breakEvens.sort((a, b) => a - b)
if (breakEvens.length) {
  const quantiles = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const at = (q: number) => s[Math.floor(s.length * q)]
    return `p10 ${(at(0.1) * 100).toFixed(1)}%   median ${(at(0.5) * 100).toFixed(1)}%   p90 ${(at(0.9) * 100).toFixed(1)}%`
  }
  console.log("\nBreak-even CRE mark — loss that reaches the PCA adequately-capitalised floor")
  console.log(`  institutions with a reachable break-even  ${breakEvens.length}`)
  console.log(`  all        ${quantiles(breakEvens)}`)

  // Split by regime deliberately. An earlier version measured leverage filers
  // against the 9% CBLR election trigger rather than the 4% PCA floor, and the
  // two distributions separated completely — every thin cushion was a CBLR
  // filer. A single pooled median hid it; these two lines would not have.
  const byRegime = (r: string) => worst.filter((w) => w.regime === r).map((w) => w.mark)
  for (const regime of ["risk-based", "leverage"]) {
    const xs = byRegime(regime)
    if (xs.length) console.log(`  ${regime.padEnd(10)} ${quantiles(xs)}  (n=${xs.length})`)
  }

  console.log("\n  Thinnest cushions:")
  for (const w of worst.sort((a, b) => a.mark - b.mark).slice(0, 8)) {
    console.log(`    ${(w.mark * 100).toFixed(1).padStart(5)}%  ${w.name}  (${w.regime})`)
  }
}

// A break-even at or under 5% on a healthy-looking bank is the shape of a bug,
// not a finding, so surface the count rather than leaving it in the tail.
const implausible = breakEvens.filter((m) => m < 0.02).length
if (implausible > 0) {
  console.log(
    `\n  NOTE: ${implausible} institutions break even under a 2% mark. Check these by hand.`
  )
}

if (rbcMismatch + levMismatch > 0) {
  console.error("\nFAILED: base ratios do not reconcile to FDIC's published figures.")
  process.exit(1)
}
console.log("\nOK")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
