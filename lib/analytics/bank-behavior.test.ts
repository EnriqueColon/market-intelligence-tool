import test from "node:test"
import assert from "node:assert/strict"
import { FDIC_FIELDS } from "@/lib/fdic-config"
import {
  BEHAVIOR_FIELD_CATALOG,
  BEHAVIOR_QUARTERS,
  BEHAVIOR_SOURCE_FIELDS,
  buildBehaviorHistory,
  groupBehaviorHistories,
  previousQuarterEnd,
  quarterEnds,
  toBehaviorQuarter,
  withQuarterlyFlows,
  type BehaviorQuarter,
} from "./bank-behavior"

/** BCB Community Bank, 2026-06-30, as BankFind returned it (thousands). */
const BCB_Q2_2026: Record<string, unknown> = {
  CERT: 35541,
  NAME: "BCB COMMUNITY BANK",
  REPDTE: "20260630",
  STNAME: "NEW JERSEY",
  ASSET: 3117295,
  LNLSGR: 2643742,
  LNLSSALE: 10777,
  NALNSALE: 0,
  P3LNSALE: 0,
  P9LNSALE: 0,
  NETGNSLN: -2600,
  NTGLLNQ: -2607,
  DRRECONS: 0, CRRECONS: 0, NTRECONS: 0, NTRECONQ: 0,
  DRREMULT: 717, CRREMULT: 0, NTREMULT: 717, NTREMULQ: 76,
  DRRENRES: 1982, CRRENRES: 390, NTRENRES: 1592, NTRENRSQ: -361,
  DRRENROT: 1965, CRRENROT: 388, NTRENROT: 1577,
  ORE: 5000, ORECONS: 0, OREMULT: 0, ORENRES: 5000, ORERES: 0, OREAG: 0,
  P3RECONS: 0, P9RECONS: 0, NARECONS: 14009,
  P3REMULT: 652, P9REMULT: 0, NAREMULT: 11945,
  P3RENRES: 36116, P9RENRES: 3363, NARENRES: 37573,
  P3RENROT: 33435, P9RENROT: 2488, NARENROT: 35144,
  RSLNLTOT: 1455, RSCONS: 0, RSMULT: 0, RSNRES: 0, RSCI: 961, RSLNREFM: 494, RSOTHER: 0,
  P3RSLNLT: 97, P9RSLNLT: 0, NARSLNLT: 969,
  LNSERV: 79295,
}

test("the config field list and the catalogue name the same BankFind fields", () => {
  const identity = new Set(["CERT", "NAME", "REPDTE", "STNAME"])
  const config = new Set(FDIC_FIELDS.behavior.filter((f) => !identity.has(f)))
  const catalog = new Set(BEHAVIOR_SOURCE_FIELDS)
  assert.deepEqual([...config].sort(), [...catalog].sort())
  for (const id of identity) assert.ok((FDIC_FIELDS.behavior as readonly string[]).includes(id), id)
})

test("every catalogue key is distinct and every derived entry has a formula", () => {
  const keys = BEHAVIOR_FIELD_CATALOG.map((s) => s.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const spec of BEHAVIOR_FIELD_CATALOG) {
    assert.ok(spec.source.length > 0, spec.key)
    if (spec.kind === "derived") assert.ok(!/^[A-Z0-9]+$/.test(spec.source), `${spec.key} should be a formula`)
    else assert.match(spec.source, /^[A-Z0-9]+$/, `${spec.key} should be one BankFind field`)
  }
})

test("a raw row maps field by field, with within-quarter derivations", () => {
  const q = toBehaviorQuarter(BCB_Q2_2026)
  assert.equal(q.quarter, "20260630")
  assert.equal(q.label, "Q2 2026")
  assert.equal(q.heldForSale, 10777)
  assert.equal(q.loanSaleGainQ, -2607)
  assert.equal(q.netChargeOffsNonfarmNonresQ, -361)
  // owner-occupied = nonfarm nonres less the non-owner half
  assert.equal(q.netChargeOffsNonfarmOwnerYtd, 1592 - 1577)
  assert.equal(q.nonaccrualNonfarmOwner, 37573 - 35144)
  assert.equal(q.oreoCre, 5000)
  assert.equal(q.nonaccrualCre, 14009 + 11945 + 37573)
  assert.equal(q.pastDue30Cre, 0 + 652 + 36116)
  assert.equal(q.pastDue90Cre, 0 + 0 + 3363)
  assert.equal(q.modificationsCre, 0)
  assert.equal(q.modificationsNonaccrual, 969)
  // quarterly gross flows need a prior quarter; a lone row leaves them null
  assert.equal(q.chargeOffsMultifamilyQ, null)
  assert.equal(q.chargeOffsCreQ, null)
})

test("missing fields are null, never zero, and null poisons a derived sum", () => {
  const q = toBehaviorQuarter({ REPDTE: "20260630", ORECONS: 10, OREMULT: 0 })
  assert.equal(q.oreoNonfarmNonres, null)
  assert.equal(q.oreoCre, null)
  assert.equal(q.heldForSale, null)
  assert.equal(toBehaviorQuarter({ REPDTE: "20260630", LNLSSALE: "" }).heldForSale, null)
  assert.equal(toBehaviorQuarter({ REPDTE: "20260630", LNLSSALE: "12" }).heldForSale, 12)
})

test("quarter arithmetic", () => {
  assert.equal(previousQuarterEnd("20260331"), "20251231")
  assert.equal(previousQuarterEnd("20260630"), "20260331")
  assert.equal(previousQuarterEnd("20260930"), "20260630")
  assert.equal(previousQuarterEnd("20261231"), "20260930")
  assert.deepEqual(quarterEnds("20260630", 3), ["20251231", "20260331", "20260630"])
  assert.deepEqual(quarterEnds("2026-06-30", 1), ["20260630"])
  assert.deepEqual(quarterEnds("garbage", 3), [])
  assert.equal(quarterEnds("20260630", BEHAVIOR_QUARTERS).length, 9)
})

function ytdRow(quarter: string, drMult: number, crMult: number): Record<string, unknown> {
  return { CERT: 1, REPDTE: quarter, DRREMULT: drMult, CRREMULT: crMult, DRRECONS: 0, CRRECONS: 0, DRRENRES: 0, CRRENRES: 0, DRRENROT: 0, CRRENROT: 0 }
}

test("year-to-date charge-offs difference into quarters, and reset at Q1", () => {
  const rows = [ytdRow("20251231", 100, 10), ytdRow("20260331", 30, 0), ytdRow("20260630", 75, 5), ytdRow("20260930", 75, 5)]
  const quarters = withQuarterlyFlows(rows.map(toBehaviorQuarter))
  const byQ = Object.fromEntries(quarters.map((q) => [q.quarter, q])) as Record<string, BehaviorQuarter>
  // Q4 2025 has no Q3 2025 in the history: null, not a guess
  assert.equal(byQ["20251231"].chargeOffsMultifamilyQ, null)
  // Q1 is its own YTD
  assert.equal(byQ["20260331"].chargeOffsMultifamilyQ, 30)
  assert.equal(byQ["20260331"].recoveriesMultifamilyQ, 0)
  // Q2 = YTD − Q1 YTD
  assert.equal(byQ["20260630"].chargeOffsMultifamilyQ, 45)
  assert.equal(byQ["20260630"].recoveriesMultifamilyQ, 5)
  // Q3 with no new activity
  assert.equal(byQ["20260930"].chargeOffsMultifamilyQ, 0)
  assert.equal(byQ["20260630"].chargeOffsCreQ, 45)
})

test("a gap in the history leaves the following quarter's flows null", () => {
  const rows = [ytdRow("20260331", 30, 0), ytdRow("20260930", 75, 5)]
  const quarters = withQuarterlyFlows(rows.map(toBehaviorQuarter))
  assert.equal(quarters[1].chargeOffsMultifamilyQ, null)
  assert.equal(quarters[1].chargeOffsCreQ, null)
})

test("a history dedupes, orders oldest first, keeps the newest nine and names from the newest row", () => {
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < 11; i++) {
    const year = 2024 + Math.floor(i / 4)
    const month = ["0331", "0630", "0930", "1231"][i % 4]
    rows.push({ CERT: 7, NAME: `BANK ${i}`, STNAME: "FLORIDA", REPDTE: `${year}${month}`, LNLSSALE: i })
  }
  rows.push({ ...rows[10] }) // duplicate newest
  rows.reverse()
  const h = buildBehaviorHistory("7", rows)
  assert.equal(h.quarters.length, 9)
  assert.equal(h.quarters[0].quarter, "20240930")
  assert.equal(h.quarters[8].quarter, "20260930")
  assert.equal(h.name, "BANK 10")
  assert.equal(h.state, "FLORIDA")
  assert.equal(h.quarters[8].heldForSale, 10)
})

test("rows for many institutions group by CERT", () => {
  const rows = [
    { CERT: 1, NAME: "A", REPDTE: "20260331" },
    { CERT: 2, NAME: "B", REPDTE: "20260331" },
    { CERT: 1, NAME: "A", REPDTE: "20260630" },
    { NAME: "no cert", REPDTE: "20260630" },
  ]
  const histories = groupBehaviorHistories(rows).sort((a, b) => a.cert.localeCompare(b.cert))
  assert.equal(histories.length, 2)
  assert.equal(histories[0].cert, "1")
  assert.equal(histories[0].quarters.length, 2)
  assert.equal(histories[1].quarters.length, 1)
})
