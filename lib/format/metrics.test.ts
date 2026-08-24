/**
 * Unit tests for FDIC percent normalization.
 * Run: node --test --experimental-strip-types lib/format/metrics.test.ts
 *
 * FDIC semantics: "(% )" fields (NCLNLS, NCLNLSR) are percent points.
 * NCLNLSR=0.795 => 0.795% => decimal 0.00795 => display "0.8%"
 * NCLNLS=0.8 => 0.8% => decimal 0.008 => display "0.8%"
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  normalizeCapitalRatioPercent,
  normalizePercent,
  normalizePercentToDecimal,
  formatDecimalAsPercent,
} from "./metrics.ts"

describe("normalizeCapitalRatioPercent", () => {
  it("trusts a ratio above 100%, which normalizePercent would wreck", () => {
    // JPMorgan Chase Bank Dearborn, 2026Q1. Trust and wholesale banks hold
    // capital far above their risk-weighted assets, so this is ordinary.
    assert.strictEqual(normalizeCapitalRatioPercent(506.72), 506.72)
    // The bug this replaces: rendering the best-capitalised bank as 5.07%.
    assert.ok(Math.abs((normalizePercent(506.72) ?? 0) - 5.0672) < 1e-9)
  })

  it("does not inflate a genuinely thin ratio", () => {
    // The dangerous direction: scaling 0.85% up to 85% hides a failing bank.
    assert.strictEqual(normalizeCapitalRatioPercent(0.85), 0.85)
  })

  it("passes ordinary ratios through unchanged", () => {
    assert.strictEqual(normalizeCapitalRatioPercent(12.4), 12.4)
  })

  it("returns null for missing or non-finite input", () => {
    assert.strictEqual(normalizeCapitalRatioPercent(null), null)
    assert.strictEqual(normalizeCapitalRatioPercent(undefined), null)
    assert.strictEqual(normalizeCapitalRatioPercent(Number.NaN), null)
  })
})

describe("normalizePercentToDecimal", () => {
  it("NCLNLSR raw 0.795 -> decimal 0.00795 -> display 0.8%", () => {
    const decimal = normalizePercentToDecimal(0.795, "NCLNLSR")
    assert.strictEqual(decimal, 0.00795)
    const display = formatDecimalAsPercent(decimal, 1)
    assert.strictEqual(display, "0.8%")
  })

  it("NCLNLS raw 0.8 -> decimal 0.008 -> display 0.8%", () => {
    const decimal = normalizePercentToDecimal(0.8, "NCLNLS")
    assert.strictEqual(decimal, 0.008)
    const display = formatDecimalAsPercent(decimal, 1)
    assert.strictEqual(display, "0.8%")
  })

  it("percent points 79.5 -> decimal 0.795", () => {
    const decimal = normalizePercentToDecimal(79.5, "NCLNLSR")
    assert.strictEqual(decimal, 0.795)
  })

  it("null/undefined returns null", () => {
    assert.strictEqual(normalizePercentToDecimal(null), null)
    assert.strictEqual(normalizePercentToDecimal(undefined), null)
  })

  it("zero returns 0", () => {
    assert.strictEqual(normalizePercentToDecimal(0), 0)
  })
})
