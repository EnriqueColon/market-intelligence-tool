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
import { normalizePercentToDecimal, formatDecimalAsPercent } from "./metrics.ts"

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
