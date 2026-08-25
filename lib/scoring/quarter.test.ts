import { test } from "node:test"
import assert from "node:assert/strict"
import { formatQuarter, normalizeQuarter, quartersBetween } from "./quarter.ts"

test("normalizeQuarter accepts both shapes the FDIC paths produce", () => {
  assert.equal(normalizeQuarter("20251231"), "20251231")
  assert.equal(normalizeQuarter("2025-12-31"), "20251231")
  assert.equal(normalizeQuarter(undefined), "")
  assert.equal(normalizeQuarter(""), "")
})

test("quartersBetween counts calendar quarters, not days", () => {
  // Q2 to Q3 is 92 days and Q4 to Q1 is 90; both are one quarter.
  assert.equal(quartersBetween("20250630", "20250930"), 1)
  assert.equal(quartersBetween("20251231", "20260331"), 1)
})

test("quartersBetween crosses year boundaries", () => {
  assert.equal(quartersBetween("20240331", "20260331"), 8)
  assert.equal(quartersBetween("20250930", "20260331"), 2)
})

test("quartersBetween is zero for the same quarter", () => {
  assert.equal(quartersBetween("20251231", "20251231"), 0)
})

test("quartersBetween reads a malformed date as not stale", () => {
  // Better to under-report staleness than to invent a multi-year gap from a
  // date the parser did not understand.
  assert.equal(quartersBetween("2025-12-31", "20260331"), 0)
  assert.equal(quartersBetween("", "20260331"), 0)
})

test("formatQuarter maps each month-end to its quarter", () => {
  assert.equal(formatQuarter("20260331"), "Q1 2026")
  assert.equal(formatQuarter("20260630"), "Q2 2026")
  assert.equal(formatQuarter("20260930"), "Q3 2026")
  assert.equal(formatQuarter("20261231"), "Q4 2026")
})
