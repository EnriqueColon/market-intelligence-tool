// Runs under tsx (not the bare node runner) because the module reaches
// capital-category, quarter and cohort-watch through `@/` imports.
import test from "node:test"
import assert from "node:assert/strict"
import { buildInstitutionTrend, TREND_QUARTERS, type TrendInputRow } from "@/lib/analytics/institution-trend"

const QUARTERS = [
  "20240630", "20240930", "20241231", "20250331",
  "20250630", "20250930", "20251231", "20260331", "20260630",
]

function healthy(reportDate: string, overrides: Partial<TrendInputRow> = {}): TrendInputRow {
  return {
    id: "1",
    name: "Steady Bank",
    reportDate,
    totalAssets: 1_000_000_000,
    totalEquityDollars: 110_000_000,
    leverageRatio: 10.5,
    cet1Ratio: 13,
    tier1RbcRatio: 13,
    totalRbcRatio: 14.2,
    noncurrent_to_loans_ratio: 0.004,
    loanLossReserve: 0.012,
    creToTier1Tier2: 1.8,
    constructionToTier1Tier2: 0.4,
    nplRatio: 0.003,
    roa: 1.1,
    netInterestMargin: 3.4,
    ...overrides,
  } as TrendInputRow
}

test("keeps the newest eight quarters, oldest first, de-duplicated", () => {
  const rows = [...QUARTERS.map((q) => healthy(q)), healthy("20260630")].reverse()
  const trend = buildInstitutionTrend("1", rows)
  assert.equal(trend.points.length, TREND_QUARTERS)
  assert.equal(trend.points[0].quarter, "20240930")
  assert.equal(trend.points[7].quarter, "20260630")
  assert.equal(trend.points[7].label, "Q2 2026")
})

test("converts decimals to percent points and leaves percent fields alone", () => {
  const [p] = buildInstitutionTrend("1", [healthy("20260630")]).points
  assert.equal(p.noncurrentPct, 0.4)
  assert.equal(p.creToCapitalPct, 180)
  assert.equal(p.reservePct, 1.2)
  assert.equal(p.leveragePct, 10.5)
  assert.equal(p.roaPct, 1.1)
  assert.equal(p.nimPct, 3.4)
  assert.equal(p.capital?.category, "well")
})

test("CBLR filer: risk-based ratios are null, never zero, and the trend is leverage-only", () => {
  const rows = QUARTERS.map((q) => healthy(q, { cet1Ratio: null, tier1RbcRatio: null, totalRbcRatio: 0 }))
  const trend = buildInstitutionTrend("1", rows)
  assert.equal(trend.leverageOnly, true)
  assert.ok(trend.points.every((p) => p.cet1Pct === null && p.totalRbcPct === null))
  assert.equal(trend.points[0].capital?.category, "well")
})

test("stable bank reads Stable", () => {
  const trend = buildInstitutionTrend("1", QUARTERS.map((q) => healthy(q)))
  assert.equal(trend.verdict.tone, "stable")
  assert.match(trend.verdict.text, /Q3 2024–Q2 2026/)
})

test("capital downgrade reads Deteriorating and leads the sentence", () => {
  const rows = QUARTERS.map((q, i) =>
    i < QUARTERS.length - 1 ? healthy(q) : healthy(q, { leverageRatio: 4.5, cet1Ratio: 6, tier1RbcRatio: 6, totalRbcRatio: 8.5 })
  )
  const trend = buildInstitutionTrend("1", rows)
  assert.equal(trend.verdict.tone, "deteriorating")
  assert.match(trend.verdict.text, /^Capital category fell from well capitalised to adequately capitalised/)
  assert.equal(trend.points[7].capital?.category, "adequate")
})

test("a lone supervisory crossing at a well-capitalised bank reads Watch, not Deteriorating", () => {
  const rows = QUARTERS.map((q, i) => healthy(q, { constructionToTier1Tier2: i === QUARTERS.length - 1 ? 1.1 : 0.89 }))
  const trend = buildInstitutionTrend("1", rows)
  assert.equal(trend.verdict.tone, "watch")
  assert.match(trend.verdict.text, /Construction to capital rose above the 100% supervisory screen/)
})

test("a supervisory crossing corroborated by an adverse run reads Deteriorating", () => {
  const rows = QUARTERS.map((q, i) =>
    healthy(q, {
      constructionToTier1Tier2: i === QUARTERS.length - 1 ? 1.1 : 0.89,
      noncurrent_to_loans_ratio: 0.004 + Math.max(0, i - 5) * 0.002,
    })
  )
  assert.equal(buildInstitutionTrend("1", rows).verdict.tone, "deteriorating")
})

test("a three-quarter adverse run without a crossing reads Watch", () => {
  const rows = QUARTERS.map((q, i) => healthy(q, { noncurrent_to_loans_ratio: 0.004 + Math.max(0, i - 5) * 0.002 }))
  const trend = buildInstitutionTrend("1", rows)
  assert.equal(trend.verdict.tone, "watch")
  assert.match(trend.verdict.text, /noncurrent/i)
})

test("fewer than two quarters is Too little history", () => {
  const trend = buildInstitutionTrend("1", [healthy("20260630")])
  assert.equal(trend.verdict.tone, "insufficient")
  assert.equal(trend.points.length, 1)
})

test("empty input yields an empty, insufficient trend rather than throwing", () => {
  const trend = buildInstitutionTrend("1", [])
  assert.equal(trend.points.length, 0)
  assert.equal(trend.verdict.tone, "insufficient")
  assert.equal(trend.leverageOnly, true)
})
