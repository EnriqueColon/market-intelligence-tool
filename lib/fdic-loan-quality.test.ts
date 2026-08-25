import { test } from "node:test"
import assert from "node:assert/strict"
import {
  computeNoncurrentToAssets,
  computeNonaccrualRatio,
  computePastDueToAssets,
  computeReserveCoverage,
  resolveGrossLoans,
} from "./fdic-loan-quality.ts"

/**
 * Figures are real FDIC 2026Q1 call report values in thousands, so each test
 * doubles as a reconciliation against what FDIC publishes for the same bank.
 */

test("regression: NCLNLS is dollars, so the old percent reading pinned banks at 100%", () => {
  // JPMorgan Chase, 2026Q1. NCLNLS = 12,861,000 thousand = $12.9bn noncurrent.
  const noncurrentLoans = 12_861_000
  const totalAssets = 4_016_571_000

  const ratio = computeNoncurrentToAssets({ noncurrentLoans, totalAssets })
  assert.ok(Math.abs(ratio - 0.0032) < 0.0001, `expected ~0.32%, got ${ratio * 100}%`)

  // What the field previously did: treat NCLNLS as percent points, divide by
  // 100, then clamp. Every bank with a material noncurrent book saturated.
  const oldWay = Math.min(1, Math.max(0, noncurrentLoans / 100))
  assert.equal(oldWay, 1, "the old reading rendered the largest bank as 100% noncurrent")
})

test("NCLNLS equals past-due-90+ plus nonaccrual, which is what makes it dollars", () => {
  // Merrick Bank, 2026Q1: P9LNLS 296,907 + NALNLS 41,189 = NCLNLS 338,096.
  assert.equal(296_907 + 41_189, 338_096)
  const ratio = computeNoncurrentToAssets({ noncurrentLoans: 338_096, totalAssets: 8_933_716 })
  assert.ok(Math.abs(ratio - 0.03785) < 0.0005)
})

test("reserve coverage reproduces FDIC's own LNATRESR", () => {
  // Ergo Bank, 2026Q1. FDIC publishes LNATRESR = 0.9671488339806007.
  const coverage = computeReserveCoverage({ allowance: 2_062, grossLoans: 213_204 })
  assert.ok(Math.abs(coverage * 100 - 0.9671488339806007) < 1e-9)
})

test("regression: net loans overstate reserve coverage by putting the allowance in its own denominator", () => {
  // Merrick Bank, 2026Q1. FDIC publishes 15.3737%; net loans give 18.1665%.
  const allowance = 1_323_940
  const grossLoans = 8_611_708
  const netLoans = 7_287_768

  const correct = computeReserveCoverage({ allowance, grossLoans })
  const oldWay = allowance / netLoans

  assert.ok(Math.abs(correct * 100 - 15.373721449914465) < 1e-9, "matches FDIC LNATRESR")
  assert.ok(oldWay * 100 - correct * 100 > 2.7, "the net-loan denominator inflates by ~2.8pp")
})

test("NPL ratio uses the gross denominator FDIC uses for NCLNLSR", () => {
  // American Trust & Savings Bank, 2026Q1: the whole noncurrent book is
  // nonaccrual, so the NPL ratio must equal FDIC's published NCLNLSR.
  const ratio = computeNonaccrualRatio({ nonaccrualLoans: 1_654, grossLoans: 5_532 })
  assert.ok(Math.abs(ratio * 100 - 29.89877078814172) < 1e-9)

  const oldWay = 1_654 / 5_127
  assert.ok(oldWay * 100 - ratio * 100 > 2.3, "net loans overstated this bank by 2.36pp")
})

test("gross loans fall back to net plus allowance when LNLSGR is absent", () => {
  // The identity LNLSNET + LNATRES = LNLSGR holds on all 4,352 institutions.
  assert.equal(resolveGrossLoans({ netLoans: 211_142, allowance: 2_062 }), 213_204)
  assert.equal(
    resolveGrossLoans({ grossLoans: 213_204, netLoans: 211_142, allowance: 2_062 }),
    213_204
  )
  assert.equal(
    resolveGrossLoans({ grossLoans: 0, netLoans: 211_142, allowance: 2_062 }),
    213_204,
    "a zero LNLSGR is missing data, not a real denominator"
  )
})

test("past-due buckets are dollar amounts measured against assets", () => {
  // JPMorgan Chase, 2026Q1: P3ASSET 6,246,000 of 4,016,571,000 assets.
  const p3 = computePastDueToAssets({ pastDueAssets: 6_246_000, totalAssets: 4_016_571_000 })
  assert.ok(Math.abs(p3 - 0.001555) < 1e-5)
})

test("missing or degenerate denominators yield zero rather than Infinity", () => {
  assert.equal(computeNoncurrentToAssets({ noncurrentLoans: 100, totalAssets: 0 }), 0)
  assert.equal(computeReserveCoverage({ allowance: 6, grossLoans: 0 }), 0)
  assert.equal(computeNonaccrualRatio({ nonaccrualLoans: 1, grossLoans: Number.NaN }), 0)
  assert.equal(resolveGrossLoans({ netLoans: 0, allowance: 0 }), 0)
})

test("ratios are clamped into [0, 1]", () => {
  // Young Americans Bank, 2026Q1: a $6k allowance against a $39k loan book is
  // 15.4%, but a bank whose allowance exceeds its loans must not exceed 100%.
  assert.ok(Math.abs(computeReserveCoverage({ allowance: 6, grossLoans: 39 }) - 0.153846) < 1e-5)
  assert.equal(computeReserveCoverage({ allowance: 100, grossLoans: 39 }), 1)
  assert.equal(computeNonaccrualRatio({ nonaccrualLoans: -5, grossLoans: 39 }), 0)
})
