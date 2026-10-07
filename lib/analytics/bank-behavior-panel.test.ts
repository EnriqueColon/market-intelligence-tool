import test from "node:test"
import assert from "node:assert/strict"
import { buildBehaviorHistory, type BehaviorHistory } from "./bank-behavior"
import { SIGNAL_KEYS } from "./bank-behavior-signals"
import { buildInstitutionBehavior, money, signalName, signalsByQuarter } from "./bank-behavior-panel"

/** Same quiet $1B bank as the signals tests: 600M loans, 300M non-owner nonfarm CRE. */
function quietRow(quarter: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CERT: 1, NAME: "QUIET BANK", STNAME: "FLORIDA", REPDTE: quarter,
    ASSET: 1_000_000, LNLSGR: 600_000,
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

function history(overrides: Record<string, Record<string, unknown>> = {}): BehaviorHistory {
  return buildBehaviorHistory("1", QUARTERS.map((q) => quietRow(q, overrides[q] ?? {})))
}

const LATEST = "20260630"

test("points carry the plotted balances and flows, oldest first, with HFS as a share of loans", () => {
  const b = buildInstitutionBehavior(history({ [LATEST]: { LNLSSALE: 6_000, ORENRES: 1_500, RSNRES: 900 } }), LATEST)
  assert.equal(b.points.length, 9)
  assert.equal(b.points[0].quarter, "20240630")
  const last = b.points[8]
  assert.equal(last.heldForSale, 6_000)
  assert.equal(last.heldForSalePctOfLoans, 1)
  assert.equal(last.oreoCre, 1_500)
  assert.equal(last.modificationsCre, 900)
  assert.equal(last.creLoans, 300_000)
})

test("the roll-forward has one step per quarter after the first, and the category breakdown names the latest step", () => {
  const b = buildInstitutionBehavior(history(), LATEST)
  assert.equal(b.rollForward.length, 8)
  assert.equal(b.rollForward[7].quarter, LATEST)
  assert.deepEqual(
    b.latestByCategory.map((c) => c.category),
    ["construction", "multifamily", "nonfarmNonres"]
  )
  assert.equal(b.latestByCategory[2].step?.quarter, LATEST)
})

test("signalsByQuarter judges each quarter on its own; a quiet bank fires nothing anywhere", () => {
  const rows = signalsByQuarter(history())
  assert.equal(rows.length, 8)
  for (const r of rows) assert.deepEqual(r.fired, [])
  // The first judged quarter has no quarter four back, so CRE runoff is the one signal that cannot be judged.
  assert.deepEqual(rows[0].unjudged, ["creRunoff"])
  assert.deepEqual(rows[7].unjudged, [])
})

test("a signal that fired two quarters ago shows in that quarter's strip and is named in the reading", () => {
  // HFS jump in Q4 2025 only.
  const h = history({ "20251231": { LNLSSALE: 6_000 }, "20260331": { LNLSSALE: 6_000 }, [LATEST]: { LNLSSALE: 6_000 } })
  const b = buildInstitutionBehavior(h, LATEST)
  const q4 = b.signalsByQuarter.find((q) => q.quarter === "20251231")!
  assert.ok(q4.fired.includes("hfsTransfer"))
  assert.deepEqual(b.latest?.fired, [])
  assert.match(b.reading.text, /No behaviour signal fired in Q2 2026/)
  assert.match(b.reading.text, /last quarter with a signal was Q4 2025 \(HFS transfer\)/)
})

test("the reading quotes the panel's own figures when signals fire", () => {
  const h = history({
    "20260331": { NTGLLNQ: 0 },
    [LATEST]: { LNLSSALE: 6_000, NTGLLNQ: -1_200, NETGNSLN: -1_200 },
  })
  const b = buildInstitutionBehavior(h, LATEST)
  assert.deepEqual(b.latest?.fired, ["hfsTransfer", "realizedSale"])
  assert.match(b.reading.text, /held-for-sale: the balance is \$6\.0M, 1\.00% of gross loans/)
  assert.match(b.reading.text, /loss of \$1\.2M on loan sales/)
  assert.match(b.reading.text, /discount trade/)
  assert.deepEqual(b.reading.signals, ["hfsTransfer", "realizedSale"])
})

test("the roll-forward paragraph explains a fall in nonaccrual by charge-offs and OREO, and names the residual", () => {
  // Prior quarter: 10,000 nonaccrual, 2,000 90+ PD. This quarter: 3,000 nonaccrual, 1,500 charged off, 500 to OREO → 7,000 unexplained.
  const h = history({
    "20260331": { NARENROT: 10_000, NARENRES: 10_000, P9RENROT: 2_000, P9RENRES: 2_000 },
    [LATEST]: { NARENROT: 3_000, NARENRES: 3_000, DRRENRES: 1_500, DRRENROT: 1_500, NTRENRES: 1_500, NTRENRSQ: 1_500, ORENRES: 500 },
  })
  const b = buildInstitutionBehavior(h, LATEST)
  const step = b.rollForward[7]
  assert.equal(step.unexplainedExit, 7_000)
  assert.match(b.reading.text, /CRE nonaccrual fell from \$10\.0M to \$3\.0M in Q2 2026/)
  assert.match(b.reading.text, /Allowing for \$1\.5M charged off, \$500K of OREO added, \$2\.0M of 90-day past-dues/)
  assert.match(b.reading.text, /\$7\.0M is unexplained/)
})

test("a sentence that has no 'allowing for' prefix starts with a capital", () => {
  const h = history({ "20260331": { NARENROT: 1_000, NARENRES: 1_000 }, [LATEST]: { NARENROT: 1_600, NARENRES: 1_600 } })
  const b = buildInstitutionBehavior(h, LATEST)
  assert.match(b.reading.text, /\. Nonaccruals grew by \$600K more than the prior past-dues predicted\./)
})

test("one quarter on file: no latest summary, no steps, and the reading says so", () => {
  const b = buildInstitutionBehavior(buildBehaviorHistory("1", [quietRow(LATEST)]), LATEST)
  assert.equal(b.latest, null)
  assert.equal(b.rollForward.length, 0)
  assert.equal(b.signalsByQuarter.length, 0)
  assert.match(b.reading.text, /Only one quarter/)
})

test("a missing input makes the quarter unjudged, not false, and the roll-forward paragraph says it cannot be completed", () => {
  const h = history({ [LATEST]: { NARENRES: null, NARENROT: null } })
  const b = buildInstitutionBehavior(h, LATEST)
  assert.ok(b.latest!.unjudged.includes("unexplainedExit"))
  assert.equal(b.rollForward[7].unexplainedExit, null)
  // Nonaccrual itself is null this quarter, so the paragraph has nothing to say about the move.
  assert.doesNotMatch(b.reading.text, /CRE nonaccrual (rose|fell)/)
})

test("money renders thousands with the right unit and a true minus sign", () => {
  assert.equal(money(10_777), "$10.8M")
  assert.equal(money(488), "$488K")
  assert.equal(money(-2_607), "−$2.6M")
  assert.equal(money(1_500_000), "$1.5B")
  assert.equal(money(0), "$0")
})

test("signalName keeps acronyms and lowers ordinary labels", () => {
  assert.equal(signalName("hfsTransfer"), "HFS transfer")
  assert.equal(signalName("realizedSale"), "realized sale")
  for (const k of SIGNAL_KEYS) assert.ok(signalName(k).length > 0)
})
