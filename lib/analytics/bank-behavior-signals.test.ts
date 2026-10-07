import test from "node:test"
import assert from "node:assert/strict"
import { buildBehaviorHistory, type BehaviorHistory } from "./bank-behavior"
import {
  ASSET_BANDS,
  SIGNALS,
  SIGNAL_KEYS,
  SIGNAL_THRESHOLDS,
  assetBandOf,
  computeBehaviorSignals,
  judgeSignals,
  measuresAt,
  rollForward,
  signalResultsOf,
  summarizeBank,
  type BehaviorMeasures,
} from "./bank-behavior-signals"

/** A quiet $1B bank: 600M loans, 300M CRE (all non-owner nonfarm), nothing moving. */
function quietRow(quarter: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CERT: 1,
    NAME: "QUIET BANK",
    STNAME: "FLORIDA",
    REPDTE: quarter,
    ASSET: 1_000_000,
    LNLSGR: 600_000,
    LNRECONS: 0, LNREMULT: 0, LNRENRES: 300_000, LNRENROW: 0, LNRENROT: 300_000,
    LNLSSALE: 0, NALNSALE: 0, P3LNSALE: 0, P9LNSALE: 0,
    NETGNSLN: 0, NTGLLNQ: 0,
    DRRECONS: 0, CRRECONS: 0, NTRECONS: 0, NTRECONQ: 0,
    DRREMULT: 0, CRREMULT: 0, NTREMULT: 0, NTREMULQ: 0,
    DRRENRES: 0, CRRENRES: 0, NTRENRES: 0, NTRENRSQ: 0,
    DRRENROT: 0, CRRENROT: 0, NTRENROT: 0,
    ORE: 0, ORECONS: 0, OREMULT: 0, ORENRES: 0, ORERES: 0, OREAG: 0,
    P3RECONS: 0, P9RECONS: 0, NARECONS: 0,
    P3REMULT: 0, P9REMULT: 0, NAREMULT: 0,
    P3RENRES: 0, P9RENRES: 0, NARENRES: 0,
    P3RENROT: 0, P9RENROT: 0, NARENROT: 0,
    RSLNLTOT: 0, RSCONS: 0, RSMULT: 0, RSNRES: 0, RSCI: 0, RSLNREFM: 0, RSOTHER: 0,
    P3RSLNLT: 0, P9RSLNLT: 0, NARSLNLT: 0,
    LNSERV: 0,
    ...overrides,
  }
}

const QUARTERS = ["20240630", "20240930", "20241231", "20250331", "20250630", "20250930", "20251231", "20260331", "20260630"]

/** Nine quiet quarters, with per-quarter overrides keyed by `YYYYMMDD`. */
function history(overrides: Record<string, Record<string, unknown>> = {}, cert = "1"): BehaviorHistory {
  return buildBehaviorHistory(
    cert,
    QUARTERS.map((q) => quietRow(q, overrides[q] ?? {}))
  )
}

const noneFired = (h: BehaviorHistory) => summarizeBank(h, "20260630")!.fired
const signalsOf = (h: BehaviorHistory) => signalResultsOf(summarizeBank(h, "20260630")!)

test("a quiet bank fires nothing, and every signal was judged", () => {
  const s = summarizeBank(history(), "20260630")!
  assert.deepEqual(s.fired, [])
  assert.deepEqual(s.unjudged, [])
  for (const k of SIGNAL_KEYS) assert.equal(signalResultsOf(s)[k].judged, true, k)
  assert.equal(s.actionCount, 0)
  assert.equal(s.pressureCount, 0)
  assert.equal(s.current, true)
  assert.equal(s.creLoans, 300_000)
})

test("roll-forward: residual is prior + proxy inflow − current − charge-offs − OREO increase", () => {
  // Q1 2026: nonaccrual 10,000 with 2,000 90+ past due. Q2: nonaccrual 3,000,
  // the quarter's gross nonfarm charge-offs 1,500 (YTD 1,500 vs 0), OREO up 500.
  const h = history({
    "20260331": { NARENRES: 10_000, NARENROT: 10_000, P9RENRES: 2_000, P9RENROT: 2_000 },
    "20260630": { NARENRES: 3_000, NARENROT: 3_000, DRRENRES: 1_500, DRRENROT: 1_500, NTRENRES: 1_500, NTRENROT: 1_500, NTRENRSQ: 1_500, ORENRES: 500, ORE: 500 },
  })
  const steps = rollForward(h, "cre")
  const last = steps[steps.length - 1]
  assert.equal(last.quarter, "20260630")
  assert.equal(last.priorNonaccrual, 10_000)
  assert.equal(last.newNonaccrualProxy, 2_000)
  assert.equal(last.currentNonaccrual, 3_000)
  assert.equal(last.chargeOffs, 1_500)
  assert.equal(last.oreoTransferProxy, 500)
  assert.equal(last.unexplainedExit, 10_000 + 2_000 - 3_000 - 1_500 - 500)
  assert.equal(last.unexplainedExitShareOfPrior, 0.7)
  assert.ok(Math.abs(last.unexplainedExitPctOfCre! - (7_000 / 300_000) * 100) < 1e-9)
  // the category view agrees with the total when only one category moves
  const nonfarm = rollForward(h, "nonfarmNonres")
  assert.equal(nonfarm[nonfarm.length - 1].unexplainedExit, 7_000)
  const construction = rollForward(h, "construction")
  assert.equal(construction[construction.length - 1].unexplainedExit, 0)
})

test("roll-forward: a missing input leaves the residual null rather than smaller", () => {
  const h = history({ "20260630": { ORENRES: null, ORE: null } })
  const last = rollForward(h, "cre").at(-1)!
  assert.equal(last.oreoTransferProxy, null)
  assert.equal(last.unexplainedExit, null)
})

test("unexplained exit fires on the roll-forward, not on a fall explained by charge-offs", () => {
  const fired = history({
    "20260331": { NARENRES: 10_000, NARENROT: 10_000 },
    "20260630": { NARENRES: 3_000, NARENROT: 3_000 },
  })
  assert.deepEqual(noneFired(fired), ["unexplainedExit"])

  // Same fall, but 7,000 was charged off: explained.
  const explained = history({
    "20260331": { NARENRES: 10_000, NARENROT: 10_000 },
    "20260630": { NARENRES: 3_000, NARENROT: 3_000, DRRENRES: 7_000, DRRENROT: 7_000, NTRENRES: 7_000, NTRENROT: 7_000, NTRENRSQ: 7_000 },
  })
  const s = signalsOf(explained)
  assert.equal(s.unexplainedExit.fired, false)
  // …though 7,000 ÷ 300,000 = 2.3% in a quarter is a charge-off spike
  assert.equal(s.chargeOffSpike.fired, true)
})

test("HFS transfer: needs a rise of 0.25% of loans and a new level for the bank", () => {
  // 0 → 10,000 on 600,000 loans = 1.67%: fires
  assert.deepEqual(noneFired(history({ "20260630": { LNLSSALE: 10_000 } })), ["hfsTransfer"])
  // 0 → 1,000 = 0.17%: too small
  assert.deepEqual(noneFired(history({ "20260630": { LNLSSALE: 1_000 } })), [])
  // a mortgage pipeline that always runs 40–60M and ticks up to 62M: not a new level
  const pipeline = history({
    "20250630": { LNLSSALE: 50_000 }, "20250930": { LNLSSALE: 60_000 }, "20251231": { LNLSSALE: 40_000 },
    "20260331": { LNLSSALE: 55_000 }, "20260630": { LNLSSALE: 62_000 },
  })
  assert.deepEqual(noneFired(pipeline), [])
  // the same pipeline bank jumping to 95M (≥ 1.5 × 60M): fires
  const jump = history({
    "20250630": { LNLSSALE: 50_000 }, "20250930": { LNLSSALE: 60_000 }, "20251231": { LNLSSALE: 40_000 },
    "20260331": { LNLSSALE: 55_000 }, "20260630": { LNLSSALE: 95_000 },
  })
  assert.deepEqual(noneFired(jump), ["hfsTransfer"])
})

test("realized sale: a loss always fires; a gain only when the bank does not sell routinely", () => {
  assert.deepEqual(noneFired(history({ "20260630": { NTGLLNQ: -2_607 } })), ["realizedSale"])
  assert.deepEqual(noneFired(history({ "20260630": { NTGLLNQ: 800 } })), ["realizedSale"])
  const routine = history({
    "20250630": { NTGLLNQ: 300 }, "20250930": { NTGLLNQ: 320 }, "20251231": { NTGLLNQ: 310 },
    "20260331": { NTGLLNQ: 290 }, "20260630": { NTGLLNQ: 800 },
  })
  assert.deepEqual(noneFired(routine), [])
  const routineLoss = history({
    "20250630": { NTGLLNQ: 300 }, "20250930": { NTGLLNQ: 320 }, "20251231": { NTGLLNQ: 310 },
    "20260331": { NTGLLNQ: 290 }, "20260630": { NTGLLNQ: -50 },
  })
  assert.deepEqual(noneFired(routineLoss), ["realizedSale"])
})

test("charge-off spike: absolute, or three times the bank's own average above the floor", () => {
  // 0.4% quarterly, no history of charge-offs → ≥ 3 × max(mean 0, 0.01): fires
  assert.deepEqual(noneFired(history({ "20260630": { NTRENRSQ: 1_200 } })), ["chargeOffSpike"])
  // 0.08%: below the floor
  assert.deepEqual(noneFired(history({ "20260630": { NTRENRSQ: 240 } })), [])
  // a bank that always runs 0.3% a quarter and does 0.4%: not a spike
  const steady = history(Object.fromEntries(QUARTERS.map((q) => [q, { NTRENRSQ: q === "20260630" ? 1_200 : 900 }])))
  assert.deepEqual(noneFired(steady), [])
})

test("foreclosure route: OREO up while nonaccrual down", () => {
  const h = history({
    "20260331": { NARENRES: 5_000, NARENROT: 5_000 },
    "20260630": { NARENRES: 2_000, NARENROT: 2_000, ORENRES: 3_000, ORE: 3_000 },
  })
  const s = signalsOf(h)
  assert.equal(s.foreclosureRoute.fired, true)
  // the OREO increase explains the fall in the roll-forward, so no unexplained exit
  assert.equal(s.unexplainedExit.fired, false)
  // OREO up with nonaccrual flat: not the foreclosure route
  assert.deepEqual(noneFired(history({ "20260630": { ORENRES: 3_000, ORE: 3_000 } })), [])
})

test("modification build: modifications up while past-dues flat or falling; a pressure signal", () => {
  const h = history({ "20260630": { RSNRES: 6_000, RSLNLTOT: 6_000 } })
  const s = summarizeBank(h, "20260630")!
  assert.equal(signalResultsOf(s).modificationBuild.fired, true)
  assert.equal(s.pressureCount, 1)
  assert.equal(s.actionCount, 0)
  // modifications up with past-dues rising too: losses being recognised, not deferred
  const rising = history({ "20260630": { RSNRES: 6_000, RSLNLTOT: 6_000, P3RENRES: 4_000, P3RENROT: 4_000 } })
  assert.deepEqual(noneFired(rising), [])
})

test("CRE runoff: down more than 2% in the quarter and 5% over four, after adding back charge-offs", () => {
  // a sustained shrink: 300 → 290 → 285 → 280 → 270 over the last four quarters
  const sustained = history({
    "20250930": { LNRENRES: 290_000, LNRENROT: 290_000 },
    "20251231": { LNRENRES: 285_000, LNRENROT: 285_000 },
    "20260331": { LNRENRES: 280_000, LNRENROT: 280_000 },
    "20260630": { LNRENRES: 270_000, LNRENROT: 270_000 },
  })
  assert.deepEqual(noneFired(sustained), ["creRunoff"])
  const m = measuresAt(sustained, 8)!
  assert.ok(Math.abs(m.creRunoffPct! - (-10_000 / 280_000) * 100) < 1e-9)
  assert.ok(Math.abs(m.creRunoff4qPct! - (-30_000 / 300_000) * 100) < 1e-9)
  // one lumpy payoff quarter on a flat book: not runoff
  assert.deepEqual(noneFired(history({ "20260630": { LNRENRES: 290_000, LNRENROT: 290_000 } })), [])
  // sustained, but the last quarter's fall was charged off: the charge-off fires, the runoff does not
  const chargedOff = history({
    "20250930": { LNRENRES: 290_000, LNRENROT: 290_000 },
    "20251231": { LNRENRES: 285_000, LNRENROT: 285_000 },
    "20260331": { LNRENRES: 280_000, LNRENROT: 280_000 },
    "20260630": { LNRENRES: 270_000, LNRENROT: 270_000, NTRENRSQ: 7_500 },
  })
  assert.deepEqual(noneFired(chargedOff), ["chargeOffSpike"])
})

test("measures are null, and signals unfired but marked unjudged, when inputs are missing", () => {
  const h = history({ "20260630": { LNLSSALE: null } })
  const m = measuresAt(h, h.quarters.length - 1)!
  assert.equal(m.hfsPct, null)
  assert.equal(m.hfsChangePct, null)
  const s = summarizeBank(h, "20260630")!
  assert.deepEqual(s.unjudged, ["hfsTransfer"])
  assert.equal(signalResultsOf(s).creRunoff.judged, true)
})

test("judgeSignals is pure in the measures: the same measures fire the same way regardless of cohort", () => {
  const h = history({ "20260630": { LNLSSALE: 10_000, NTGLLNQ: -500 } })
  const m = measuresAt(h, 8)!
  const a = judgeSignals(m)
  const b = judgeSignals({ ...m } as BehaviorMeasures)
  assert.deepEqual(a, b)
})

test("a bank with one quarter cannot be judged and is counted, not summarised", () => {
  const lone = buildBehaviorHistory("9", [quietRow("20260630")])
  assert.equal(summarizeBank(lone, "20260630"), null)
  const cohort = computeBehaviorSignals([lone, history()], "Florida", "20260630")
  assert.equal(cohort.unjudgedCount, 1)
  assert.equal(cohort.institutionCount, 1)
})

test("asset bands", () => {
  assert.equal(assetBandOf(null), "under100m")
  assert.equal(assetBandOf(99_999), "under100m")
  assert.equal(assetBandOf(100_000), "100m-250m")
  assert.equal(assetBandOf(400_000), "250m-500m")
  assert.equal(assetBandOf(999_999), "500m-1b")
  assert.equal(assetBandOf(1_000_000), "1b-3b")
  assert.equal(assetBandOf(5_000_000), "3b-10b")
  assert.equal(assetBandOf(50_000_000), "over10b")
  assert.equal(ASSET_BANDS.length, 7)
})

test("cohort: signals identical in a state and in the nation; only percentiles differ", () => {
  const flagged = history({ "20260630": { LNLSSALE: 10_000 } }, "100")
  const florida = [flagged, ...Array.from({ length: 12 }, (_, i) => history({}, `f${i}`))]
  const national = [...florida, ...Array.from({ length: 30 }, (_, i) => history({ "20260630": { LNLSSALE: 20_000 + i * 1_000 } }, `n${i}`))]
  const fl = computeBehaviorSignals(florida, "Florida", "20260630").summaries.find((s) => s.cert === "100")!
  const us = computeBehaviorSignals(national, "National", "20260630").summaries.find((s) => s.cert === "100")!
  assert.deepEqual(fl.fired, us.fired)
  assert.deepEqual(fl.unjudged, us.unjudged)
  // alone in Florida with a positive HFS change it is at the top; nationally thirty banks moved more
  assert.ok(fl.percentiles.hfsChangePct! > 90)
  assert.ok(us.percentiles.hfsChangePct! < 40)
})

test("percentiles are withheld below the minimum cohort and for stale filers", () => {
  const small = computeBehaviorSignals([history({}, "a"), history({}, "b")], "Florida", "20260630")
  assert.equal(small.summaries[0].percentiles.hfsChangePct, null)
  const stale = buildBehaviorHistory("s", QUARTERS.slice(0, 8).map((q) => quietRow(q)))
  const cohort = computeBehaviorSignals([stale, ...Array.from({ length: 12 }, (_, i) => history({}, `f${i}`))], "Florida", "20260630")
  const s = cohort.summaries.find((x) => x.cert === "s")!
  assert.equal(s.current, false)
  assert.equal(s.quarter, "20260331")
  assert.equal(s.percentiles.hfsChangePct, null)
  assert.equal(cohort.currentCount, 12)
  assert.equal(cohort.institutionCount, 13)
})

test("the thresholds the rules quote are the thresholds in force", () => {
  for (const spec of SIGNALS) assert.ok(spec.rule.length > 40, spec.key)
  assert.ok(SIGNALS.find((s) => s.key === "hfsTransfer")!.rule.includes(String(SIGNAL_THRESHOLDS.hfsRisePctOfLoans)))
  assert.ok(SIGNALS.find((s) => s.key === "creRunoff")!.rule.includes(String(Math.abs(SIGNAL_THRESHOLDS.runoffPct))))
})
