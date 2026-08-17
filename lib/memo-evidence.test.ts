import { test } from "node:test"
import assert from "node:assert/strict"
import {
  containsStatistic,
  hasDeniedSource,
  hasTrustedAttribution,
  isTrustedDomain,
  sanitizeMemoEvidence,
  SEARCH_ALLOWED_DOMAINS,
  TRUSTED_PUBLISHER_DOMAINS,
} from "./memo-evidence.ts"

test("dates and bare years are not statistics", () => {
  assert.equal(containsStatistic("Distress is expected to build through Q1 2026."), false)
  assert.equal(containsStatistic("The 2025-2026 maturity cycle remains the key risk."), false)
  assert.equal(containsStatistic("Reported in July 2026 by market participants."), false)
  assert.equal(containsStatistic("Office fundamentals remain weak."), false)
  assert.equal(containsStatistic("Watch the 10-year Treasury."), false)
})

test("quantitative claims are detected", () => {
  assert.equal(containsStatistic("CMBS delinquency reached 6.1%."), true)
  assert.equal(containsStatistic("Up 6 basis points from April."), true)
  assert.equal(containsStatistic("$930 billion of CRE debt matures."), true)
  assert.equal(containsStatistic("Averaging 180-220 per week."), true)
  assert.equal(containsStatistic("Roughly 1,200 notes traded."), true)
  assert.equal(containsStatistic("Some 45 filings were recorded."), true)
})

test("trusted attribution recognizes domains and names", () => {
  assert.equal(isTrustedDomain("www.trepp.com"), true)
  assert.equal(isTrustedDomain("data.spglobal.com"), true)
  assert.equal(isTrustedDomain("miamidade.gov"), true)
  assert.equal(isTrustedDomain("real-estate-tycoon.org"), false)
  assert.equal(isTrustedDomain("homeinc.com"), false)

  assert.equal(hasTrustedAttribution("Delinquency hit 6.1% (Trepp, July 2026)."), true)
  assert.equal(hasTrustedAttribution("Distress rate 10.91% (credaily.com)"), true)
  assert.equal(hasTrustedAttribution("Filings rose 43% (real-estate-tycoon.org)"), false)
  assert.equal(hasTrustedAttribution("Filings rose 43% last year."), false)
})

test("publisher names must match on a word boundary", () => {
  assert.equal(hasTrustedAttribution("Columbia University study put it at 4%."), false)
})

test("plural and possessive publisher names still count", () => {
  assert.equal(
    hasTrustedAttribution("A $2 million foreclosure was filed (The Business Journals, February 2026)."),
    true
  )
  assert.equal(hasTrustedAttribution("Per Reuters' tally, 12 loans transferred."), true)
  assert.equal(hasTrustedAttribution("Filings rose 18% (Marcus Bell AI, April 2026)."), false)
})

test("typographic hyphens and non-breaking spaces do not defeat matching", () => {
  // The live model writes these constantly ("Miami‑Dade", "CRED iQ").
  assert.equal(hasTrustedAttribution("Filings fell (Miami\u2011Dade Clerk, 2026)."), true)
  assert.equal(hasTrustedAttribution("Distress rate 10.9% (CRED\u00a0iQ, August 2026)."), true)
  assert.equal(hasDeniedSource("Filings rose 18% (Marcus\u00a0Bell\u00a0AI, April 2026)."), true)
  assert.equal(hasDeniedSource("See real\u2011estate\u2011tycoon.org for detail."), true)
})

test("the fabricated lis pendens bullet is removed, sourced bullets survive", () => {
  const memo = [
    "Executive Summary",
    "- Distress is broadening across office and retail.",
    "- Miami-Dade County has seen new lis pendens filings averaging 180-220 per week through Q1 2026. (real-estate-tycoon.org)",
    "- CMBS delinquency rose to 6.1% in May 2026. (spglobal.com)",
    "",
    "Miami-specific CRE and distressed-debt outlook",
    "- Foreclosure filings increased 43% year-over-year. (homeinc.com)",
    "- The office sector in Miami faces significant distress. (credaily.com)",
    "",
    "Key sources (for further reading)",
    "- South Florida Foreclosure Trends — https://real-estate-tycoon.org/blog/foreclosure-trends-2026",
  ].join("\n")

  const { text, dropped, denied } = sanitizeMemoEvidence(memo)

  // The farm is denied outright; the merely unrecognized publisher is dropped
  // for carrying a figure.
  assert.equal(denied.length, 1)
  assert.match(denied[0], /180-220/)
  assert.equal(dropped.length, 1)
  assert.match(dropped[0], /increased 43%/)
  assert.doesNotMatch(text, /180-220/)
  assert.doesNotMatch(text, /increased 43%/)
  assert.match(text, /Distress is broadening/)
  assert.match(text, /6\.1% in May 2026/)
  assert.match(text, /office sector in Miami/)
  // Even the reading list: a denied source is never worth a click.
  assert.doesNotMatch(text, /real-estate-tycoon/)
})

test("a denied domain or byline outranks any allowlist or .gov match", () => {
  assert.equal(isTrustedDomain("real-estate-tycoon.org"), false)
  assert.equal(isTrustedDomain("blog.real-estate-tycoon.org"), false)
  assert.equal(isTrustedDomain("dealcharts.org"), false)
  assert.equal(hasDeniedSource("Filings rose (real-estate-tycoon.org)"), true)
  assert.equal(hasDeniedSource("Reported by Marcus Bell AI in April 2026."), true)
  assert.equal(hasDeniedSource("Reported by Marcus & Millichap in April 2026."), false)
  assert.equal(hasDeniedSource("Distress is broadening (credaily.com)"), false)
})

test("an unrecognized credit on a qualitative bullet is stripped, the analysis kept", () => {
  const memo = [
    "Executive Summary",
    "- Lenders are extending rather than foreclosing, which keeps realized losses below headline distress. (homeinc.com)",
    "- South Florida condo deconversions are accelerating, according to Sunshine Realty Blog.",
    "- Office distress is broadening into suburban product, according to Trepp.",
  ].join("\n")

  const { text, dropped, strippedAttributions, unrecognizedDomains } = sanitizeMemoEvidence(memo)

  assert.equal(dropped.length, 0)
  assert.match(text, /Lenders are extending rather than foreclosing/)
  assert.doesNotMatch(text, /homeinc/)
  // Terminal punctuation survives the removal of a trailing attribution clause.
  assert.match(text, /- South Florida condo deconversions are accelerating\.$/m)
  assert.doesNotMatch(text, /Sunshine Realty Blog/)
  // A recognized publisher is left in place.
  assert.match(text, /according to Trepp/)
  assert.equal(strippedAttributions.length, 2)
  assert.deepEqual(unrecognizedDomains, ["homeinc.com"])
})

test("an ordinary parenthetical is not mistaken for a citation", () => {
  const memo = [
    "U.S. commercial real estate outlook (CRE debt & distress)",
    "- The maturity wall (office and retail in particular) still governs the workout pipeline.",
    "- Non-performing loan (NPL) pricing has not reset to replacement-cost logic.",
  ].join("\n")

  const { text, dropped, strippedAttributions } = sanitizeMemoEvidence(memo)
  assert.equal(dropped.length, 0)
  assert.equal(strippedAttributions.length, 0)
  assert.match(text, /\(office and retail in particular\)/)
  assert.match(text, /\(NPL\)/)
})

test("a bullet left saying nothing once its credit is gone is dropped", () => {
  const memo = [
    "Executive Summary",
    "- Cap rates widened. (Some Real Estate Blog, 2026)",
    "- Buyers should underwrite to today's basis rather than 2021 exit assumptions.",
  ].join("\n")

  const { text, dropped } = sanitizeMemoEvidence(memo)
  assert.equal(dropped.length, 1)
  assert.doesNotMatch(text, /Cap rates widened/)
  assert.match(text, /underwrite to today's basis/)
})

test("an unrecognized bare URL in prose is stripped, a trusted one is left", () => {
  const memo = [
    "Executive Summary",
    "- Servicer commentary points to more extensions than liquidations this cycle, see https://somefarm.example/blog/x for a rundown.",
    "- Delinquency detail is broken out by property type at https://www.trepp.com/trepptalk.",
  ].join("\n")

  const { text, unrecognizedDomains } = sanitizeMemoEvidence(memo)
  assert.doesNotMatch(text, /somefarm\.example/)
  assert.match(text, /more extensions than liquidations/)
  assert.match(text, /trepp\.com\/trepptalk/)
  assert.deepEqual(unrecognizedDomains, ["somefarm.example"])
})

test("the search allowlist is a superset of the citable domains", () => {
  for (const domain of TRUSTED_PUBLISHER_DOMAINS) {
    assert.ok(SEARCH_ALLOWED_DOMAINS.includes(domain), `${domain} missing from search allowlist`)
  }
  // Search filtering cannot express the .gov rule, so key hosts are named.
  assert.ok(SEARCH_ALLOWED_DOMAINS.includes("federalreserve.gov"))
  assert.equal(new Set(SEARCH_ALLOWED_DOMAINS).size, SEARCH_ALLOWED_DOMAINS.length)
  for (const domain of SEARCH_ALLOWED_DOMAINS) {
    assert.equal(isTrustedDomain(domain), true, `${domain} is searchable but not citable`)
  }
})

test("a section emptied by the filter gets an explicit note rather than vanishing", () => {
  const memo = [
    "Executive Summary",
    "- Filings averaged 180-220 per week.",
    "",
    "How this shapes distressed-debt investing",
    "- Underwrite to today's basis.",
  ].join("\n")

  const { text } = sanitizeMemoEvidence(memo)
  assert.match(text, /No independently sourced figures/)
  assert.match(text, /Underwrite to today's basis/)
})

test("repeated points are collapsed to one bullet", () => {
  const memo = [
    "U.S. commercial real estate outlook (CRE debt & distress)",
    "- The CMBS distress rate reached 10.91% in July 2026, driven by office sector weakness. (credaily.com)",
    "- The CMBS distress rate climbed to 10.91% in July 2026, led by office weakness. (credaily.com)",
    "- Office properties carry the highest delinquency rate at 9.7%. (spglobal.com)",
  ].join("\n")

  const { text, duplicates } = sanitizeMemoEvidence(memo)
  assert.equal(duplicates.length, 1)
  assert.equal(text.split("\n").filter((l) => l.includes("10.91%")).length, 1)
  assert.match(text, /9\.7%/)
})

test("untrusted source links are dropped only when trusted ones remain", () => {
  const withEnoughTrusted = [
    "Key sources (for further reading)",
    "- A — https://www.credaily.com/a",
    "- B — https://www.spglobal.com/b",
    "- C — https://www.bizjournals.com/c",
    "- D — https://homeinc.com/blog/d",
  ].join("\n")
  const filtered = sanitizeMemoEvidence(withEnoughTrusted).text
  assert.doesNotMatch(filtered, /homeinc/)
  assert.match(filtered, /credaily/)

  const tooFewTrusted = [
    "Key sources (for further reading)",
    "- A — https://www.credaily.com/a",
    "- D — https://homeinc.com/blog/d",
  ].join("\n")
  // Stripping here would leave the memo with almost nothing to verify against.
  assert.match(sanitizeMemoEvidence(tooFewTrusted).text, /homeinc/)

  // A denied source goes even when that leaves the reading list thin.
  const denied = [
    "Key sources (for further reading)",
    "- A — https://www.credaily.com/a",
    "- D — https://real-estate-tycoon.org/blog/d",
  ].join("\n")
  const result = sanitizeMemoEvidence(denied)
  assert.doesNotMatch(result.text, /real-estate-tycoon/)
  assert.match(result.text, /credaily/)
  assert.ok(result.unrecognizedDomains.includes("real-estate-tycoon.org"))
})

test("qualitative memos pass through unchanged", () => {
  const memo = [
    "Executive Summary",
    "- Distress is broadening beyond office.",
    "- Lenders are extending rather than foreclosing.",
    "",
    "Key sources (for further reading)",
    "- CRE Daily — https://www.credaily.com/briefs/example/",
  ].join("\n")

  const { text, dropped } = sanitizeMemoEvidence(memo)
  assert.equal(dropped.length, 0)
  assert.equal(text, memo)
})
