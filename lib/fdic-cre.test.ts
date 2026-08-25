import { test } from "node:test"
import assert from "node:assert/strict"
import { computeCreLoans, computeCreMix, type CreComponents } from "./fdic-cre.ts"

const components = (over: Partial<CreComponents> = {}): CreComponents => ({
  constructionLoans: 0,
  multifamilyLoans: 0,
  nonResidentialLoans: 0,
  ownerOccupiedLoans: 0,
  nonOwnerOccupiedLoans: 0,
  ...over,
})

test("uses only the non-owner-occupied half of non-residential", () => {
  // Capital Community Bank, 2026Q1: owner-occupied is the larger half, so
  // including it nearly doubles the apparent commercial exposure.
  const cre = computeCreLoans(
    components({
      constructionLoans: 100,
      multifamilyLoans: 50,
      nonResidentialLoans: 449,
      ownerOccupiedLoans: 288,
      nonOwnerOccupiedLoans: 161,
    })
  )
  assert.equal(cre, 100 + 50 + 161)
})

test("falls back to undivided non-residential when the split does not reconcile", () => {
  const cre = computeCreLoans(
    components({
      constructionLoans: 10,
      nonResidentialLoans: 400,
      ownerOccupiedLoans: 0,
      nonOwnerOccupiedLoans: 0,
    })
  )
  assert.equal(cre, 410, "dropping the exposure entirely would understate risk")
})

test("tolerates rounding of one unit in the split", () => {
  const cre = computeCreLoans(
    components({ nonResidentialLoans: 300, ownerOccupiedLoans: 100, nonOwnerOccupiedLoans: 201 })
  )
  assert.equal(cre, 201)
})

test("a bank with no commercial exposure scores zero", () => {
  assert.equal(computeCreLoans(components()), 0)
})

test("regression: the guidance figure is far below the double-counted one", () => {
  // United Texas Bank, 2026Q1, in thousands. The old derivation added LNREOTH
  // and used the undivided non-residential figure, reporting 330% of capital
  // against a true 240% and fabricating a 300% supervisory crossing.
  const capital = 167_000
  const lnreoth = 151_418
  const c = components({
    constructionLoans: 25_000,
    multifamilyLoans: 15_000,
    nonResidentialLoans: 375_135,
    ownerOccupiedLoans: 0,
    nonOwnerOccupiedLoans: 375_135,
  })

  const corrected = computeCreLoans(c) / capital
  const oldWay = (c.constructionLoans + c.multifamilyLoans + c.nonResidentialLoans + lnreoth) / capital

  assert.ok(corrected < oldWay, "the double-count must inflate the ratio")
  assert.ok(oldWay >= 3, "the old derivation crossed the supervisory screen")
  assert.ok(corrected < 3, "the corrected derivation does not")
})

test("the mix sums to 100%, because its parts are the ones creLoans adds", () => {
  const mix = computeCreMix(
    components({
      constructionLoans: 100,
      multifamilyLoans: 50,
      nonResidentialLoans: 449,
      ownerOccupiedLoans: 288,
      nonOwnerOccupiedLoans: 161,
    })
  )!
  assert.ok(Math.abs(mix.construction + mix.multifamily + mix.nonResidential - 100) < 1e-9)
})

test("the mix excludes owner-occupied, matching the CRE denominator", () => {
  const c = components({
    constructionLoans: 100,
    multifamilyLoans: 50,
    nonResidentialLoans: 449,
    ownerOccupiedLoans: 288,
    nonOwnerOccupiedLoans: 161,
  })
  const mix = computeCreMix(c)!

  // 161 of 311, not 449 of 311. The old cell divided the undivided LNRENRES
  // by a total that had already dropped the owner-occupied half.
  assert.ok(Math.abs(mix.nonResidential - (161 / 311) * 100) < 1e-9)
  assert.ok(mix.nonResidential < 100, "a single part cannot exceed the whole")
  assert.ok((449 / computeCreLoans(c)) * 100 > 100, "which the old derivation did")
})

test("regression: LNREOTH is not a slice of the CRE book", () => {
  // Liberty Savings Bank FSB, 2026Q1, in thousands: a thrift with a large
  // closed-end 1-4 family book and almost no CRE. Drawing LNREOTH as a fourth
  // band against a CRE denominator took its stacked bar to 681,607% of an
  // axis that stops at 100. LNREOTH is residential: LNRERES - LNRELOC.
  const c = components({ constructionLoans: 0, multifamilyLoans: 116, nonResidentialLoans: 116, ownerOccupiedLoans: 0, nonOwnerOccupiedLoans: 116 })
  const lnreoth = 789_000
  const mix = computeCreMix(c)!

  const bands = mix.construction + mix.multifamily + mix.nonResidential
  assert.ok(Math.abs(bands - 100) < 1e-9)

  const oldBands = bands + (lnreoth / computeCreLoans(c)) * 100
  assert.ok(oldBands > 100_000, "the old fourth band dwarfed the chart")
})

test("a bank holding no CRE has no mix, rather than a row of zeroes", () => {
  assert.equal(computeCreMix(components()), null)
})

test("the mix uses the same fallback as the total when the split fails", () => {
  const c = components({ constructionLoans: 10, nonResidentialLoans: 400 })
  const mix = computeCreMix(c)!
  assert.ok(Math.abs(mix.nonResidential - (400 / 410) * 100) < 1e-9)
  assert.ok(Math.abs(mix.construction + mix.multifamily + mix.nonResidential - 100) < 1e-9)
})
