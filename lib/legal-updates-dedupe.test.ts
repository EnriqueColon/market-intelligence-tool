import assert from "node:assert/strict"
import { test } from "node:test"

import { dedupeByTitle, normalizeTitleForKey } from "./legal-updates-dedupe.ts"

const HVCRE = "Final Rule on Treatment of High Volatility Commercial Real Estate (HVCRE) Exposures"

/** The five cards a user was served on the Legal Landscape tab: one rule, once per issuer. */
const REPORTED_REGULATORY_PAYLOAD = [
  { title: HVCRE, source: "Federal Reserve, FDIC, OCC", url: "https://federalreserve.gov/hvcre" },
  { title: HVCRE, source: "FDIC", url: "https://fdic.gov/hvcre" },
  { title: HVCRE, source: "OCC", url: "https://occ.gov/hvcre" },
  { title: HVCRE, source: "Federal Reserve", url: "https://federalreserve.gov/hvcre" },
  { title: HVCRE, source: "FDIC, OCC", url: "https://fdic.gov/hvcre-2" },
]

test("collapses a joint rule restated once per issuing agency", () => {
  const out = dedupeByTitle(REPORTED_REGULATORY_PAYLOAD)
  assert.equal(out.length, 1)
  assert.equal(out[0].source, "Federal Reserve, FDIC, OCC", "keeps the first, richest attribution")
})

test("differing URLs do not keep duplicates alive", () => {
  const urls = new Set(REPORTED_REGULATORY_PAYLOAD.map((i) => i.url))
  assert.equal(urls.size, 4, "guards the premise: URL-keyed dedupe would have kept four")
  assert.equal(dedupeByTitle(REPORTED_REGULATORY_PAYLOAD).length, 1)
})

test("matches across casing, punctuation, entity and whitespace drift", () => {
  const out = dedupeByTitle([
    { title: HVCRE },
    { title: "Final Rule on Treatment of High Volatility Commercial Real Estate HVCRE Exposures" },
    { title: "  final rule on treatment of high volatility   commercial real estate (hvcre) exposures " },
    { title: "Final Rule on Treatment of High Volatility Commercial Real Estate &amp; (HVCRE) Exposures" },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].title, HVCRE, "the verbatim official title is the one kept")
})

test("decodes entities rather than letting them become words", () => {
  assert.equal(normalizeTitleForKey("Truth &amp; Lending"), normalizeTitleForKey("Truth & Lending"))
  assert.notEqual(normalizeTitleForKey("Truth &amp; Lending"), "truth amp lending")
})

test("keeps genuinely distinct developments", () => {
  const out = dedupeByTitle([
    { title: HVCRE },
    { title: "Interagency Guidance on Commercial Real Estate Loan Accommodations" },
    { title: "SB 1234 — Foreclosure Procedure Reform" },
  ])
  assert.equal(out.length, 3)
})

test("drops items whose title normalizes to nothing", () => {
  assert.deepEqual(dedupeByTitle([{ title: "" }, { title: "   " }, { title: "***" }]), [])
})

test("collapses one development surfacing in two sections", () => {
  const out = dedupeByTitle([
    { title: "Bank X Consent Order", section: "regulatory" },
    { title: "Bank X Consent Order", section: "enforcement" },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].section, "regulatory", "section order decides the winner")
})

test("normalizeTitleForKey is stable under repeated application", () => {
  const once = normalizeTitleForKey(HVCRE)
  assert.equal(normalizeTitleForKey(once), once)
})
