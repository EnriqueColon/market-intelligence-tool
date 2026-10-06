import test from "node:test"
import assert from "node:assert/strict"
import { headlineQuarter, pickHeadlineFiling } from "./headline-filing.ts"

// FDIC rows arrive sorted by assets, not by date. A shrinking bank's largest
// quarter is its oldest one, which is exactly the order that fooled the old
// Date.parse sort.
const shrinkingBank = [
  { reportDate: "20250930", totalAssets: 300 },
  { reportDate: "20260331", totalAssets: 280 },
  { reportDate: "20260630", totalAssets: 250 },
]

test("headlineQuarter is the newest YYYYMMDD date regardless of input order", () => {
  assert.equal(headlineQuarter(shrinkingBank), "20260630")
  assert.equal(headlineQuarter([{ reportDate: "2026-03-31" }, { reportDate: "20251231" }]), "20260331")
  assert.equal(headlineQuarter([]), "")
  assert.equal(headlineQuarter([{ reportDate: undefined }]), "")
})

test("pickHeadlineFiling returns the filing for the headline quarter, not the largest-asset row", () => {
  const picked = pickHeadlineFiling(shrinkingBank, "20260630")
  assert.equal(picked?.reportDate, "20260630")
  assert.equal(picked?.totalAssets, 250)
})

test("an institution that did not file for the headline quarter is held out", () => {
  // Failed 1 May 2026: last filing is Q1 2026, headline is Q2 2026.
  const failedBank = [{ reportDate: "20260331" }, { reportDate: "20251231" }, { reportDate: "20250930" }]
  assert.equal(pickHeadlineFiling(failedBank, "20260630"), null)
})

test("dash-separated and compact dates compare as the same quarter", () => {
  const picked = pickHeadlineFiling([{ reportDate: "2026-06-30" }], "20260630")
  assert.equal(picked?.reportDate, "2026-06-30")
})

test("no headline quarter means no cohort", () => {
  assert.equal(pickHeadlineFiling(shrinkingBank, ""), null)
})
