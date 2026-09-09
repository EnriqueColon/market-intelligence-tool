/**
 * Checks the Visual Analysis payload on two counts:
 *
 *  1. it fits under Next's 2MB data-cache entry ceiling, because the whole
 *     point of deriving the charts server-side is that the result can be
 *     cached — a payload over the line is silently refused and the 21.6s
 *     pagination runs again on every mount, which is the bug this replaced;
 *  2. rounding for transport has not moved a single plotted value.
 *
 *   npm run verify:visuals-payload
 *   SCOPE=Florida npm run verify:visuals-payload
 */
import { buildExportData } from "../app/actions/export-market-analytics-report"
import { computeEarningsRanges, computeEarningsScore } from "../lib/scoring/earnings-score"
import { computeVulnerabilityScore } from "../lib/scoring/vulnerability-score"
import { buildAnalyticsVisuals } from "../lib/analytics/visuals"
import {
  buildCapitalScatter,
  buildCreToCapitalRanking,
  buildExposureMix,
} from "../lib/analytics-chart-data"
import { getHistogramData } from "../lib/opportunity-score-dispersion"

const CEILING = 2 * 1024 * 1024
const mb = (n: number) => (n / 1048576).toFixed(2) + " MB"

async function main() {
  const scope = process.env.SCOPE ?? "National"

  const t0 = Date.now()
  const data = await buildExportData(scope)
  const fetchSeconds = ((Date.now() - t0) / 1000).toFixed(1)

  // What computeReportData adds, so the rows match what the panel charts.
  const earningsRanges = computeEarningsRanges(data.rows)
  const rows = data.rows.map((r) => {
    const earningsScore = computeEarningsScore(r, earningsRanges)
    return {
      ...r,
      earningsScore,
      vulnerabilityScore: computeVulnerabilityScore(r.opportunityScore, earningsScore),
    }
  })

  const visuals = buildAnalyticsVisuals(rows)
  const size = JSON.stringify(visuals).length
  const reportSize = JSON.stringify({ ...data, rows }).length

  console.log(`scope              : ${scope}`)
  console.log(`institutions       : ${rows.length}`)
  console.log(`FDIC pagination    : ${fetchSeconds}s  (paid once per cache window, not per mount)`)
  console.log(`old ReportData     : ${mb(reportSize)}  ${reportSize < CEILING ? "" : "-> over 2MB, never cached"}`)
  console.log(`new visuals payload: ${mb(size)}  ${size < CEILING ? `fits, headroom ${mb(CEILING - size)}` : "OVER"}`)
  console.log(`reduction          : ${(reportSize / size).toFixed(1)}x`)

  let failures = 0
  const fail = (msg: string) => {
    console.log(`  MISMATCH ${msg}`)
    failures++
  }

  if (size >= CEILING) {
    fail(`payload is ${mb(size)}, at or over the 2MB ceiling — Next will refuse the write`)
  }

  // Rounding happens inside buildAnalyticsVisuals. Compare against the same
  // builders run without it: every plotted value must survive to display
  // precision, and no chart may gain, lose or reorder an entry.
  const rawHistogram = getHistogramData(rows.map((r) => r.opportunityScore))
  const rawRanking = buildCreToCapitalRanking(rows)
  const rawMix = buildExposureMix(rows)
  const rawScatter = buildCapitalScatter(rows)

  const close = (a: number | undefined, b: number | undefined, label: string) => {
    if (a == null && b == null) return
    if (a == null || b == null) return fail(`${label}: ${a} vs ${b}`)
    // Displayed to at most one decimal place; 1e-3 is far tighter than that.
    if (Math.abs(a - b) > Math.max(1e-3, Math.abs(b) * 1e-5)) fail(`${label}: ${a} vs ${b}`)
  }

  if (visuals.histogram.length !== rawHistogram.length) fail("histogram bin count")
  visuals.histogram.forEach((bin, i) => {
    if (bin.bin !== rawHistogram[i].bin) fail(`histogram[${i}].bin`)
    if (bin.count !== rawHistogram[i].count) fail(`histogram[${i}].count`)
  })

  if (visuals.creToCapitalRanking.length !== rawRanking.length) fail("ranking length")
  visuals.creToCapitalRanking.forEach((bar, i) => {
    if (bar.name !== rawRanking[i].name) fail(`ranking[${i}] reordered: ${bar.name} vs ${rawRanking[i].name}`)
    if (bar.rank !== rawRanking[i].rank) fail(`ranking[${i}].rank`)
    close(bar.value, rawRanking[i].value, `ranking[${i}].value`)
  })

  if (visuals.exposureMix.length !== rawMix.length) fail("exposure mix length")
  visuals.exposureMix.forEach((bar, i) => {
    if (bar.name !== rawMix[i].name) fail(`mix[${i}] reordered`)
    close(bar.construction, rawMix[i].construction, `mix[${i}].construction`)
    close(bar.multifamily, rawMix[i].multifamily, `mix[${i}].multifamily`)
    close(bar.nonResidential, rawMix[i].nonResidential, `mix[${i}].nonResidential`)
  })

  if (visuals.scatter.points.length !== rawScatter.points.length) fail("scatter point count")
  close(visuals.scatter.medianCreToAssets, rawScatter.medianCreToAssets, "scatter.medianCreToAssets")
  close(visuals.scatter.medianCreToCap, rawScatter.medianCreToCap, "scatter.medianCreToCap")
  visuals.scatter.points.forEach((p, i) => {
    const raw = rawScatter.points[i]
    if (p.name !== raw.name) fail(`scatter[${i}] reordered`)
    close(p.creToAssets, raw.creToAssets, `scatter[${i}].creToAssets`)
    close(p.creToCap, raw.creToCap, `scatter[${i}].creToCap`)
    close(p.bubbleSize, raw.bubbleSize, `scatter[${i}].bubbleSize`)
    close(p.vulnerabilityScore, raw.vulnerabilityScore, `scatter[${i}].vulnerabilityScore`)
  })

  const compared =
    visuals.histogram.length * 2 +
    visuals.creToCapitalRanking.length * 3 +
    visuals.exposureMix.length * 4 +
    visuals.scatter.points.length * 5 +
    2
  console.log(`comparisons        : ~${compared.toLocaleString()}`)
  console.log(`scatter points     : ${visuals.scatter.points.length}`)

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} problem(s)`)
    process.exit(1)
  }
  console.log("\nPASS: payload fits the cache ceiling and every plotted value is unchanged")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
