/**
 * Did the Seller Likelihood score see the failures coming?
 *
 *   npm run backtest:seller
 *   npm run backtest:seller -- --quarters 8
 *
 * The peer signals in `lib/peer-intel/` cannot be backtested: there is no public
 * record of which managers were *right* to be raising. Bank failures are
 * different — the FDIC publishes them with dates — so the thresholds here can
 * be checked against outcomes rather than argued about.
 *
 * **What this is and is not.** Thirteen banks have failed since 2022, of which
 * three (Silicon Valley, Signature, First Republic) were deposit runs on
 * institutions far outside this cohort and tell us nothing about CRE selling
 * behaviour. FDIC serves filings for a limited window, so only the recent
 * failures have usable history. That leaves a handful of banks: this is a
 * directional check on whether the score was elevated before the end, not a
 * statistical validation, and it is reported as such.
 *
 * A failure is also a harsher test than the score is built for. Seller
 * Likelihood predicts *selling*, not failing — a bank can sell its way out and
 * survive, which is a success for the score and looks like a false positive
 * here. So a high score before a failure is confirmation; a low one is a
 * question, not a verdict.
 */

import { fetchFDICData } from "../lib/fdic-client"
import { FDIC_ENDPOINTS, FDIC_FIELDS } from "../lib/fdic-config"
import { FAILURE_FIELDS, toFailureRecord, type RawFailureRow } from "../lib/fdic-structure-events"
import { buildBehaviorHistory, previousQuarterEnd } from "../lib/analytics/bank-behavior"
import { judgeSignals, measuresAt, SIGNAL_KEYS } from "../lib/analytics/bank-behavior-signals"
import { assessSeller, STATE_LABELS, type SellerInput, type SellerLikelihood } from "../lib/analytics/seller-likelihood"

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** The quarter end on or before a date, as `YYYYMMDD`. */
function quarterEndFor(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  const q = Math.floor((m - 1) / 3)
  const ends = ["0331", "0630", "0930", "1231"]
  return q === 0 ? `${y - 1}1231` : `${y}${ends[q - 1]}`
}

async function main() {
  const lookback = Number(arg("quarters", "6"))
  console.log(`Seller Likelihood backtest — ${lookback} quarters before each failure\n`)

  const failuresRes = await fetchFDICData<RawFailureRow>(FDIC_ENDPOINTS.failures, {
    filters: { FAILDATE: "[2022-01-01 TO *]" },
    fields: FAILURE_FIELDS,
    limit: 200,
    sort_by: "FAILDATE",
    sort_order: "DESC",
  })
  if (failuresRes.error) {
    console.error("FDIC failures unavailable:", failuresRes.error)
    process.exitCode = 1
    return
  }

  const failures = (failuresRes.data ?? [])
    .map(toFailureRecord)
    .filter((f): f is NonNullable<typeof f> => f != null && /^\d{4}-\d{2}-\d{2}$/.test(f.failDate))
    .sort((a, b) => (a.failDate < b.failDate ? 1 : -1))

  console.log(`${failures.length} failures on record since 2022.\n`)

  const rows: Array<{
    name: string
    cert: string
    failDate: string
    assets: number | null
    quarters: Array<{ quarter: string; assessment: SellerLikelihood | null }>
  }> = []

  for (const failure of failures) {
    const lastQuarter = quarterEndFor(failure.failDate)
    const wanted: string[] = []
    let q = lastQuarter
    for (let i = 0; i < lookback; i++) {
      wanted.unshift(q)
      q = previousQuarterEnd(q)
    }

    // One request per failed bank, with an explicit range rather than the
    // production 27-month window — the point here is history, not freshness.
    const res = await fetchFDICData<Record<string, unknown>>(FDIC_ENDPOINTS.financials, {
      filters: { CERT: failure.cert, REPDTE: `[${wanted[0]} TO ${lastQuarter}]` },
      fields: FDIC_FIELDS.behavior,
      limit: 20,
      sort_by: "REPDTE",
      sort_order: "DESC",
    })
    if (res.error || !res.data?.length) {
      rows.push({ name: failure.name, cert: failure.cert, failDate: failure.failDate, assets: failure.assetsAtFailure, quarters: [] })
      continue
    }

    const history = buildBehaviorHistory(failure.cert, res.data)

    // Judged at each quarter against itself, with percentiles absent: a failed
    // bank has no cohort to be ranked within, so the score rests on the
    // absolute measures. That is the honest basis, and it is also the harder
    // one — a percentile would have flattered any bank in a stressed scope.
    const byQuarter = new Map<string, SellerInput>()
    history.quarters.forEach((q, i) => {
      const measures = measuresAt(history, i)
      if (!measures) return
      const results = judgeSignals(measures)
      byQuarter.set(q.quarter, {
        cert: failure.cert,
        quarter: q.quarter,
        measures,
        percentiles: {},
        fired: SIGNAL_KEYS.filter((k) => results[k].fired),
      })
    })

    const quarters = wanted.map((quarter) => {
      const input = byQuarter.get(quarter)
      // Prior-quarter action counts, so cleaned-up is distinguishable from stable.
      const priorActionCounts = wanted
        .slice(0, wanted.indexOf(quarter))
        .reverse()
        .map((q) => byQuarter.get(q)?.fired.length ?? 0)
      return { quarter, assessment: input ? assessSeller(input, { priorActionCounts }) : null }
    })
    rows.push({ name: failure.name, cert: failure.cert, failDate: failure.failDate, assets: failure.assetsAtFailure, quarters })
  }

  // — Report
  const withHistory = rows.filter((r) => r.quarters.some((q) => q.assessment))
  console.log(`${withHistory.length} of ${rows.length} have filings in the window FDIC still serves.\n`)

  const mark = (a: SellerLikelihood | null) => {
    if (!a) return "   ·  "
    const s = a.score == null ? " --" : String(a.score).padStart(3)
    const tag = a.state === "active-seller" ? "A" : a.state === "pre-seller" ? "P" : a.state === "cleaned-up" ? "c" : " "
    return `${s}${tag} `
  }

  console.log("  A = active seller, P = pre-seller, c = cleaned up, · = no filing; number is the score\n")
  for (const r of withHistory) {
    console.log(`  ${r.name.slice(0, 34).padEnd(34)} failed ${r.failDate}  ${r.assets ? `$${Math.round(r.assets / 1e6)}M` : ""}`)
    console.log(`    ${r.quarters.map((q) => q.quarter.slice(0, 6)).join("  ")}`)
    console.log(`    ${r.quarters.map((q) => mark(q.assessment)).join(" ")}`)
  }

  /**
   * The 2023 deposit runs. These failed on liability-side flight, not on CRE,
   * and nothing in a CRE-behaviour score should be expected to see them coming.
   * Counting them either way distorts the result, so they are reported apart.
   */
  const LIQUIDITY_RUNS = new Set(["24735", "57053", "59017"])

  // — Did it flag them at all?
  console.log("\n— Was the bank flagged before the end?")
  let flagged = 0
  for (const r of withHistory) {
    const hits = r.quarters.filter((q) => q.assessment && q.assessment.state !== "stable")
    const everFlagged = hits.length > 0
    if (everFlagged) flagged++
    const first = hits[0]
    console.log(
      `  ${everFlagged ? "yes" : "no "}  ${r.name.slice(0, 32).padEnd(32)} ${
        first ? `first flagged ${first.quarter} as ${STATE_LABELS[first.assessment!.state]}` : "never left stable"
      }`
    )
  }
  const creFailures = withHistory.filter((r) => !LIQUIDITY_RUNS.has(r.cert))
  const creFlagged = creFailures.filter((r) => r.quarters.some((q) => q.assessment && q.assessment.state !== "stable"))
  const runs = withHistory.filter((r) => LIQUIDITY_RUNS.has(r.cert))
  const runsFlagged = runs.filter((r) => r.quarters.some((q) => q.assessment && q.assessment.state !== "stable"))

  console.log(`\n  ${flagged} of ${withHistory.length} flagged overall, but that number is not the result:`)
  console.log(`    ${creFlagged.length} of ${creFailures.length} CRE-relevant failures flagged — the figure that matters.`)
  console.log(
    `    ${runsFlagged.length} of ${runs.length} deposit runs (SVB, Signature, First Republic) also flagged — ` +
      `these failed on liability-side flight, so flagging them is a false positive, not a win.`
  )

  // Is the state usable, or does it fire on everything?
  const quarterly = withHistory.flatMap((r) => r.quarters.map((q) => q.assessment).filter((a): a is SellerLikelihood => a != null))
  const active = quarterly.filter((a) => a.state === "active-seller").length
  const pre = quarterly.filter((a) => a.state === "pre-seller").length
  console.log(
    `\n  Across ${quarterly.length} bank-quarters: ${active} active-seller (${Math.round((active / quarterly.length) * 100)}%), ` +
      `${pre} pre-seller (${Math.round((pre / quarterly.length) * 100)}%).`
  )
  console.log(
    "  These are failed banks, so a high rate is expected here — the check against the whole cohort is " +
      "`verify:seller-likelihood`, where step 2 measured two-or-more action signals at 3.6% of banks."
  )

  console.log(
    "\nRead this as directional, not statistical. The sample is a handful of banks, and the score " +
      "predicts selling rather than failing — a bank that sold its way out and survived is a success " +
      "for the score and does not appear here at all."
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
