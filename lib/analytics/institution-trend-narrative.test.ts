import test from "node:test"
import assert from "node:assert/strict"
import {
  allowedFigures,
  buildNarrativeUserPrompt,
  checkNarrative,
  displayName,
  fallbackNarrative,
  formatScreenFlags,
  formatTrendTable,
} from "./institution-trend-narrative.ts"
import type { InstitutionTrend, TrendPoint } from "./institution-trend.ts"

function point(label: string, over: Partial<TrendPoint> = {}): TrendPoint {
  return {
    quarter: "20260331",
    label,
    noncurrentPct: 17.28,
    nplPct: 13.96,
    leveragePct: 0.16,
    cet1Pct: 0.19,
    totalRbcPct: 1.49,
    creToCapitalPct: 710.28,
    constructionToCapitalPct: 425.61,
    reservePct: 4.21,
    roaPct: -6.88,
    nimPct: 2.02,
    capital: { category: "critical", label: "Critically undercapitalised" },
    ...over,
  }
}

const trend: InstitutionTrend = {
  cert: "25796",
  name: "COMMUNITY B&T WEST GEORGIA",
  city: "BREMEN",
  state: "GEORGIA",
  leverageOnly: false,
  points: [
    point("Q4 2025", { noncurrentPct: 10.15, leveragePct: 6.7, creToCapitalPct: 117.17, roaPct: 1.73, capital: { category: "adequate", label: "Adequately capitalised" } }),
    point("Q1 2026"),
  ],
  verdict: { tone: "deteriorating", heading: "Deteriorating", text: "Capital category fell from adequately capitalised to critically undercapitalised." },
}

test("the table carries every plotted column and the capital category, oldest first", () => {
  const table = formatTrendTable(trend)
  const lines = table.split("\n")
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^quarter \| noncurrent\/loans %/)
  assert.match(lines[1], /^Q4 2025 \| 10\.15 .* Adequately capitalised$/)
  assert.match(lines[2], /^Q1 2026 \| 17\.28 .* 710\.3 .* -6\.88 .* Critically undercapitalised$/)
})

test("the user prompt names the bank, the table and the verdict, and flags CBLR only when it applies", () => {
  const prompt = buildNarrativeUserPrompt(trend)
  assert.match(prompt, /CERT 25796/)
  assert.match(prompt, /Automated verdict: Deteriorating/)
  assert.doesNotMatch(prompt, /Community Bank Leverage Ratio/)
  assert.match(buildNarrativeUserPrompt({ ...trend, leverageOnly: true }), /Community Bank Leverage Ratio/)
})

test("a reading that quotes only table figures, at any rounding, passes", () => {
  const text =
    "Problem loans sit at 17.3% and the Q1 2026 ROA of -6.88% took leverage to 0.16%. CRE to capital went from 117% to 710%: capital collapsed, so the same loans look huge against a tiny denominator. Allowance is 4.2% of loans."
  assert.deepEqual(checkNarrative(text, trend), { ok: true })
})

test("a reading with a figure that is not in the table is refused and names it", () => {
  const check = checkNarrative("Deposits of $296.4M left in May; leverage is 0.16%.", trend)
  assert.equal(check.ok, false)
  if (!check.ok) {
    assert.deepEqual(check.unsupported, ["296.4"])
    assert.match(check.reason, /296\.4/)
  }
})

test("quarter labels, years and small counts are not treated as invented figures", () => {
  assert.deepEqual(checkNarrative("Across Q4'25 and Q1 2026, three quarters of losses, in 2026; 8 quarters shown.", trend), { ok: true })
})

test("markdown and over-length replies are refused", () => {
  assert.equal(checkNarrative("- bullet one\n- bullet two", trend).ok, false)
  assert.equal(checkNarrative(Array(260).fill("word").join(" "), trend).ok, false)
})

test("allowed figures include the published screens and floor/ceiling roundings", () => {
  const allowed = allowedFigures(trend)
  for (const f of ["300", "100", "710", "710.3", "710.28", "0.2", "0.16", "17", "18", "2026", "26"]) assert.ok(allowed.has(f), f)
})

test("the fallback reading uses only the verdict and first-to-last moves", () => {
  const text = fallbackNarrative(trend)
  assert.match(text, /^Community B&T West Georgia \(Bremen, Georgia\) — deteriorating: Capital category fell/)
  assert.match(text, /Over Q4 2025–Q1 2026: noncurrent loans 10\.15% to 17\.28%; leverage 6\.70% to 0\.16%; CRE to capital 117% to 710%; ROA 1\.73% to -6\.88%\./)
  assert.deepEqual(checkNarrative(text, trend), { ok: true })
})

test("a round number that is not in the table is refused even when it ends in zeros", () => {
  const check = checkNarrative("Construction soared past 400% of capital.", trend)
  assert.equal(check.ok, false)
  if (!check.ok) assert.deepEqual(check.unsupported, ["400"])
})

test("screen flags are computed per quarter with the right direction, and names are title-cased", () => {
  const flags = formatScreenFlags(trend)
  assert.match(flags, /- noncurrent loans above 5%: every quarter/)
  assert.match(flags, /- CRE to capital above 300%: Q1 2026/)
  assert.match(flags, /- allowance below the 1% floor: no quarter/)
  assert.match(flags, /- leverage below 5% \(well capitalised\): Q1 2026/)
  assert.equal(displayName("COMMUNITY B&T WEST GEORGIA"), "Community B&T West Georgia")
  assert.match(buildNarrativeUserPrompt(trend), /Bank: Community B&T West Georgia, Bremen, Georgia \(FDIC CERT 25796\)/)
})

test("the prompt and fallback still work when the filing carries no location", () => {
  const bare = { ...trend, city: undefined, state: undefined }
  assert.match(buildNarrativeUserPrompt(bare), /Bank: Community B&T West Georgia \(FDIC CERT 25796\)/)
  assert.match(fallbackNarrative(bare), /^Community B&T West Georgia — deteriorating:/)
})
