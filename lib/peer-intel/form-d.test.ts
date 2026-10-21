import { test } from "node:test"
import assert from "node:assert/strict"
import { buildRaise, isLikelyOpen, isNewLaunch, parseFormD, type OfferingRecord } from "./form-d"

/** Shaped like the real primary_doc.xml, including the nested dateOfFirstSale wrapper. */
function xml(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) =>
      k === "dateOfFirstSale"
        ? `<dateOfFirstSale><value>${v}</value></dateOfFirstSale>`
        : `<${k}>${v}</${k}>`
    )
    .join("\n")
  return `<?xml version="1.0"?><edgarSubmission>${body}</edgarSubmission>`
}

const ctx = { cik: "0002017189", accession: "0002017189-26-000007", formType: "D/A", filedAt: "2026-07-23" }

test("parses the offering figures from a Form D", () => {
  const r = parseFormD(
    xml({
      entityName: "Safe Harbor Equity Distressed Debt Fund 4, L.P.",
      totalOfferingAmount: "300000000",
      totalAmountSold: "64168863",
      totalRemaining: "235831137",
      totalNumberAlreadyInvested: "40",
      minimumInvestmentAccepted: "100000",
      dateOfFirstSale: "2024-03-15",
      industryGroupType: "Pooled Investment Fund",
      investmentFundType: "Other Investment Fund",
    }),
    ctx
  )
  assert.equal(r.entityName, "Safe Harbor Equity Distressed Debt Fund 4, L.P.")
  assert.equal(r.cik, "2017189", "CIK is stored unpadded")
  assert.equal(r.offeringAmount, 300_000_000)
  assert.equal(r.totalSold, 64_168_863)
  assert.equal(r.investorCount, 40)
  assert.equal(r.minimumInvestment, 100_000)
  assert.equal(r.dateOfFirstSale, "2024-03-15")
  assert.equal(r.fundType, "Other Investment Fund")
})

test('an "Indefinite" target is a real answer, not missing data', () => {
  const r = parseFormD(xml({ totalOfferingAmount: "Indefinite", totalRemaining: "Indefinite", totalAmountSold: "650000000" }), ctx)
  assert.equal(r.offeringAmount, "indefinite")
  assert.equal(r.remaining, "indefinite")
  assert.equal(r.totalSold, 650_000_000)
})

test("XML entities in fund names are decoded", () => {
  const r = parseFormD(xml({ entityName: "R &amp; R Capital Opportunity Fund LLC" }), ctx)
  assert.equal(r.entityName, "R & R Capital Opportunity Fund LLC")
  assert.equal(
    parseFormD(xml({ entityName: "SEGLO PRIVATE CREDIT &amp; OPPORTUNITY FUND LLC" }), ctx).entityName,
    "SEGLO PRIVATE CREDIT & OPPORTUNITY FUND LLC"
  )
  assert.equal(parseFormD(xml({ entityName: "Smith &#38; Co Fund" }), ctx).entityName, "Smith & Co Fund")
  assert.equal(parseFormD(xml({ entityName: "O&apos;Brien Credit LP" }), ctx).entityName, "O'Brien Credit LP")
})

test("absent fields are null, never zero", () => {
  const r = parseFormD(xml({ entityName: "Some Fund LP" }), ctx)
  assert.equal(r.offeringAmount, null)
  assert.equal(r.totalSold, null)
  assert.equal(r.investorCount, null, "a fund reporting no count is not a fund with no investors")
  assert.equal(r.dateOfFirstSale, null)
})

/** The control case: Safe Harbor Equity Distressed Debt Fund 4's real trail. */
function shcpFund4(): OfferingRecord[] {
  const base = { cik: "2017189", entityName: "Safe Harbor Equity Distressed Debt Fund 4, L.P.", location: "Miami Beach, FL", jurisdiction: "DE", remaining: null, dateOfFirstSale: "2024-03-15", industryGroup: "Pooled Investment Fund", fundType: "Other Investment Fund", minimumInvestment: 100_000 }
  return [
    { ...base, accession: "0002017189-24-000001", formType: "D", filedAt: "2024-03-28", offeringAmount: 500_000_000, totalSold: 0, investorCount: 0 },
    { ...base, accession: "0002017189-25-000002", formType: "D/A", filedAt: "2025-07-22", offeringAmount: 300_000_000, totalSold: 52_918_863, investorCount: 30 },
    { ...base, accession: "0002017189-26-000007", formType: "D/A", filedAt: "2026-07-23", offeringAmount: 300_000_000, totalSold: 64_168_863, investorCount: 40 },
  ]
}

test("reproduces the Safe Harbor Fund 4 trail exactly", () => {
  const r = buildRaise(shcpFund4(), "2026-10-21")
  assert.ok(r)
  assert.equal(r.cik, "2017189")
  assert.equal(r.target, 300_000_000)
  assert.equal(r.sold, 64_168_863)
  assert.equal(r.investorCount, 40)
  assert.equal(r.firstFiled, "2024-03-28")
  assert.equal(r.lastFiled, "2026-07-23")

  // 21.4% of a $300M target.
  assert.ok(r.progress != null)
  assert.equal(Math.round(r.progress * 1000) / 10, 21.4)

  // $1.60M average ticket.
  assert.ok(r.averageTicket != null)
  assert.equal(Math.round(r.averageTicket / 10_000) / 100, 1.6)

  // +$11.25M and +10 investors over the twelve months to July 2026.
  assert.equal(r.soldLastYear, 11_250_000)
  assert.equal(r.investorsLastYear, 10)

  // The target was cut from $500M to $300M.
  assert.equal(r.targetCut, true)
  assert.equal(r.targetHigh, 500_000_000)
})

test("filings are ordered oldest first regardless of input order", () => {
  const shuffled = [shcpFund4()[2], shcpFund4()[0], shcpFund4()[1]]
  const r = buildRaise(shuffled, "2026-10-21")
  assert.deepEqual(r?.filings.map((f) => f.filedAt), ["2024-03-28", "2025-07-22", "2026-07-23"])
})

test("progress is null against an indefinite target rather than a computed number", () => {
  const r = buildRaise(
    [{ ...shcpFund4()[2], offeringAmount: "indefinite" }],
    "2026-10-21"
  )
  assert.equal(r?.target, "indefinite")
  assert.equal(r?.progress, null)
  assert.equal(r?.sold, 64_168_863, "the amount sold is still reported")
  assert.equal(r?.targetCut, false, "an indefinite target was never cut")
})

test("a raise with one filing has no pace, and that is null not zero", () => {
  const r = buildRaise([shcpFund4()[0]], "2024-06-01")
  assert.equal(r?.soldLastYear, null)
  assert.equal(r?.investorsLastYear, null)
})

test("pace ignores a prior filing too recent to measure a year against", () => {
  const trail = [
    { ...shcpFund4()[1], filedAt: "2026-05-01", totalSold: 60_000_000, investorCount: 36 },
    shcpFund4()[2],
  ]
  const r = buildRaise(trail, "2026-10-21")
  assert.equal(r?.soldLastYear, null, "two filings three months apart cannot give a yearly pace")
})

test("staleness is counted in whole quarters since the last filing", () => {
  assert.equal(buildRaise(shcpFund4(), "2026-07-23")?.quartersSinceFiling, 0)
  assert.equal(buildRaise(shcpFund4(), "2026-10-21")?.quartersSinceFiling, 0)
  assert.equal(buildRaise(shcpFund4(), "2027-02-01")?.quartersSinceFiling, 2)
  assert.equal(buildRaise(shcpFund4(), "2027-08-01")?.quartersSinceFiling, 4)
})

test("a year of silence reads as closed, because the annual amendment is mandatory while open", () => {
  assert.equal(isLikelyOpen(buildRaise(shcpFund4(), "2026-10-21")!), true)
  assert.equal(isLikelyOpen(buildRaise(shcpFund4(), "2027-08-01")!), false)
})

test("a launch is dated from first sale, falling back to the first filing", () => {
  const r = buildRaise(shcpFund4(), "2026-10-21")!
  assert.equal(isNewLaunch(r, "2024-01-01"), true)
  assert.equal(isNewLaunch(r, "2025-01-01"), false, "first sale was March 2024")

  const noSale = buildRaise(shcpFund4().map((f) => ({ ...f, dateOfFirstSale: null })), "2026-10-21")!
  assert.equal(isNewLaunch(noSale, "2024-01-01"), true, "falls back to the 2024-03-28 first filing")
})

test("no filings yields no raise", () => {
  assert.equal(buildRaise([], "2026-10-21"), null)
  assert.equal(buildRaise([{ ...shcpFund4()[0], filedAt: "garbage" }], "2026-10-21"), null)
})
