import { test } from "node:test"
import assert from "node:assert/strict"
import {
  containsStatistic,
  hasTrustedAttribution,
  isTrustedDomain,
  sanitizeMemoEvidence,
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

  const { text, dropped } = sanitizeMemoEvidence(memo)

  assert.equal(dropped.length, 2)
  assert.match(dropped[0], /180-220/)
  assert.doesNotMatch(text, /180-220/)
  assert.doesNotMatch(text, /increased 43%/)
  assert.match(text, /Distress is broadening/)
  assert.match(text, /6\.1% in May 2026/)
  assert.match(text, /office sector in Miami/)
  // A link is not a claim: the source list is left intact.
  assert.match(text, /real-estate-tycoon\.org\/blog/)
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
    "- D — https://real-estate-tycoon.org/blog/d",
  ].join("\n")
  const filtered = sanitizeMemoEvidence(withEnoughTrusted).text
  assert.doesNotMatch(filtered, /real-estate-tycoon/)
  assert.match(filtered, /credaily/)

  const tooFewTrusted = [
    "Key sources (for further reading)",
    "- A — https://www.credaily.com/a",
    "- D — https://real-estate-tycoon.org/blog/d",
  ].join("\n")
  // Stripping here would leave the memo with almost nothing to verify against.
  assert.match(sanitizeMemoEvidence(tooFewTrusted).text, /real-estate-tycoon/)
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
