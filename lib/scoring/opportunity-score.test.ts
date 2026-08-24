import { test } from "node:test"
import assert from "node:assert/strict"
import {
  percentileRank,
  computeOpportunityDistributions,
  computeOpportunityScore,
  type OpportunityInput,
} from "./opportunity-score.ts"

test("percentileRank places a value by midrank", () => {
  const sorted = [1, 2, 3, 4]
  assert.equal(percentileRank(sorted, 1), 0.125)
  assert.equal(percentileRank(sorted, 4), 0.875)
})

test("percentileRank averages heavy ties instead of bottoming them out", () => {
  // Eight banks report zero, two report something. The zeros should share the
  // middle of the band they span, not all sit at the very bottom.
  const sorted = [0, 0, 0, 0, 0, 0, 0, 0, 5, 9]
  assert.equal(percentileRank(sorted, 0), 0.4)
  assert.equal(percentileRank(sorted, 9), 0.95)
})

test("percentileRank makes no claim on an empty or flat cohort", () => {
  assert.equal(percentileRank([], 3), 0.5)
  assert.equal(percentileRank([7, 7, 7], 7), 0.5)
})

test("an outlier does not compress the rest of the cohort", () => {
  // The failure this replaces: one extreme institution stretched the min-max
  // scale so everyone else collapsed toward the middle.
  const ordinary: OpportunityInput[] = Array.from({ length: 20 }, (_, i) => ({
    creConcentration: 10 + i,
    noncurrentToLoansRatio: 0.01,
    loanLossReserve: 0.015,
    cet1Ratio: 12,
  }))
  const withOutlier = [...ordinary, { creConcentration: 5000, noncurrentToLoansRatio: 0.01, loanLossReserve: 0.015, cet1Ratio: 12 }]

  const dist = computeOpportunityDistributions(withOutlier)
  const creScores = ordinary.map((r) => computeOpportunityScore(r, dist))
  const spread = Math.max(...creScores) - Math.min(...creScores)

  // Under min-max the 20 ordinary banks would sit within a fraction of a point
  // of each other. Percentile rank keeps them spread across the CRE weighting.
  assert.ok(spread > 25, `expected the cohort to stay separated, got a spread of ${spread}`)
})

test("higher CRE concentration scores higher, all else equal", () => {
  const rows: OpportunityInput[] = [
    { creConcentration: 5, noncurrentToLoansRatio: 0.01, loanLossReserve: 0.015, cet1Ratio: 12 },
    { creConcentration: 50, noncurrentToLoansRatio: 0.01, loanLossReserve: 0.015, cet1Ratio: 12 },
  ]
  const dist = computeOpportunityDistributions(rows)
  assert.ok(computeOpportunityScore(rows[1], dist) > computeOpportunityScore(rows[0], dist))
})

test("a thinner reserve and thinner capital both score higher", () => {
  const base = { creConcentration: 30, noncurrentToLoansRatio: 0.01 }
  const rows: OpportunityInput[] = [
    { ...base, loanLossReserve: 0.03, cet1Ratio: 18 }, // well reserved, well capitalised
    { ...base, loanLossReserve: 0.005, cet1Ratio: 8 }, // thin on both
  ]
  const dist = computeOpportunityDistributions(rows)
  assert.ok(
    computeOpportunityScore(rows[1], dist) > computeOpportunityScore(rows[0], dist),
    "the thinly reserved, thinly capitalised bank should rank as more stressed"
  )
})

test("scores stay inside 0-100", () => {
  const rows: OpportunityInput[] = [
    { creConcentration: 0, noncurrentToLoansRatio: 0, loanLossReserve: 0, cet1Ratio: 0 },
    { creConcentration: 900, noncurrentToLoansRatio: 1, loanLossReserve: 1, cet1Ratio: 99 },
  ]
  const dist = computeOpportunityDistributions(rows)
  for (const r of rows) {
    const s = computeOpportunityScore(r, dist)
    assert.ok(s >= 0 && s <= 100, `score out of range: ${s}`)
  }
})
