import test from "node:test"
import assert from "node:assert/strict"
import { classifyCapital, describeCapitalDowngrade } from "./capital-category.ts"

test("a bank clearing every threshold is well capitalised", () => {
  const c = classifyCapital({ leverageRatio: 9.5, tier1RbcRatio: 13.2, totalRbcRatio: 14.4, cet1Ratio: 13.2 })
  assert.equal(c?.category, "well")
  assert.equal(c?.basis, "risk-based")
})

test("the weakest ratio binds: one ratio below the well line makes the bank adequately capitalised", () => {
  const c = classifyCapital({ leverageRatio: 4.6, tier1RbcRatio: 13, totalRbcRatio: 14, cet1Ratio: 13 })
  assert.equal(c?.category, "adequate")
  assert.equal(c?.binding, "leverage 4.60%")
})

test("Community B&T West Georgia, March 2026: critically undercapitalised", () => {
  // Leverage 0.16%, CET1 0.19%, total RBC 1.49%, equity 3,826 on assets 292,567.
  const c = classifyCapital({
    leverageRatio: 0.15966,
    cet1Ratio: 0.19,
    totalRbcRatio: 1.49,
    equityToAssetsPct: (3826 / 292567) * 100,
  })
  assert.equal(c?.category, "critical")
  assert.match(c!.binding, /^equity to assets 1\.31%/)
})

test("the same bank one quarter earlier was only adequately capitalised, on total risk-based capital", () => {
  const c = classifyCapital({ leverageRatio: 6.697, cet1Ratio: 8.41, totalRbcRatio: 9.678, equityToAssetsPct: 5.9 })
  // Total RBC 9.68% is below the 10% well line, so adequately capitalised.
  assert.equal(c?.category, "adequate")
  assert.equal(c?.binding, "total risk-based 9.68%")
})

test("a CBLR filer reports zero risk-based ratios and is classified on leverage alone", () => {
  const c = classifyCapital({ leverageRatio: 10.2, tier1RbcRatio: 0, totalRbcRatio: 0, cet1Ratio: null })
  assert.equal(c?.category, "well")
  assert.equal(c?.basis, "leverage-only")
})

test("a leverage-only filer below 4% is undercapitalised, not ignored", () => {
  const c = classifyCapital({ leverageRatio: 3.5 })
  assert.equal(c?.category, "under")
})

test("no ratios reported at all is null, not a category", () => {
  assert.equal(classifyCapital({ leverageRatio: 0, totalRbcRatio: null }), null)
})

test("only a worsening category is described", () => {
  const well = classifyCapital({ leverageRatio: 9, totalRbcRatio: 14 })
  const under = classifyCapital({ leverageRatio: 3.8, totalRbcRatio: 7.5 })
  assert.equal(describeCapitalDowngrade(under, well), null)
  assert.equal(describeCapitalDowngrade(well, well), null)
  assert.equal(
    describeCapitalDowngrade(well, under),
    "Capital category fell from well capitalised to undercapitalised (total risk-based 7.50%)."
  )
})
