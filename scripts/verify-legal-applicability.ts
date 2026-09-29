/**
 * Proves the Legal Landscape exposure counts are answering the question the rule asked.
 *
 * The failure this exists to catch is silent. `ScreeningRow` carries two different CRE
 * concentration figures — `creConcentration` is CRE over total loans and cannot exceed 100,
 * while `capitalRatios.creToTier1Tier2` is CRE over Tier 1 + Tier 2 capital and is what every
 * supervisory threshold is measured against. Resolve a "300% of capital" rule against the first
 * and it matches nothing, on every institution, forever, and the card reads as a rule that
 * happens to affect no one. No type error, no exception, no empty state — just a confident zero.
 *
 * So this script applies the supervisory thresholds to live Florida call reports and fails if
 * they return implausible counts. Florida is CRE-heavy: a 300%-of-capital test matching zero
 * institutions means the wiring is wrong, not that the state has no concentrated banks.
 *
 *   npm run verify:legal-applicability
 */
import { FDIC_CONFIG, FDIC_ENDPOINTS, FDIC_FIELDS } from "../lib/fdic-config"
import { transformFinancialData, type BankFinancialData } from "../lib/fdic-data-transformer"
import { buildScreeningPayload, TAB_ROW_CAP } from "../lib/analytics/screening"
import {
  type LegalApplicability,
  describeTest,
  resolveApplicability,
} from "../lib/legal-applicability"

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

/**
 * Each case carries the range a correct implementation must land in.
 *
 * The bounds are wide on purpose — this is a wiring check, not an assertion about Florida
 * banking, and it must not fail every quarter as the cohort shifts. What it catches is a count
 * that has collapsed to zero or run away to everything.
 */
const CASES: { label: string; test: LegalApplicability; min: number; max: number }[] = [
  {
    label: "2006 guidance CRE limb (300% of capital)",
    test: { minCreToCapitalPct: 300 },
    min: 1,
    max: Number.POSITIVE_INFINITY,
  },
  {
    label: "2006 guidance construction limb (100% of capital)",
    test: { minConstructionToCapitalPct: 100 },
    min: 1,
    max: Number.POSITIVE_INFINITY,
  },
  {
    label: "A threshold no bank reaches (10,000% of capital)",
    test: { minCreToCapitalPct: 10000 },
    min: 0,
    max: 0,
  },
  {
    label: "Large-bank floor ($100bn)",
    test: { minTotalAssetsUsd: 1e11 },
    min: 0,
    max: 20,
  },
  {
    label: "Community-bank ceiling ($10bn)",
    test: { maxTotalAssetsUsd: 1e10 },
    min: 10,
    max: Number.POSITIVE_INFINITY,
  },
  {
    label: "Universal",
    test: { appliesToAllInstitutions: true },
    min: 10,
    max: Number.POSITIVE_INFINITY,
  },
]

async function main() {
  const financials = await fetchLive()
  const payload = buildScreeningPayload(financials, STATE)
  const universe = payload.rows

  console.log(`scope=${STATE}  institutions=${universe.length}  rawRows=${payload.rawRowCount}`)
  if (payload.rawRowCount >= TAB_ROW_CAP) {
    console.log(
      `NOTE: hit the ${TAB_ROW_CAP}-row cap, so this universe is a subset and the counts below ` +
        `are lower bounds. The tab says so too.`
    )
  }

  // A sanity line on the two measures, because seeing them side by side is what makes the
  // distinction obvious to the next person reading this output.
  const withRatios = universe.filter((r) => r.capitalRatios?.creToTier1Tier2 != null)
  const maxOverLoans = Math.max(...universe.map((r) => r.creConcentration ?? 0))
  const maxOverCapital = Math.max(
    ...withRatios.map((r) => (r.capitalRatios!.creToTier1Tier2 ?? 0) * 100)
  )
  console.log(
    `CRE over loans peaks at ${maxOverLoans.toFixed(0)}% (cannot exceed 100); ` +
      `CRE over capital peaks at ${maxOverCapital.toFixed(0)}%. ` +
      `${withRatios.length}/${universe.length} report the capital inputs.\n`
  )

  let failures = 0

  for (const c of CASES) {
    const { matched, universe: size, examples } = resolveApplicability(c.test, universe)
    const ok = matched >= c.min && matched <= c.max
    if (!ok) failures += 1

    const bound =
      c.max === Number.POSITIVE_INFINITY ? `expected >= ${c.min}` : `expected ${c.min}-${c.max}`
    console.log(`${ok ? "ok  " : "FAIL"} ${matched}/${size}  ${c.label}  (${bound})`)
    console.log(`       test as applied: ${describeTest(c.test)}`)
    if (examples.length > 0) {
      console.log(`       largest: ${examples.map((e) => e.name).join(", ")}`)
    }
  }

  if (universe.length === 0) {
    console.log("\nFAIL: no institutions in the universe, so no count means anything.")
    process.exit(1)
  }

  if (failures > 0) {
    console.log(
      `\nFAIL: ${failures} case(s) outside their plausible range. A zero where matches are ` +
        `expected usually means a concentration test is being resolved against ` +
        `creConcentration (CRE over loans, max 100) instead of creToTier1Tier2 * 100.`
    )
    process.exit(1)
  }

  console.log("\nPASS")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
