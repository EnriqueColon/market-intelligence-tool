import test from "node:test"
import assert from "node:assert/strict"
import {
  describeAcquisition,
  describeExit,
  formatMoney,
  kindForCode,
  tidyName,
  toFailureRecord,
  toIsoDate,
  toStructureEvent,
  toStructureEventFromStatus,
} from "./fdic-structure-events.ts"

// Captured from api.fdic.gov on 2026-10-06.
const WEST_GEORGIA_HISTORY = {
  CHANGECODE_DESC: "Failure - Whole Institution",
  CHANGECODE: 211,
  OUT_INSTNAME: "Community Bank and Trust - West Georgia",
  ACQ_CERT: 57931,
  EFFDATE: "2026-05-01T00:00:00",
  ACQ_INSTNAME: "Anchor Bank",
  OUT_CERT: 25796,
}
const GIFFORD_HISTORY = {
  CHANGECODE_DESC: "Merger -Without Assistance",
  CHANGECODE: 223,
  OUT_INSTNAME: "The Gifford State Bank",
  ACQ_CERT: 5768,
  EFFDATE: "2026-03-10T00:00:00",
  ACQ_INSTNAME: "The Fountain Trust Company",
  OUT_CERT: 10467,
  CERT: 10467,
}
const WEST_GEORGIA_FAILURE = {
  QBFDEP: 296420,
  BIDCITY: "PALM BEACH GARDENS",
  BIDSTATE: "FL",
  COST: 97284,
  QBFASSET: 305716,
  BIDNAME: "ANCHOR BANK",
  FAILDATE: "5/1/2026",
  CERT: 25796,
  RESTYPE: "FAILURE",
  COSTMOSTRECENTASOF: "2026-07-31",
  RESTYPE1: "PI",
  NAME: "COMMUNITY BANK AND TRUST - WEST GEORGIA",
}

test("both FDIC date shapes normalise to ISO", () => {
  assert.equal(toIsoDate("2026-05-01T00:00:00"), "2026-05-01")
  assert.equal(toIsoDate("5/1/2026"), "2026-05-01")
  assert.equal(toIsoDate("garbage"), "garbage")
  assert.equal(toIsoDate(undefined), "")
})

test("a failure seen from the failed bank's side carries the acquirer", () => {
  const e = toStructureEvent(WEST_GEORGIA_HISTORY, "25796")
  assert.equal(e?.kind, "failure")
  assert.equal(e?.cert, "25796")
  assert.equal(e?.date, "2026-05-01")
  assert.deepEqual(e?.acquirer, { cert: "57931", name: "Anchor Bank" })
})

test("the same row seen from the acquirer's side is an acquisition", () => {
  const e = toStructureEvent(WEST_GEORGIA_HISTORY, "57931")
  assert.equal(e?.kind, "acquisition")
  assert.equal(e?.cert, "57931")
  assert.deepEqual(e?.absorbed, { cert: "25796", name: "Community Bank and Trust - West Georgia" })
  assert.equal(describeAcquisition(e!), "Acquired Community Bank and Trust - West Georgia from the FDIC as receiver 1 May 2026.")
})

test("a merger without assistance names the surviving bank", () => {
  const e = toStructureEvent(GIFFORD_HISTORY, "10467")
  assert.equal(e?.kind, "merger")
  assert.equal(describeExit(e, null), "Merged into The Fountain Trust Company 10 Mar 2026.")
})

test("a failure record converts thousands to dollars and reads the resolution code", () => {
  const f = toFailureRecord(WEST_GEORGIA_FAILURE)
  assert.equal(f?.failDate, "2026-05-01")
  assert.equal(f?.depositsAtFailure, 296_420_000)
  assert.equal(f?.estimatedCost, 97_284_000)
  assert.equal(f?.transactionLabel, "purchase and assumption, insured deposits")
  assert.deepEqual(f?.acquirer, { name: "Anchor Bank", city: "Palm Beach Gardens", state: "FL" })
})

test("the exit sentence for a failure matches what a reader needs", () => {
  const f = toFailureRecord(WEST_GEORGIA_FAILURE)
  assert.equal(
    describeExit(null, f),
    "Failed 1 May 2026; purchase and assumption, insured deposits by Anchor Bank (Palm Beach Gardens, FL). " +
      "$296.4M deposits, $305.7M assets, estimated cost to the insurance fund $97.3M (32% of assets)."
  )
})

test("an inactive institution record stands in when /history has not caught up", () => {
  // Prime Meridian Bank, captured 2026-10-06: closed 30 Sep, no history row yet.
  const e = toStructureEventFromStatus({ CERT: 58694, NAME: "Prime Meridian Bank", ACTIVE: 0, ENDEFYMD: "09/30/2026", CHANGEC1: 240 })
  assert.equal(e?.kind, "closing")
  assert.equal(e?.date, "2026-09-30")
  assert.equal(
    describeExit(e, null),
    "Closed voluntarily 30 Sep 2026; the charter was surrendered rather than failed or merged (FDIC code 240)."
  )
  assert.equal(toStructureEventFromStatus({ CERT: 1, ACTIVE: 1 }), null)
  assert.equal(kindForCode(230, ""), "failure")
})

test("no record at all is said plainly rather than invented", () => {
  assert.match(describeExit(null, null), /^Stopped filing/)
})

test("upper-case FDIC names are tidied without flattening acronyms", () => {
  assert.equal(tidyName("COMMUNITY B&T WEST GEORGIA"), "Community B&T West Georgia")
  assert.equal(tidyName("Anchor Bank"), "Anchor Bank")
  assert.equal(tidyName("FIRST NATIONAL BANK OF GEORGIA"), "First National Bank of Georgia")
})

test("money formats at the scale a reader expects", () => {
  assert.equal(formatMoney(97_284_000), "$97.3M")
  assert.equal(formatMoney(1_250_000_000), "$1.3B")
  assert.equal(formatMoney(null), "—")
})
