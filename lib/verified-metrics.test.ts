import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildFdicMetric,
  buildFredMetric,
  describeChange,
  describeLevelChange,
  describePointChange,
  describeRateChange,
  fdicQuarterLabel,
  formatUnitsFromThousands,
  formatUsdFromBillions,
  formatValue,
  formatVerifiedDataBlock,
  parseFredCsv,
  periodLabel,
  selectWindow,
  type FredSeriesSpec,
} from "./verified-metrics.ts"
import { containsStatistic, hasTrustedAttribution } from "./memo-evidence.ts"

const QUARTERLY: FredSeriesSpec = {
  id: "DRCRELEXFACBS",
  subject: "The delinquency rate on CRE loans at U.S. commercial banks",
  unit: "percent",
  frequency: "quarterly",
  publisher: "Federal Reserve Board",
}

test("FRED csv parses observations and skips missing periods", () => {
  const csv = [
    "observation_date,DGS10",
    "2026-08-12,4.61",
    "2026-08-13,.",
    "2026-08-14,4.68",
  ].join("\n")
  assert.deepEqual(parseFredCsv(csv), [
    { date: "2026-08-12", value: 4.61 },
    { date: "2026-08-14", value: 4.68 },
  ])
})

test("FRED csv ignores headers and malformed rows", () => {
  const csv = ["observation_date,X", "not-a-date,1.0", "2026-01-01,2.5", "", "2026-04-01,abc"].join("\n")
  assert.deepEqual(parseFredCsv(csv), [{ date: "2026-01-01", value: 2.5 }])
})

test("window selection finds the prior and year-ago observations", () => {
  const rows = [
    { date: "2025-01-01", value: 1.4 },
    { date: "2025-04-01", value: 1.45 },
    { date: "2025-07-01", value: 1.5 },
    { date: "2025-10-01", value: 1.58 },
    { date: "2026-01-01", value: 1.56 },
  ]
  const window = selectWindow(rows)
  assert.ok(window)
  assert.equal(window.latest.date, "2026-01-01")
  assert.equal(window.prior?.date, "2025-10-01")
  assert.equal(window.yearAgo?.date, "2025-01-01")
})

test("a series with no year of history reports no year-ago comparison", () => {
  const window = selectWindow([
    { date: "2026-01-01", value: 1.5 },
    { date: "2026-04-01", value: 1.6 },
  ])
  assert.ok(window)
  assert.equal(window.yearAgo, undefined)
})

test("period labels describe the period, not the timestamp", () => {
  // FRED dates a period by its first day; a naive Date would shift these a day.
  assert.equal(periodLabel("2026-01-01", "quarterly"), "Q1 2026")
  assert.equal(periodLabel("2026-10-01", "quarterly"), "Q4 2026")
  assert.equal(periodLabel("2026-07-01", "monthly"), "July 2026")
  assert.equal(periodLabel("2026-08-14", "daily"), "August 14, 2026")
  assert.equal(periodLabel("2026-08-13", "weekly"), "the week ended August 13, 2026")
})

test("rate moves are expressed in basis points, singular where it matters", () => {
  assert.equal(describeRateChange(1.56, 1.58), "down 2 bps")
  assert.equal(describeRateChange(0.17, 0.14), "up 3 bps")
  assert.equal(describeRateChange(1.56, 1.57), "down 1 bp")
  assert.equal(describeRateChange(1.5, 1.5), null)
})

test("level moves are expressed as percentages", () => {
  assert.equal(describeLevelChange(3120, 3000), "up 4.0%")
  assert.equal(describeLevelChange(3000, 3120), "down 3.8%")
  assert.equal(describeLevelChange(3000, 3000), null)
})

test("a survey share moves in percentage points, not basis points", () => {
  assert.equal(describePointChange(4.4, 0), "up 4.4 pp")
  assert.equal(describePointChange(-1.4, 4.4), "down 5.8 pp")
  assert.equal(describePointChange(4.4, 4.4), null)
})

test("each unit is described the way that unit is actually discussed", () => {
  // The lending-standards series is why net-percent exists. Both other
  // treatments misreport a move off zero: "up 440 bps" dresses a survey up as a
  // rate, and a proportional change divides by a base that is routinely zero.
  assert.equal(describeChange(4.4, 0, "net-percent"), "up 4.4 pp")
  assert.equal(describeChange(4.4, 0, "percent"), "up 440 bps")
  assert.equal(describeChange(4.4, 0, "usd-billions"), null)

  assert.equal(describeChange(1.86, 1.72, "percent"), "up 14 bps")
  assert.equal(describeChange(421, 402, "units-thousands"), "up 4.7%")
  assert.equal(describeChange(335.1, 334.2, "index"), "up 0.3%")
})

test("non-rate units print in the terms their source publishes", () => {
  assert.equal(formatValue(4.4, "net-percent"), "4.40%")
  assert.equal(formatValue(335.104, "index"), "335.1")
  // Census reports construction spending in millions; the tape reads in billions.
  assert.equal(formatValue(745339, "usd-millions"), "$745.3 billion")
  assert.equal(formatValue(3119.4696, "usd-billions"), "$3.12 trillion")
})

test("starts and permits read as units, scaling to millions at an annual rate", () => {
  assert.equal(formatUnitsFromThousands(421), "421k units")
  assert.equal(formatUnitsFromThousands(1433), "1.43M units")
  assert.equal(formatUnitsFromThousands(1000), "1.00M units")
})

test("large balances read in trillions", () => {
  assert.equal(formatUsdFromBillions(3120.0755), "$3.12 trillion")
  assert.equal(formatUsdFromBillions(812.4), "$812.4 billion")
})

test("a daily series reads 'on <date>' and names its sequential comparison", () => {
  const daily: FredSeriesSpec = {
    id: "DGS10",
    subject: "The 10-year Treasury yield",
    unit: "percent",
    frequency: "daily",
    publisher: "U.S. Treasury",
  }
  const sentence = buildFredMetric(daily, {
    latest: { date: "2026-08-14", value: 4.68 },
    prior: { date: "2026-08-13", value: 4.63 },
  }).sentence

  assert.match(sentence, /was 4\.68% on August 14, 2026/)
  assert.match(sentence, /up 5 bps from the prior session/)
})

test("a plural subject takes 'were'", () => {
  const level: FredSeriesSpec = {
    id: "CREACBM027NBOG",
    subject: "Commercial real estate loans outstanding at all U.S. commercial banks",
    unit: "usd-billions",
    frequency: "monthly",
    publisher: "Federal Reserve Board H.8",
    plural: true,
  }
  const sentence = buildFredMetric(level, {
    latest: { date: "2026-07-01", value: 3120.0755 },
    prior: { date: "2026-06-01", value: 3112.3664 },
  }).sentence

  assert.match(sentence, /banks were \$3\.12 trillion in July 2026/)
  assert.match(sentence, /from June 2026/)
})

test("a measured bullet is both a statistic and trustably attributed", () => {
  const metric = buildFredMetric(QUARTERLY, {
    latest: { date: "2026-01-01", value: 1.56 },
    prior: { date: "2025-10-01", value: 1.58 },
    yearAgo: { date: "2025-01-01", value: 1.4 },
  })

  assert.equal(metric.value, "1.56%")
  assert.equal(metric.asOf, "Q1 2026")
  assert.match(metric.sentence, /was 1\.56% in Q1 2026/)
  assert.match(metric.sentence, /down 2 bps from Q4 2025/)
  assert.match(metric.sentence, /up 16 bps year over year/)

  // The guard must keep this bullet: it states a figure, so it has to carry an
  // attribution the allowlist recognizes or it would be deleted as unsourced.
  assert.equal(containsStatistic(metric.sentence), true)
  assert.equal(hasTrustedAttribution(metric.sentence), true)
})

test("a metric with no prior observation still reads as a sentence", () => {
  const metric = buildFredMetric(QUARTERLY, { latest: { date: "2026-01-01", value: 1.56 } })
  assert.equal(metric.sentence.includes("undefined"), false)
  assert.equal(metric.sentence.includes("NaN"), false)
  assert.equal(hasTrustedAttribution(metric.sentence), true)
})

test("FDIC cohort figures survive the evidence guard", () => {
  const metric = buildFdicMetric({
    scope: "Florida",
    institutions: 87,
    creLoans: 92_400_000_000,
    creConcentration: 46.2,
    noncurrentRatio: 0.83,
    asOf: "Q1 2026",
  })

  assert.equal(metric.value, "$92.4 billion")
  assert.match(metric.sentence, /46\.2% of their total loans/)
  assert.match(metric.sentence, /0\.83% of gross loans across 87 reporting institutions/)
  assert.equal(containsStatistic(metric.sentence), true)
  assert.equal(hasTrustedAttribution(metric.sentence), true)
})

test("FDIC report dates map to their reporting quarter", () => {
  assert.equal(fdicQuarterLabel("20260331"), "Q1 2026")
  assert.equal(fdicQuarterLabel("20251231"), "Q4 2025")
  assert.equal(fdicQuarterLabel("garbage"), "garbage")
})

test("the prompt block is empty when nothing was measured", () => {
  assert.equal(formatVerifiedDataBlock([]), "")
})

test("the prompt block labels figures as measured rather than searched", () => {
  const block = formatVerifiedDataBlock([
    buildFredMetric(QUARTERLY, { latest: { date: "2026-01-01", value: 1.56 } }),
  ])
  assert.match(block, /VERIFIED MARKET DATA/)
  assert.match(block, /not from a search/)
  assert.match(block, /- The delinquency rate/)
})
