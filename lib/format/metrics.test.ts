/**
 * Unit tests for FDIC percent normalization.
 * Run: node --test --experimental-strip-types lib/format/metrics.test.ts
 *
 * FDIC semantics: genuine "(% )" fields (NCLNLSR, LNLSDEPR) are percent points.
 * NCLNLSR=0.795 => 0.795% => decimal 0.00795 => display "0.8%"
 *
 * NCLNLS is not one of them despite the name: it holds dollars. See
 * lib/fdic-loan-quality.ts.
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  normalizeCapitalRatioPercent,
  normalizeFdicPercent,
  normalizePercentToDecimal,
  formatDecimalAsPercent,
} from "./metrics.ts"

/** The scale-guessing heuristic these functions replaced, kept to assert against. */
const guessScale = (v: number): number => (v > 100 ? v / 100 : v > 0 && v <= 1 ? v * 100 : v)

describe("normalizeCapitalRatioPercent", () => {
  it("trusts a ratio above 100%, which the old heuristic would wreck", () => {
    // JPMorgan Chase Bank Dearborn, 2026Q1. Trust and wholesale banks hold
    // capital far above their risk-weighted assets, so this is ordinary.
    assert.strictEqual(normalizeCapitalRatioPercent(506.72), 506.72)
    // The bug this replaces: rendering the best-capitalised bank as 5.07%.
    assert.ok(Math.abs(guessScale(506.72) - 5.0672) < 1e-9)
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

  it("treats a reported zero as absent, because CBLR filers report zero", () => {
    // FDIC returns RBCRWAJ=0 for the 1,765 institutions on the Community Bank
    // Leverage Ratio framework rather than omitting it. Passing that through
    // rendered 40.6% of the industry at 0.00% total risk-based capital,
    // indistinguishable from the 2 banks genuinely below 8%.
    assert.strictEqual(normalizeCapitalRatioPercent(0), null)
  })

  it("lets a CBLR filer fall through to its leverage ratio", () => {
    // Citizens Bank of Chatsworth-shaped: RBCT1CER absent, RBCRWAJ zero,
    // RBC1AAJ the ratio it actually reports. `??` only reaches the fallback
    // when the first operand is nullish, so zero here would pin it at 0%.
    const cet1 = normalizeCapitalRatioPercent(null)
    const leverage = normalizeCapitalRatioPercent(11.8)
    assert.strictEqual(cet1 ?? leverage ?? 0, 11.8)

    const asZero = 0
    assert.strictEqual(asZero ?? leverage ?? 0, 0)
  })
})

describe("normalizePercentToDecimal", () => {
  it("NCLNLSR raw 0.795 -> decimal 0.00795 -> display 0.8%", () => {
    const decimal = normalizePercentToDecimal(0.795, "NCLNLSR")
    assert.strictEqual(decimal, 0.00795)
    const display = formatDecimalAsPercent(decimal, 1)
    assert.strictEqual(display, "0.8%")
  })

  it("LNLSDEPR raw 95.24 -> decimal 0.9524", () => {
    // Ergo Bank, 2026Q1: net loans 211,142 over deposits 221,684.
    const decimal = normalizePercentToDecimal(95.24458237852078, "LNLSDEPR")
    assert.ok(Math.abs((decimal ?? 0) - 0.9524458237852078) < 1e-15)
  })

  it("leaves a loans-to-deposits ratio above 100% above 100%", () => {
    // 405 of 4,352 institutions lend more than they hold in deposits.
    assert.ok(Math.abs((normalizePercentToDecimal(127.5, "LNLSDEPR") ?? 0) - 1.275) < 1e-12)
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

describe("normalizeFdicPercent", () => {
  it("regression: does not multiply a sub-1% ROA by a hundred", () => {
    // A third of the industry sits here. NBH Bank, 2026Q1, reported ROA 1.00%
    // and the old heuristic displayed 99.98%.
    assert.strictEqual(normalizeFdicPercent(0.9997878), 0.9997878)
    assert.ok(Math.abs(guessScale(0.9997878) - 99.97878) < 1e-6)
  })

  it("regression: does not divide an ROA or ROE above 100%", () => {
    // Trust Co of Toledo NA, 2026Q1: ROA 128.27%. First National Bank & Trust
    // Co: ROE 211.54%. Both are real; nine institutions exceed 100% ROE.
    assert.strictEqual(normalizeFdicPercent(128.268), 128.268)
    assert.strictEqual(normalizeFdicPercent(211.54), 211.54)
    assert.ok(Math.abs(guessScale(128.268) - 1.28268) < 1e-9)
  })

  it("regression: leaves a compressed trust-bank NIM alone", () => {
    // State Street Bank & Trust, 2026Q1: NIM 0.953%, shown as 95.29% before.
    assert.strictEqual(normalizeFdicPercent(0.9528599), 0.9528599)
  })

  it("preserves negative ROA and ROE", () => {
    assert.strictEqual(normalizeFdicPercent(-38.543), -38.543)
    assert.strictEqual(normalizeFdicPercent(-192.66), -192.66)
  })

  it("returns null for missing or non-finite input", () => {
    assert.strictEqual(normalizeFdicPercent(null), null)
    assert.strictEqual(normalizeFdicPercent(undefined), null)
    assert.strictEqual(normalizeFdicPercent(Number.NaN), null)
    assert.strictEqual(normalizeFdicPercent(Number.POSITIVE_INFINITY), null)
  })

  it("keeps a zero, unlike the capital ratios", () => {
    // A bank really can earn nothing. Zero regulatory capital, by contrast, is
    // FDIC's way of saying the ratio was not computed.
    assert.strictEqual(normalizeFdicPercent(0), 0)
    assert.strictEqual(normalizeCapitalRatioPercent(0), null)
  })
})
