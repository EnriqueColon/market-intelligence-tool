import { test } from "node:test"
import assert from "node:assert/strict"
import {
  computeDownside,
  ADEQUATE_RBC,
  ADEQUATE_LEVERAGE,
  CBLR_TRIGGER,
} from "./cre-downside.ts"

const K = 1000

test("risk-based base case reconciles to FDIC's published RBCRWAJ", () => {
  // Seacoast National Bank, CERT 131, 20251231. Every figure below is as
  // returned by the FDIC financials endpoint, in thousands. (T1 + T2) / RWA
  // reproduces the published RBCRWAJ to full float precision, which is what
  // licenses using the reported dollars as the scenario's starting point.
  const scenario = computeDownside({
    creLoans: (723_931 + 330_496 + 3_776_662) * K,
    tier1Dollars: 1_952_001 * K,
    tier2Dollars: 176_606 * K,
    riskWeightedAssets: 14_123_225 * K,
    totalRbcRatio: 15.071678033876823,
  })
  assert.ok(scenario)
  assert.equal(scenario.regime, "risk-based")
  assert.equal(scenario.floor.value, ADEQUATE_RBC)
  assert.equal(scenario.floors.length, 1)
  // The published figure is used as-is rather than recomputed.
  assert.equal(scenario.baseRatio, 15.071678033876823)
  // And the parts agree with it, which is what makes that safe.
  assert.ok(Math.abs((scenario.capital / scenario.denominator) * 100 - 15.071678033876823) < 1e-12)
})

test("a CBLR filer is stressed on leverage, not on a fabricated RWA", () => {
  // United Southern Bank, CERT 15465, 20251231. It reports Tier 1 dollars and a
  // leverage ratio, and *zero* — not null — for RWAJ and RBCRWAJ. The zero is
  // the trap: a null check passes it through and divides by it. This is also
  // the case a 0.75-of-assets proxy would silently invent a denominator for.
  const scenario = computeDownside({
    creLoans: (43_280 + 14_452 + 138_214) * K,
    tier1Dollars: 90_918 * K,
    tier2Dollars: 0,
    riskWeightedAssets: 0,
    totalRbcRatio: 0,
    leverageRatio: 10.378790819157121,
  })
  assert.ok(scenario)
  assert.equal(scenario.regime, "leverage")
  // Headline floor is PCA adequately-capitalised, matching what risk-based
  // filers are measured against. The CBLR election trigger comes second.
  assert.equal(scenario.floor.value, ADEQUATE_LEVERAGE)
  assert.equal(scenario.floors[1].value, CBLR_TRIGGER)
  // Base case equals the published leverage ratio by construction.
  assert.ok(Math.abs(scenario.baseRatio - 10.378790819157121) < 1e-12)
  assert.ok(Math.abs((scenario.capital / scenario.denominator) * 100 - 10.378790819157121) < 1e-9)
  // Average assets over the quarter, not the 841,773k of period-end assets.
  assert.ok(scenario.denominator > 870_000 * K)
})

test("the two regimes are measured against comparable levels", () => {
  // The bug this pins: using the 9% CBLR election trigger as the headline floor
  // for leverage filers, against 8% total risk-based capital for everyone else.
  // CBLR banks deliberately sit just above 9%, so every one of them came back
  // with a break-even mark in the low single digits while risk-based banks of
  // identical credit quality came back near 18%. The ranking was measuring the
  // reporting regime, not the risk.
  //
  // Two banks funded alike: 10% Tier 1 against assets, CRE at 30% of assets.
  const assets = 1_000_000 * K
  const cre = 300_000 * K
  const leverageFiler = computeDownside({
    creLoans: cre,
    tier1Dollars: 100_000 * K,
    tier2Dollars: 0,
    riskWeightedAssets: 0,
    totalRbcRatio: 0,
    leverageRatio: 10,
  })!
  const riskBasedFiler = computeDownside({
    creLoans: cre,
    tier1Dollars: 100_000 * K,
    tier2Dollars: 0,
    // A 75% average risk weighting, the tool's own proxy assumption.
    riskWeightedAssets: 0.75 * assets,
    totalRbcRatio: (100_000 * K) / (0.75 * assets) * 100,
  })!

  // The two measures still differ — a leverage denominator is all assets where
  // a risk-based one is only the weighted portion — so the marks are not equal
  // and should not be. What must not survive is the leverage filer coming out a
  // small multiple thinner purely because of which form it files.
  const ratio = leverageFiler.breakEvenMark! / riskBasedFiler.breakEvenMark!
  assert.ok(
    ratio > 0.75,
    `leverage filer breaks even at ${(leverageFiler.breakEvenMark! * 100).toFixed(1)}% against ` +
      `${(riskBasedFiler.breakEvenMark! * 100).toFixed(1)}% for an identically funded risk-based filer`
  )

  // The CBLR trigger is still reported and is far nearer — roughly a third of
  // the distance. That gap is precisely why it cannot be the headline: read as
  // a capital floor it would overstate the risk threefold.
  const trigger = leverageFiler.floors[1]
  assert.equal(trigger.value, CBLR_TRIGGER)
  assert.ok(trigger.breakEvenMark! < leverageFiler.breakEvenMark! / 2)
})

test("break-even mark is where the ratio meets the floor", () => {
  const scenario = computeDownside({
    creLoans: 100,
    tier1Dollars: 15,
    tier2Dollars: 0,
    riskWeightedAssets: 100,
    totalRbcRatio: 15,
  })
  assert.ok(scenario)
  // Capital 15 on RWA 100. Reaching 8% needs capital of 8, so a loss of 7 on a
  // CRE book of 100 — a 7% mark.
  assert.ok(Math.abs(scenario.breakEvenMark! - 0.07) < 1e-9)
  const atBreakEven = ((15 - 0.07 * 100) / 100) * 100
  assert.ok(Math.abs(atBreakEven - 8) < 1e-9)
})

test("marks report the resulting ratio and whether it breaches", () => {
  const scenario = computeDownside(
    { creLoans: 100, tier1Dollars: 15, tier2Dollars: 0, riskWeightedAssets: 100, totalRbcRatio: 15 },
    [0.05, 0.1]
  )
  assert.ok(scenario)
  assert.ok(Math.abs(scenario.marks[0].ratio - 10) < 1e-9)
  assert.equal(scenario.marks[0].belowFloor, false)
  assert.ok(Math.abs(scenario.marks[1].ratio - 5) < 1e-9)
  assert.equal(scenario.marks[1].belowFloor, true)
  assert.equal(scenario.marks[1].lossDollars, 10)
})

test("no break-even when the CRE book is too small to reach the floor", () => {
  // Capital 15 against RWA 100 needs a 7-dollar loss, but the whole CRE book is
  // 5 dollars. A mark above 100% is not a scenario.
  const scenario = computeDownside({
    creLoans: 5,
    tier1Dollars: 15,
    tier2Dollars: 0,
    riskWeightedAssets: 100,
    totalRbcRatio: 15,
  })
  assert.ok(scenario)
  assert.equal(scenario.breakEvenMark, null)
  assert.equal(scenario.alreadyBelowFloor, false)
})

test("an institution already under the floor has no break-even to find", () => {
  const scenario = computeDownside({
    creLoans: 100,
    tier1Dollars: 7,
    tier2Dollars: 0,
    riskWeightedAssets: 100,
    totalRbcRatio: 7,
  })
  assert.ok(scenario)
  assert.equal(scenario.alreadyBelowFloor, true)
  assert.equal(scenario.breakEvenMark, null)
})

test("tier 2 of zero is used, not treated as missing", () => {
  // Many small banks genuinely hold no Tier 2. Reading that as absent would
  // push them onto the leverage path and measure them against the wrong floor.
  const scenario = computeDownside({
    creLoans: 100,
    tier1Dollars: 12,
    tier2Dollars: 0,
    riskWeightedAssets: 100,
    totalRbcRatio: 12,
    leverageRatio: 11,
  })
  assert.ok(scenario)
  assert.equal(scenario.regime, "risk-based")
  assert.equal(scenario.capital, 12)
})

test("nothing is returned when neither regime can be established", () => {
  assert.equal(computeDownside({ creLoans: 100 }), null)
  assert.equal(computeDownside({ creLoans: 100, tier1Dollars: 10 }), null)
  // No CRE book means no CRE scenario.
  assert.equal(
    computeDownside({ creLoans: 0, tier1Dollars: 10, riskWeightedAssets: 100, totalRbcRatio: 10 }),
    null
  )
})
