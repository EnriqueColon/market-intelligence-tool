import test from "node:test"
import assert from "node:assert/strict"
import type { BankBehaviorSummary, BehaviorMeasures, SignalKey } from "@/lib/analytics/bank-behavior-signals"
import {
  assessSeller,
  describeState,
  rankSellers,
  SELLER_THRESHOLDS,
  stateCounts,
  STATE_MEANINGS,
} from "@/lib/analytics/seller-likelihood"

const NO_MEASURES: BehaviorMeasures = {
  hfsBalance: null, hfsPct: null, hfsChangePct: null, hfsTrailingMax: null,
  loanSaleGainQ: null, priorQuartersWithSales: null, creNcoRateQ: null, creNcoRateTrailingMean: null,
  unexplainedExit: null, unexplainedExitPctOfCre: null, unexplainedExitShareOfPrior: null,
  nonaccrualCreChange: null, oreoCrePct: null, oreoCreChangePct: null,
  modificationsCrePct: null, modificationsCreChangePct: null, pastDueCreChange: null,
  creRunoffPct: null, creRunoff4qPct: null,
}

function bank(over: {
  cert?: string
  measures?: Partial<BehaviorMeasures>
  percentiles?: BankBehaviorSummary["percentiles"]
  fired?: SignalKey[]
} = {}): BankBehaviorSummary {
  const fired = over.fired ?? []
  return {
    cert: over.cert ?? "1", name: "Test Bank", state: "FL", quarter: "20260630", current: true,
    quartersAvailable: 9, totalAssets: 500_000, grossLoans: 350_000, creLoans: 200_000, band: "250m-500m",
    measures: { ...NO_MEASURES, ...over.measures },
    percentiles: over.percentiles ?? {},
    fired,
    unjudged: [],
    actionCount: fired.filter((f) => f !== "modificationBuild").length,
    pressureCount: fired.filter((f) => f === "modificationBuild").length,
  }
}

test("a bank acting this quarter is an active seller, whatever its score", () => {
  const a = assessSeller(bank({ fired: ["hfsTransfer", "realizedSale"] }))
  assert.equal(a.state, "active-seller")
  assert.deepEqual(a.firedActions, ["hfsTransfer", "realizedSale"])
  assert.match(a.reason, /something moving to bid on/)
})

test("a pressure-side signal alone does not make a bank an active seller", () => {
  // Modification build is pressure, not action: the bank is giving terms, not
  // selling. Treating it as action would put every deteriorating bank on the
  // biddable list.
  const a = assessSeller(bank({ fired: ["modificationBuild"], measures: { oreoCrePct: 0.001 } }))
  assert.notEqual(a.state, "active-seller")
  assert.deepEqual(a.firedActions, [])
})

test("high pressure with nothing moving is the pre-seller state", () => {
  const a = assessSeller(bank({ measures: { oreoCrePct: 0.03, modificationsCrePct: 0.03, creNcoRateQ: 0.008 } }))
  assert.equal(a.state, "pre-seller")
  assert.ok((a.score ?? 0) > 0)
  assert.match(a.reason, /before a pool is marketed|price is set/)
})

test("a low percentile cannot hide a high absolute rate", () => {
  // A percentile alone would read a scope where everyone is stressed as a scope
  // where nobody is. The rate has to carry the day, with corroboration.
  // oreo at its ceiling (0.15 weight), modifications at its ceiling (0.20) and
  // charge-offs at theirs (0.15) clear the floor even with the percentile
  // contributing almost nothing — which is the point: the percentile is 20% of
  // the weight and cannot veto the absolute rates.
  const a = assessSeller(bank({
    measures: { oreoCrePct: 0.03, modificationsCrePct: 0.04, creNcoRateQ: 0.01 },
    percentiles: { oreoCrePct: 10 },
  }))
  assert.ok((a.score ?? 0) >= SELLER_THRESHOLDS.absolutePathMinimumScore, `scored ${a.score}`)
  assert.equal(a.state, "pre-seller", "sitting low in a stressed cohort is still pressure")
})

test("a bank that acted and is now calm reads as cleaned up", () => {
  const a = assessSeller(bank({ measures: { oreoCrePct: 0.0001 } }), { priorActionCounts: [2, 1, 0, 0] })
  assert.equal(a.state, "cleaned-up")
  assert.match(a.reason, /Little left to buy/)
})

test("without a history, cleaned-up cannot be told from stable, and it says so", () => {
  const a = assessSeller(bank({ measures: { oreoCrePct: 0.0001 } }))
  assert.equal(a.state, "stable")
  assert.match(a.reason, /cannot be distinguished/)
})

test("a calm bank with a history is simply stable", () => {
  const a = assessSeller(bank({ measures: { oreoCrePct: 0.0001 } }), { priorActionCounts: [0, 0, 0, 0] })
  assert.equal(a.state, "stable")
  assert.ok(!a.reason.includes("cannot be distinguished"))
})

test("a bank reporting nothing is unscored, not scored zero", () => {
  const a = assessSeller(bank())
  assert.equal(a.score, null, "no inputs means no score — not a calm bank")
  assert.equal(a.confidence, 0)
  assert.equal(a.state, "stable")
})

test("confidence reports how much of the score was actually observed", () => {
  const partial = assessSeller(bank({ measures: { oreoCrePct: 0.01 } }))
  assert.ok(partial.confidence > 0 && partial.confidence < 1)
  const full = assessSeller(bank({
    measures: {
      modificationsCrePct: 0.01, unexplainedExitPctOfCre: 0.002, oreoCrePct: 0.01,
      creNcoRateQ: 0.002, creRunoff4qPct: -0.05,
    },
    percentiles: { oreoCrePct: 50 },
  }))
  assert.equal(Math.round(full.confidence * 100), 100)
})

test("a score is computed over observed weight, so a partial reporter is not read as calm", () => {
  // One component at its ceiling and nothing else reported should score high on
  // what was seen, with low confidence — not low because the rest was absent.
  const a = assessSeller(bank({ measures: { oreoCrePct: 0.03 } }))
  assert.ok((a.score ?? 0) >= 90, `scored ${a.score}`)
  assert.ok(a.confidence < 0.3)
})

test("a measure beyond its ceiling cannot dominate the score", () => {
  const extreme = assessSeller(bank({ measures: { oreoCrePct: 10 } }))
  const atCeiling = assessSeller(bank({ measures: { oreoCrePct: 0.03 } }))
  assert.equal(extreme.score, atCeiling.score, "one outlier must not outweigh everything else")
})

test("runoff counts as pressure only when the book is shrinking", () => {
  const shrinking = assessSeller(bank({ measures: { creRunoff4qPct: -0.15 } }))
  const growing = assessSeller(bank({ measures: { creRunoff4qPct: 0.15 } }))
  assert.ok((shrinking.score ?? 0) > (growing.score ?? 0))
  assert.equal(growing.components.find((c) => c.key === "runoff")?.value, 0)
})

test("the ranked list is biddable first, then pre-sellers by score", () => {
  const ranked = rankSellers([
    assessSeller(bank({ cert: "quiet", measures: { oreoCrePct: 0.0001 } }), { priorActionCounts: [0] }),
    assessSeller(bank({ cert: "pre-low", measures: { oreoCrePct: 0.02, modificationsCrePct: 0.01 } })),
    assessSeller(bank({ cert: "pre-high", measures: { oreoCrePct: 0.03, modificationsCrePct: 0.04, creNcoRateQ: 0.01 } })),
    assessSeller(bank({ cert: "acting", fired: ["realizedSale", "foreclosureRoute"] })),
  ])
  assert.equal(ranked[0].cert, "acting", "biddable today leads")
  assert.equal(ranked[1].cert, "pre-high")
  assert.ok(!ranked.some((r) => r.cert === "quiet"), "stable banks are excluded, not ranked last")
})

test("a pre-seller below the interesting floor is left off the list", () => {
  // oreo at ceiling, modifications three-quarters, percentile mid: lands in the
  // seventies — a genuine pre-seller, but under a 95 floor.
  const modest = assessSeller(bank({
    cert: "modest",
    measures: { oreoCrePct: 0.03, modificationsCrePct: 0.03 },
    percentiles: { oreoCrePct: 50 },
  }))
  assert.equal(modest.state, "pre-seller")
  assert.ok((modest.score ?? 0) >= 50 && (modest.score ?? 0) < 95, `scored ${modest.score}`)
  const ranked = rankSellers([modest], 95)
  assert.equal(ranked.length, 0, "a list nobody will call is not a list")
})

test("state counts cover every bank exactly once", () => {
  const all = [
    assessSeller(bank({ fired: ["hfsTransfer", "realizedSale"] })),
    assessSeller(bank({ measures: { oreoCrePct: 0.03 } })),
    assessSeller(bank({ measures: { oreoCrePct: 0.0001 } }), { priorActionCounts: [1] }),
    assessSeller(bank({ measures: { oreoCrePct: 0.0001 } }), { priorActionCounts: [0] }),
  ]
  const c = stateCounts(all)
  assert.equal(c["active-seller"] + c["pre-seller"] + c["cleaned-up"] + c.stable, all.length)
  assert.equal(c["active-seller"], 1)
  assert.equal(c["pre-seller"], 1)
})

test("every state explains itself, and the pre-seller case says why it matters", () => {
  for (const state of ["active-seller", "pre-seller", "cleaned-up", "stable"] as const) {
    const d = describeState(state)
    assert.ok(d.label.length > 0)
    assert.ok(d.meaning.length > 30, state)
  }
  assert.match(STATE_MEANINGS["pre-seller"], /before a pool is marketed/)
})

test("every component declares a weight, a meaning and a bounded value", () => {
  const a = assessSeller(bank({ measures: { oreoCrePct: 0.01, modificationsCrePct: 0.01 } }))
  assert.ok(a.components.length >= 5)
  const total = a.components.reduce((s, c) => s + c.weight, 0)
  assert.ok(Math.abs(total - 1) < 0.001, `weights must sum to 1, got ${total}`)
  for (const c of a.components) {
    assert.ok(c.meaning.length > 25, c.key)
    if (c.value != null) assert.ok(c.value >= 0 && c.value <= 1, `${c.key} = ${c.value}`)
  }
})

test("a high score on one observed measure cannot make a bank a pre-seller", () => {
  // The score is computed over observed weight, so one component at its ceiling
  // scores ~100 on ~15% confidence. Letting that drive the state put 45% of the
  // backtest's bank-quarters into pre-seller.
  const thin = assessSeller(bank({ measures: { creNcoRateQ: 0.02 } }), { priorActionCounts: [0] })
  assert.ok((thin.score ?? 0) >= 90, `scored ${thin.score}`)
  assert.ok(thin.confidence < SELLER_THRESHOLDS.minimumConfidence)
  assert.equal(thin.state, "stable", "a score on one measure is not evidence of pressure")
  assert.equal(thin.score != null, true, "the score is still reported, with its confidence")
})

test("the same score on enough observed measures does make a pre-seller", () => {
  const solid = assessSeller(
    bank({
      measures: {
        modificationsCrePct: 0.04, unexplainedExitPctOfCre: 0.01, oreoCrePct: 0.03,
        creNcoRateQ: 0.01, creRunoff4qPct: -0.15,
      },
      percentiles: { oreoCrePct: 90 },
    }),
    { priorActionCounts: [0] }
  )
  assert.ok(solid.confidence >= SELLER_THRESHOLDS.minimumConfidence)
  assert.equal(solid.state, "pre-seller")
  assert.match(solid.reason, /on \d+% of the measures/)
})

test("an absolute rate sets the state without needing full confidence, but needs corroboration", () => {
  // One rate above the floor with nothing behind it described 29.7% of the
  // 4,603-bank national cohort, so the absolute path now needs a score too.
  const corroborated = assessSeller(bank({ measures: { oreoCrePct: 0.03 } }), { priorActionCounts: [0] })
  assert.ok(corroborated.confidence < SELLER_THRESHOLDS.minimumConfidence)
  assert.ok((corroborated.score ?? 0) >= SELLER_THRESHOLDS.absolutePathMinimumScore)
  assert.equal(corroborated.state, "pre-seller")

  // The same rate, but everything else reported and calm: not a pre-seller.
  const isolated = assessSeller(
    bank({
      measures: {
        oreoCrePct: SELLER_THRESHOLDS.nonaccrualRateFloor,
        modificationsCrePct: 0, unexplainedExitPctOfCre: 0, creNcoRateQ: 0, creRunoff4qPct: 0.2,
      },
      percentiles: { oreoCrePct: 5 },
    }),
    { priorActionCounts: [0] }
  )
  assert.ok((isolated.score ?? 100) < SELLER_THRESHOLDS.absolutePathMinimumScore, `scored ${isolated.score}`)
  assert.notEqual(isolated.state, "pre-seller", "one elevated rate in an otherwise calm book is not a pre-seller")
})

test("the interesting floor was chosen from the cohort, not by taste", () => {
  // At 40 the ranked list was 1,005 of 4,603 banks; at 70 it is 288.
  assert.equal(SELLER_THRESHOLDS.minimumInterestingScore, 70)
})

test("two action signals are required to call a bank an active seller", () => {
  // One fires on roughly a quarter of banks: step 2 measured CRE runoff alone
  // at 12.6% nationally. Two or more was 3.6%.
  assert.equal(SELLER_THRESHOLDS.activeActionCount, 2)
  const one = assessSeller(bank({ fired: ["creRunoff"], measures: { oreoCrePct: 0.0001 } }), { priorActionCounts: [0] })
  assert.notEqual(one.state, "active-seller")
  const two = assessSeller(bank({ fired: ["creRunoff", "hfsTransfer"] }), { priorActionCounts: [0] })
  assert.equal(two.state, "active-seller")
})
