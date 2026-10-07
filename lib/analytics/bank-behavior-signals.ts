import { percentileRank } from "@/lib/scoring/opportunity-score"
import type { BehaviorHistory, BehaviorQuarter } from "@/lib/analytics/bank-behavior"

/**
 * Behaviour signals and the nonaccrual roll-forward, computed per bank from
 * its nine-quarter history (`lib/analytics/bank-behavior.ts`).
 *
 * The spec's acceptance check decides the design: *Florida and national
 * scopes produce consistent states for the same bank's signals — scores may
 * differ by cohort, signals should not.* So every signal here fires on
 * absolute floors and the bank's own history, never on where the bank sits in
 * the cohort. Percentiles within the scope are still computed and attached,
 * as context for the reader and as inputs for the Seller Likelihood score,
 * which is cohort-relative by design; they just cannot change a flag.
 *
 * Thresholds are the spec's starting proposals, gathered in
 * `SIGNAL_THRESHOLDS` so the backtest can move them in one place. Every
 * measure is in percent of a balance the bank reports, and every input is a
 * `BehaviorQuarter` field whose provenance is in `BEHAVIOR_FIELD_CATALOG`; a
 * null input makes the measure null and the signal unfired, never zero.
 */

export type SignalKey =
  | "hfsTransfer"
  | "realizedSale"
  | "chargeOffSpike"
  | "unexplainedExit"
  | "foreclosureRoute"
  | "modificationBuild"
  | "creRunoff"

export type SignalSide = "action" | "pressure"

export type SignalSpec = {
  key: SignalKey
  label: string
  side: SignalSide
  /** What the spec says it means. */
  meaning: string
  /** The firing rule, in words, so the UI can show it. */
  rule: string
}

export const SIGNAL_THRESHOLDS = {
  /** HFS rise, quarter on quarter, as % of gross loans. */
  hfsRisePctOfLoans: 0.25,
  /** HFS must also reach this multiple of the bank's own prior-four-quarter high. */
  hfsNewLevelMultiple: 1.5,
  /** Quarterly CRE net charge-off rate that fires on its own (≈2% annualised). */
  ncoRateAbsolute: 0.5,
  /** Quarterly CRE net charge-off rate floor when firing against the bank's own average. */
  ncoRateFloor: 0.1,
  /** …and the multiple of its trailing average it must reach. */
  ncoOwnHistoryMultiple: 3,
  /** Unexplained exit as a share of the prior quarter's CRE nonaccrual. */
  exitShareOfPriorNonaccrual: 0.25,
  /** …and as % of CRE loans. */
  exitPctOfCre: 0.1,
  /** OREO rise, quarter on quarter, as % of CRE loans. */
  oreoRisePctOfCre: 0.05,
  /** Modifications rise, quarter on quarter, as % of CRE loans. */
  modificationRisePctOfCre: 0.1,
  /** Quarterly CRE balance change beyond charge-offs, % of prior balance (negative = runoff). */
  runoffPct: -2,
  /** …and over the trailing four quarters, so a lumpy payoff does not read as de-risking. */
  runoff4qPct: -5,
  /** Fewest banks with a value before a percentile is reported. */
  minCohort: 10,
} as const

export const SIGNALS: readonly SignalSpec[] = [
  {
    key: "hfsTransfer",
    label: "HFS transfer",
    side: "action",
    meaning: "Bank has decided to sell",
    rule: `Held-for-sale rose by at least ${SIGNAL_THRESHOLDS.hfsRisePctOfLoans}% of gross loans in the quarter and stands at least ${SIGNAL_THRESHOLDS.hfsNewLevelMultiple}× the bank's own high of the previous four quarters (so a bank that always runs a mortgage pipeline does not fire every quarter).`,
  },
  {
    key: "realizedSale",
    label: "Realized sale",
    side: "action",
    meaning: "A sale closed; a loss is a discount",
    rule: "Net gains or losses on loan sales were non-zero in the quarter, and either a loss, or the bank reported loan-sale gains in at most one of the previous four quarters (so routine mortgage sellers do not fire).",
  },
  {
    key: "chargeOffSpike",
    label: "CRE charge-off spike",
    side: "action",
    meaning: "Active write-down or clean-up",
    rule: `Quarterly CRE net charge-offs reached ${SIGNAL_THRESHOLDS.ncoRateAbsolute}% of CRE loans, or at least ${SIGNAL_THRESHOLDS.ncoRateFloor}% and ${SIGNAL_THRESHOLDS.ncoOwnHistoryMultiple}× the bank's own trailing average.`,
  },
  {
    key: "unexplainedExit",
    label: "Unexplained nonaccrual exit",
    side: "action",
    meaning: "Loans left the books another way: likely a note sale",
    rule: `CRE nonaccrual fell, and the roll-forward residual — prior nonaccrual plus prior 90+ past due, less current nonaccrual, charge-offs and the OREO increase — is at least ${SIGNAL_THRESHOLDS.exitShareOfPriorNonaccrual * 100}% of the prior nonaccrual and ${SIGNAL_THRESHOLDS.exitPctOfCre}% of CRE loans. Cures and payoffs land here too: a flag, not a dollar estimate.`,
  },
  {
    key: "foreclosureRoute",
    label: "Foreclosure route",
    side: "action",
    meaning: "REO sale candidates coming",
    rule: `CRE OREO rose by at least ${SIGNAL_THRESHOLDS.oreoRisePctOfCre}% of CRE loans while CRE nonaccrual fell.`,
  },
  {
    key: "modificationBuild",
    label: "Modification build",
    side: "pressure",
    meaning: "Extend-and-pretend; losses deferred, not resolved",
    rule: `CRE modifications to borrowers in financial difficulty rose by at least ${SIGNAL_THRESHOLDS.modificationRisePctOfCre}% of CRE loans while CRE past-dues (30–89 and 90+) were flat or falling.`,
  },
  {
    key: "creRunoff",
    label: "CRE runoff",
    side: "action",
    meaning: "Deliberate de-risking",
    rule: `CRE loans fell by more than ${Math.abs(SIGNAL_THRESHOLDS.runoffPct)}% in the quarter and more than ${Math.abs(SIGNAL_THRESHOLDS.runoff4qPct)}% over four quarters, both after adding back net charge-offs (a sustained shrink, not one payoff).`,
  },
]

export const SIGNAL_KEYS: readonly SignalKey[] = SIGNALS.map((s) => s.key)

// ─── Roll-forward ────────────────────────────────────────────────────────────

export type CreCategory = "construction" | "multifamily" | "nonfarmNonres" | "cre"

export const CRE_CATEGORY_LABEL: Record<CreCategory, string> = {
  construction: "Construction & land",
  multifamily: "Multifamily",
  nonfarmNonres: "Nonfarm nonresidential",
  cre: "All CRE",
}

type CategoryFields = {
  nonaccrual: keyof BehaviorQuarter
  pastDue90: keyof BehaviorQuarter
  chargeOffsQ: keyof BehaviorQuarter
  oreo: keyof BehaviorQuarter
}

const CATEGORY_FIELDS: Record<CreCategory, CategoryFields> = {
  construction: { nonaccrual: "nonaccrualConstruction", pastDue90: "pastDue90Construction", chargeOffsQ: "chargeOffsConstructionQ", oreo: "oreoConstruction" },
  multifamily: { nonaccrual: "nonaccrualMultifamily", pastDue90: "pastDue90Multifamily", chargeOffsQ: "chargeOffsMultifamilyQ", oreo: "oreoMultifamily" },
  nonfarmNonres: { nonaccrual: "nonaccrualNonfarmNonres", pastDue90: "pastDue90NonfarmNonres", chargeOffsQ: "chargeOffsNonfarmNonresQ", oreo: "oreoNonfarmNonres" },
  cre: { nonaccrual: "nonaccrualCre", pastDue90: "pastDue90Cre", chargeOffsQ: "chargeOffsCreQ", oreo: "oreoCre" },
}

/**
 * One quarter of the nonaccrual roll-forward for a category. All dollar
 * figures in thousands. `newNonaccrualProxy` and `oreoTransferProxy` are
 * approximations and are named as such: inflows are not reported, so the
 * prior quarter's 90+ past due stands in; transfers to OREO are not reported,
 * so the increase in the OREO balance stands in (an OREO sale in the same
 * quarter hides a transfer).
 */
export type RollForwardStep = {
  quarter: string
  label: string
  priorNonaccrual: number | null
  /** Derived: prior quarter's 90+ past due, as the proxy for new nonaccrual. */
  newNonaccrualProxy: number | null
  currentNonaccrual: number | null
  /** Derived: the quarter's gross charge-offs for the category (YTD differenced). */
  chargeOffs: number | null
  /** Derived: max(0, OREO now − OREO prior) for the category. */
  oreoTransferProxy: number | null
  /** Derived: (prior + proxy inflow) − current − charge-offs − OREO proxy. Null if any input is null. */
  unexplainedExit: number | null
  /** Derived: unexplainedExit ÷ CRE loans × 100. */
  unexplainedExitPctOfCre: number | null
  /** Derived: unexplainedExit ÷ priorNonaccrual. */
  unexplainedExitShareOfPrior: number | null
}

function pct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null
  return (numerator / denominator) * 100
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null
  return numerator / denominator
}

/** The roll-forward for one category over a history: one step per quarter from the second. */
export function rollForward(history: BehaviorHistory, category: CreCategory): RollForwardStep[] {
  const f = CATEGORY_FIELDS[category]
  const steps: RollForwardStep[] = []
  for (let i = 1; i < history.quarters.length; i++) {
    const prior = history.quarters[i - 1]
    const q = history.quarters[i]
    const priorNonaccrual = prior[f.nonaccrual] as number | null
    const newNonaccrualProxy = prior[f.pastDue90] as number | null
    const currentNonaccrual = q[f.nonaccrual] as number | null
    const chargeOffs = q[f.chargeOffsQ] as number | null
    const oreoNow = q[f.oreo] as number | null
    const oreoPrior = prior[f.oreo] as number | null
    const oreoTransferProxy = oreoNow === null || oreoPrior === null ? null : Math.max(0, oreoNow - oreoPrior)
    const complete =
      priorNonaccrual !== null && newNonaccrualProxy !== null && currentNonaccrual !== null && chargeOffs !== null && oreoTransferProxy !== null
    const unexplainedExit = complete
      ? priorNonaccrual! + newNonaccrualProxy! - currentNonaccrual! - chargeOffs! - oreoTransferProxy!
      : null
    steps.push({
      quarter: q.quarter,
      label: q.label,
      priorNonaccrual,
      newNonaccrualProxy,
      currentNonaccrual,
      chargeOffs,
      oreoTransferProxy,
      unexplainedExit,
      unexplainedExitPctOfCre: pct(unexplainedExit, q.creLoans),
      unexplainedExitShareOfPrior: ratio(unexplainedExit, priorNonaccrual),
    })
  }
  return steps
}

// ─── Measures ────────────────────────────────────────────────────────────────

/** Every figure the signals are judged on, for one quarter. Percent unless named otherwise. */
export type BehaviorMeasures = {
  /** Held for sale, thousands. */
  hfsBalance: number | null
  /** Held for sale ÷ gross loans. */
  hfsPct: number | null
  /** (HFS − prior HFS) ÷ gross loans. */
  hfsChangePct: number | null
  /** Highest HFS balance in the previous four quarters, thousands. */
  hfsTrailingMax: number | null
  /** Net gains (losses) on loan sales, the quarter, thousands. */
  loanSaleGainQ: number | null
  /** Previous four quarters in which loan-sale gains were non-zero. */
  priorQuartersWithSales: number | null
  /** Quarterly CRE net charge-offs ÷ CRE loans incl. owner-occupied nonfarm (the quarter nets are reported for the whole nonfarm line). */
  creNcoRateQ: number | null
  /** Mean of creNcoRateQ over the previous quarters in the history (at least three). */
  creNcoRateTrailingMean: number | null
  /** Roll-forward residual for all CRE, thousands. */
  unexplainedExit: number | null
  unexplainedExitPctOfCre: number | null
  unexplainedExitShareOfPrior: number | null
  /** CRE nonaccrual change, thousands. */
  nonaccrualCreChange: number | null
  /** CRE OREO ÷ CRE loans. */
  oreoCrePct: number | null
  /** (CRE OREO − prior) ÷ CRE loans. */
  oreoCreChangePct: number | null
  /** CRE modifications ÷ CRE loans. */
  modificationsCrePct: number | null
  /** (CRE modifications − prior) ÷ CRE loans. */
  modificationsCreChangePct: number | null
  /** CRE past due (30–89 + 90+) change, thousands. */
  pastDueCreChange: number | null
  /** (CRE loans − prior + quarterly CRE net charge-offs) ÷ prior CRE loans. Negative is runoff. */
  creRunoffPct: number | null
  /** Same over four quarters: (CRE loans − four quarters ago + the four quarters' net charge-offs) ÷ that balance. */
  creRunoff4qPct: number | null
}

function sumOrNull(...terms: (number | null)[]): number | null {
  let total = 0
  for (const t of terms) {
    if (t === null) return null
    total += t
  }
  return total
}

/** Quarterly CRE net charge-offs: the three reported quarter nets. */
export function netChargeOffsCreQ(q: BehaviorQuarter): number | null {
  return sumOrNull(q.netChargeOffsConstructionQ, q.netChargeOffsMultifamilyQ, q.netChargeOffsNonfarmNonresQ)
}

/** CRE including owner-occupied nonfarm: the denominator that matches the reported quarter nets. */
function creLoansBroad(q: BehaviorQuarter): number | null {
  return sumOrNull(q.constructionLoans, q.multifamilyLoans, q.nonfarmNonresLoans)
}

/** The measures at quarter index `i` of the history (needs `i ≥ 1`). */
export function measuresAt(history: BehaviorHistory, i: number): BehaviorMeasures | null {
  if (i < 1 || i >= history.quarters.length) return null
  const q = history.quarters[i]
  const p = history.quarters[i - 1]

  const trailing = history.quarters.slice(Math.max(0, i - 4), i)
  const hfsValues = trailing.map((t) => t.heldForSale).filter((v): v is number => v !== null)
  const salesValues = trailing.map((t) => t.loanSaleGainQ).filter((v): v is number => v !== null)

  const ncoHistory = history.quarters
    .slice(0, i)
    .map((t) => pct(netChargeOffsCreQ(t), creLoansBroad(t)))
    .filter((v): v is number => v !== null)

  const step = rollForward(history, "cre").find((s) => s.quarter === q.quarter) ?? null

  const pastDueCre = (t: BehaviorQuarter) => sumOrNull(t.pastDue30Cre, t.pastDue90Cre)

  const nco = netChargeOffsCreQ(q)
  const creRunoffPct =
    q.creLoans === null || p.creLoans === null || p.creLoans <= 0 || nco === null
      ? null
      : ((q.creLoans - p.creLoans + nco) / p.creLoans) * 100

  let creRunoff4qPct: number | null = null
  if (i >= 4) {
    const base = history.quarters[i - 4]
    const ncos = history.quarters.slice(i - 3, i + 1).map(netChargeOffsCreQ)
    const ncoSum = ncos.every((v): v is number => v !== null) ? ncos.reduce((a, b) => a + b, 0) : null
    if (q.creLoans !== null && base.creLoans !== null && base.creLoans > 0 && ncoSum !== null) {
      creRunoff4qPct = ((q.creLoans - base.creLoans + ncoSum) / base.creLoans) * 100
    }
  }

  return {
    hfsBalance: q.heldForSale,
    hfsPct: pct(q.heldForSale, q.grossLoans),
    hfsChangePct: q.heldForSale === null || p.heldForSale === null ? null : pct(q.heldForSale - p.heldForSale, q.grossLoans),
    hfsTrailingMax: hfsValues.length ? Math.max(...hfsValues) : null,
    loanSaleGainQ: q.loanSaleGainQ,
    priorQuartersWithSales: salesValues.length ? salesValues.filter((v) => v !== 0).length : null,
    creNcoRateQ: pct(nco, creLoansBroad(q)),
    creNcoRateTrailingMean: ncoHistory.length >= 3 ? ncoHistory.reduce((a, b) => a + b, 0) / ncoHistory.length : null,
    unexplainedExit: step?.unexplainedExit ?? null,
    unexplainedExitPctOfCre: step?.unexplainedExitPctOfCre ?? null,
    unexplainedExitShareOfPrior: step?.unexplainedExitShareOfPrior ?? null,
    nonaccrualCreChange: q.nonaccrualCre === null || p.nonaccrualCre === null ? null : q.nonaccrualCre - p.nonaccrualCre,
    oreoCrePct: pct(q.oreoCre, q.creLoans),
    oreoCreChangePct: q.oreoCre === null || p.oreoCre === null ? null : pct(q.oreoCre - p.oreoCre, q.creLoans),
    modificationsCrePct: pct(q.modificationsCre, q.creLoans),
    modificationsCreChangePct:
      q.modificationsCre === null || p.modificationsCre === null ? null : pct(q.modificationsCre - p.modificationsCre, q.creLoans),
    pastDueCreChange: pastDueCre(q) === null || pastDueCre(p) === null ? null : pastDueCre(q)! - pastDueCre(p)!,
    creRunoffPct,
    creRunoff4qPct,
  }
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export type SignalResult = {
  fired: boolean
  /** True when the inputs needed to judge the signal were all reported. */
  judged: boolean
}

export type SignalResults = Record<SignalKey, SignalResult>

const T = SIGNAL_THRESHOLDS

/** The seven signals from one quarter's measures. Pure; the same bank fires the same way in any scope. */
export function judgeSignals(m: BehaviorMeasures): SignalResults {
  const judged = (...inputs: (number | null)[]) => inputs.every((v) => v !== null)

  const hfsJudged = judged(m.hfsChangePct, m.hfsBalance)
  const hfsTransfer =
    hfsJudged &&
    m.hfsChangePct! >= T.hfsRisePctOfLoans &&
    // A bank with no prior HFS has no own level to beat; the rise itself is the new level.
    (m.hfsTrailingMax === null || m.hfsTrailingMax === 0 || m.hfsBalance! >= T.hfsNewLevelMultiple * m.hfsTrailingMax)

  const saleJudged = m.loanSaleGainQ !== null
  const realizedSale =
    saleJudged &&
    m.loanSaleGainQ !== 0 &&
    (m.loanSaleGainQ! < 0 || m.priorQuartersWithSales === null || m.priorQuartersWithSales <= 1)

  const ncoJudged = m.creNcoRateQ !== null
  const chargeOffSpike =
    ncoJudged &&
    (m.creNcoRateQ! >= T.ncoRateAbsolute ||
      (m.creNcoRateQ! >= T.ncoRateFloor &&
        m.creNcoRateTrailingMean !== null &&
        m.creNcoRateQ! >= T.ncoOwnHistoryMultiple * Math.max(m.creNcoRateTrailingMean, 0.01)))

  // The share of prior nonaccrual is null when there was none — judged, with nothing to exit.
  const exitJudged = judged(m.unexplainedExit, m.unexplainedExitPctOfCre, m.nonaccrualCreChange)
  const unexplainedExit =
    exitJudged &&
    m.nonaccrualCreChange! < 0 &&
    m.unexplainedExit! > 0 &&
    m.unexplainedExitShareOfPrior !== null &&
    m.unexplainedExitShareOfPrior >= T.exitShareOfPriorNonaccrual &&
    m.unexplainedExitPctOfCre! >= T.exitPctOfCre

  const oreoJudged = judged(m.oreoCreChangePct, m.nonaccrualCreChange)
  const foreclosureRoute = oreoJudged && m.oreoCreChangePct! >= T.oreoRisePctOfCre && m.nonaccrualCreChange! < 0

  const modJudged = judged(m.modificationsCreChangePct, m.pastDueCreChange)
  const modificationBuild = modJudged && m.modificationsCreChangePct! >= T.modificationRisePctOfCre && m.pastDueCreChange! <= 0

  const runoffJudged = judged(m.creRunoffPct, m.creRunoff4qPct)
  const creRunoff = runoffJudged && m.creRunoffPct! <= T.runoffPct && m.creRunoff4qPct! <= T.runoff4qPct

  return {
    hfsTransfer: { fired: hfsTransfer, judged: hfsJudged },
    realizedSale: { fired: realizedSale, judged: saleJudged },
    chargeOffSpike: { fired: chargeOffSpike, judged: ncoJudged },
    unexplainedExit: { fired: unexplainedExit, judged: exitJudged },
    foreclosureRoute: { fired: foreclosureRoute, judged: oreoJudged },
    modificationBuild: { fired: modificationBuild, judged: modJudged },
    creRunoff: { fired: creRunoff, judged: runoffJudged },
  }
}

// ─── Cohort ──────────────────────────────────────────────────────────────────

export type AssetBandKey = "under100m" | "100m-250m" | "250m-500m" | "500m-1b" | "1b-3b" | "3b-10b" | "over10b"

/**
 * Storage chunks for the cached cohort. Sized so the largest holds under a
 * thousand banks (975 in the $100M–$250M band at Q2 2026), which keeps every
 * entry well under the 2MB Data Cache ceiling with room for the score.
 */
export const ASSET_BANDS: readonly { key: AssetBandKey; label: string; maxAssets: number | null }[] = [
  { key: "under100m", label: "Under $100M", maxAssets: 100_000 },
  { key: "100m-250m", label: "$100M–$250M", maxAssets: 250_000 },
  { key: "250m-500m", label: "$250M–$500M", maxAssets: 500_000 },
  { key: "500m-1b", label: "$500M–$1B", maxAssets: 1_000_000 },
  { key: "1b-3b", label: "$1B–$3B", maxAssets: 3_000_000 },
  { key: "3b-10b", label: "$3B–$10B", maxAssets: 10_000_000 },
  { key: "over10b", label: "Over $10B", maxAssets: null },
]

/** Which storage chunk a bank belongs to; unknown assets go with the smallest. */
export function assetBandOf(totalAssets: number | null): AssetBandKey {
  if (totalAssets === null) return "under100m"
  for (const band of ASSET_BANDS) if (band.maxAssets === null || totalAssets < band.maxAssets) return band.key
  return "over10b"
}

/** The measures that get a percentile within the scope, and the direction that reads as "more". */
export const PERCENTILED_MEASURES: readonly (keyof BehaviorMeasures)[] = [
  "hfsChangePct",
  "creNcoRateQ",
  "unexplainedExitPctOfCre",
  "oreoCreChangePct",
  "modificationsCreChangePct",
  "creRunoffPct",
]

export type BankBehaviorSummary = {
  cert: string
  name: string
  state: string | null
  /** The bank's newest quarter, `YYYYMMDD`. */
  quarter: string
  /** True when `quarter` is the cohort's as-of quarter; stale filers keep their signals but sit out the percentiles. */
  current: boolean
  quartersAvailable: number
  totalAssets: number | null
  grossLoans: number | null
  creLoans: number | null
  band: AssetBandKey
  measures: BehaviorMeasures
  /** 0–100 within the scope, among current filers with a value; null below `minCohort`. */
  percentiles: Partial<Record<keyof BehaviorMeasures, number | null>>
  /** Signals that fired this quarter. Stored as keys rather than seven objects: this is the cached shape. */
  fired: SignalKey[]
  /** Signals whose inputs were not all reported. */
  unjudged: SignalKey[]
  /** Action-side signals fired this quarter. */
  actionCount: number
  /** Pressure-side signals fired this quarter. */
  pressureCount: number
}

/** The per-signal view of a summary, rebuilt from the stored key lists. */
export function signalResultsOf(summary: Pick<BankBehaviorSummary, "fired" | "unjudged">): SignalResults {
  return Object.fromEntries(
    SIGNAL_KEYS.map((k) => [k, { fired: summary.fired.includes(k), judged: !summary.unjudged.includes(k) }])
  ) as SignalResults
}

export type BehaviorSignalsCohort = {
  scope: string
  asOfQuarter: string
  institutionCount: number
  currentCount: number
  /** Banks with fewer than two quarters, which cannot be judged, are counted here and omitted. */
  unjudgedCount: number
  summaries: BankBehaviorSummary[]
}

const ACTION_KEYS = SIGNALS.filter((s) => s.side === "action").map((s) => s.key)
const PRESSURE_KEYS = SIGNALS.filter((s) => s.side === "pressure").map((s) => s.key)

function round(v: number | null, dp: number): number | null {
  if (v === null) return null
  const f = 10 ** dp
  return Math.round(v * f) / f
}

/** One bank's summary at its newest quarter, without percentiles. Null when there is nothing to judge. */
export function summarizeBank(history: BehaviorHistory, asOfQuarter: string): Omit<BankBehaviorSummary, "percentiles"> | null {
  const i = history.quarters.length - 1
  if (i < 1) return null
  const q = history.quarters[i]
  const measures = measuresAt(history, i)!
  const signals = judgeSignals(measures)
  const rounded = Object.fromEntries(
    Object.entries(measures).map(([k, v]) => [k, typeof v === "number" ? round(v, Number.isInteger(v) ? 0 : 3) : v])
  ) as BehaviorMeasures
  return {
    cert: history.cert,
    name: history.name,
    state: history.state,
    quarter: q.quarter,
    current: q.quarter === asOfQuarter,
    quartersAvailable: history.quarters.length,
    totalAssets: q.totalAssets,
    grossLoans: q.grossLoans,
    creLoans: q.creLoans,
    band: assetBandOf(q.totalAssets),
    measures: rounded,
    fired: SIGNAL_KEYS.filter((k) => signals[k].fired),
    unjudged: SIGNAL_KEYS.filter((k) => !signals[k].judged),
    actionCount: ACTION_KEYS.filter((k) => signals[k].fired).length,
    pressureCount: PRESSURE_KEYS.filter((k) => signals[k].fired).length,
  }
}

/**
 * Every bank in the scope, judged on its own history, then given percentiles
 * within the scope. The percentiles are the only part that depends on who
 * else is in the cohort.
 */
export function computeBehaviorSignals(histories: BehaviorHistory[], scope: string, asOfQuarter: string): BehaviorSignalsCohort {
  const partial: Omit<BankBehaviorSummary, "percentiles">[] = []
  let unjudgedCount = 0
  for (const h of histories) {
    const s = summarizeBank(h, asOfQuarter)
    if (s) partial.push(s)
    else unjudgedCount++
  }

  const current = partial.filter((s) => s.current)
  const sorted = new Map<keyof BehaviorMeasures, number[]>()
  for (const key of PERCENTILED_MEASURES) {
    const values = current.map((s) => s.measures[key]).filter((v): v is number => v !== null).sort((a, b) => a - b)
    sorted.set(key, values)
  }

  const summaries: BankBehaviorSummary[] = partial.map((s) => {
    const percentiles: Partial<Record<keyof BehaviorMeasures, number | null>> = {}
    for (const key of PERCENTILED_MEASURES) {
      const values = sorted.get(key)!
      const v = s.measures[key]
      percentiles[key] =
        !s.current || v === null || values.length < SIGNAL_THRESHOLDS.minCohort ? null : round(percentileRank(values, v) * 100, 1)
    }
    return { ...s, percentiles }
  })

  return {
    scope,
    asOfQuarter,
    institutionCount: partial.length,
    currentCount: current.length,
    unjudgedCount,
    summaries,
  }
}
