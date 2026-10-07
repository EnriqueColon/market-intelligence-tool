/**
 * The Balance-Sheet Actions panel for one institution: what the drawer shows
 * under the eight-quarter trend. Pure — no fetching, no caching.
 *
 * Everything here is a view over one `BehaviorHistory`: the balances the
 * charts plot, the CRE nonaccrual roll-forward per quarter, which signals
 * fired in each quarter, and a short reading built deterministically from
 * those figures. The reading quotes only numbers that are on the panel, so
 * the spec's rule that every figure traces to the data holds by construction;
 * there is no model call to check.
 *
 * Dollar amounts are thousands, as the Call Report reports them.
 */

import type { BehaviorHistory, BehaviorQuarter } from "@/lib/analytics/bank-behavior"
import {
  CRE_CATEGORY_LABEL,
  SIGNALS,
  SIGNAL_KEYS,
  SIGNAL_THRESHOLDS,
  judgeSignals,
  measuresAt,
  netChargeOffsCreQ,
  rollForward,
  summarizeBank,
  type BankBehaviorSummary,
  type CreCategory,
  type RollForwardStep,
  type SignalKey,
} from "@/lib/analytics/bank-behavior-signals"

/** One quarter's balances and flows, as plotted. Thousands unless named otherwise. */
export type BehaviorPanelPoint = {
  quarter: string
  label: string
  grossLoans: number | null
  creLoans: number | null
  /** RC 4.a. */
  heldForSale: number | null
  /** Derived: heldForSale ÷ grossLoans × 100. */
  heldForSalePctOfLoans: number | null
  /** Derived: construction + multifamily + nonfarm OREO (RC-M 3.a–c). */
  oreoCre: number | null
  /** RC-M 3, all property types. */
  oreoTotal: number | null
  /** Derived: CRE nonaccrual across the three categories (RC-N). */
  nonaccrualCre: number | null
  /** Derived: CRE modifications to borrowers in financial difficulty (RC-C M.1). */
  modificationsCre: number | null
  /** Derived: the quarter's gross CRE charge-offs, YTD-differenced (RI-B). */
  chargeOffsCreQ: number | null
  /** Reported quarter nets, RI-B (construction + multifamily + nonfarm). */
  netChargeOffsCreQ: number | null
  /** RI 5.i, the quarter. */
  loanSaleGainQ: number | null
}

/** Which signals fired in a quarter, for the strip. */
export type QuarterSignals = {
  quarter: string
  label: string
  fired: SignalKey[]
  unjudged: SignalKey[]
}

export type BehaviorPanelReading = {
  text: string
  /** The signals the reading leans on, so the UI can relate them. */
  signals: SignalKey[]
}

export type InstitutionBehavior = {
  cert: string
  name: string
  state: string | null
  /** The newest published quarter when this was built, `YYYYMMDD`. */
  asOfQuarter: string
  /** Oldest first. */
  points: BehaviorPanelPoint[]
  /** Total CRE, one step per quarter after the first. */
  rollForward: RollForwardStep[]
  /** The newest quarter's step for each category, for the breakdown line. */
  latestByCategory: { category: Exclude<CreCategory, "cre">; label: string; step: RollForwardStep | null }[]
  signalsByQuarter: QuarterSignals[]
  /** The newest quarter's summary, or null when there is only one quarter. */
  latest: Omit<BankBehaviorSummary, "percentiles"> | null
  reading: BehaviorPanelReading
}

const pct = (num: number | null, den: number | null): number | null =>
  num === null || den === null || den === 0 ? null : (num / den) * 100

function toPoint(q: BehaviorQuarter): BehaviorPanelPoint {
  return {
    quarter: q.quarter,
    label: q.label,
    grossLoans: q.grossLoans,
    creLoans: q.creLoans,
    heldForSale: q.heldForSale,
    heldForSalePctOfLoans: pct(q.heldForSale, q.grossLoans),
    oreoCre: q.oreoCre,
    oreoTotal: q.oreoTotal,
    nonaccrualCre: q.nonaccrualCre,
    modificationsCre: q.modificationsCre,
    chargeOffsCreQ: q.chargeOffsCreQ,
    netChargeOffsCreQ: netChargeOffsCreQ(q),
    loanSaleGainQ: q.loanSaleGainQ,
  }
}

const CATEGORIES: Exclude<CreCategory, "cre">[] = ["construction", "multifamily", "nonfarmNonres"]

export function signalsByQuarter(history: BehaviorHistory): QuarterSignals[] {
  const out: QuarterSignals[] = []
  for (let i = 1; i < history.quarters.length; i++) {
    const m = measuresAt(history, i)
    const q = history.quarters[i]
    if (!m) {
      out.push({ quarter: q.quarter, label: q.label, fired: [], unjudged: [...SIGNAL_KEYS] })
      continue
    }
    const judged = judgeSignals(m)
    out.push({
      quarter: q.quarter,
      label: q.label,
      fired: SIGNAL_KEYS.filter((k) => judged[k].fired),
      unjudged: SIGNAL_KEYS.filter((k) => !judged[k].judged),
    })
  }
  return out
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** `$12.3M` from thousands; `$850K` under a million; `$0` for zero. */
export function money(thousands: number): string {
  const dollars = thousands * 1000
  const abs = Math.abs(dollars)
  const sign = dollars < 0 ? "−" : ""
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

const pctText = (v: number, dp = 2) => `${v.toFixed(dp)}%`

/** A signal's label for mid-sentence use: first letter lowered unless it opens an acronym ("HFS transfer"). */
export function signalName(key: SignalKey): string {
  const label = SIGNALS.find((s) => s.key === key)!.label
  return label.replace(/^([A-Z])(?![A-Z])/, (c) => c.toLowerCase())
}

/**
 * Two short paragraphs: what the bank did this quarter (from the signals that
 * fired and the figures behind them) and what the roll-forward says about
 * where its CRE nonaccruals went. Every number is one the panel shows.
 */
export function buildReading(
  history: BehaviorHistory,
  latest: Omit<BankBehaviorSummary, "percentiles"> | null,
  steps: RollForwardStep[],
  byQuarter: QuarterSignals[]
): BehaviorPanelReading {
  const q = history.quarters[history.quarters.length - 1]
  const label = q?.label ?? "the latest quarter"
  if (!latest || !q) {
    return {
      text: `Only one quarter of behaviour fields is on file for this institution, so nothing can be judged: every signal compares a quarter with the one before it.`,
      signals: [],
    }
  }
  const m = latest.measures
  const fired = new Set(latest.fired)
  const sentences: string[] = []

  if (fired.has("hfsTransfer") && m.hfsBalance !== null && m.hfsPct !== null) {
    sentences.push(
      `In ${label} it moved loans to held-for-sale: the balance is ${money(m.hfsBalance)}, ${pctText(m.hfsPct)} of gross loans${
        m.hfsTrailingMax !== null ? `, against a high of ${money(m.hfsTrailingMax)} over the previous four quarters` : ""
      }.`
    )
  }
  if (fired.has("realizedSale") && m.loanSaleGainQ !== null) {
    const loss = m.loanSaleGainQ < 0
    sentences.push(
      `It booked a ${loss ? "loss" : "gain"} of ${money(Math.abs(m.loanSaleGainQ))} on loan sales in the quarter${
        loss ? ", which points to a discount trade" : ""
      }${m.priorQuartersWithSales !== null && m.priorQuartersWithSales <= 1 ? "; it had sold in at most one of the previous four quarters, so this is not a routine pipeline" : ""}.`
    )
  }
  if (fired.has("chargeOffSpike") && m.creNcoRateQ !== null) {
    sentences.push(
      `CRE net charge-offs ran ${pctText(m.creNcoRateQ, 3)} of CRE loans for the quarter${
        m.creNcoRateTrailingMean !== null ? `, against its own average of ${pctText(m.creNcoRateTrailingMean, 3)}` : ""
      }.`
    )
  }
  if (fired.has("foreclosureRoute") && m.oreoCreChangePct !== null && m.oreoCrePct !== null) {
    sentences.push(
      `It took collateral: CRE OREO rose by ${pctText(m.oreoCreChangePct, 3)} of CRE loans to ${pctText(m.oreoCrePct, 2)} while CRE nonaccrual fell, so REO rather than a note sale is the route.`
    )
  }
  if (fired.has("unexplainedExit") && m.unexplainedExit !== null && m.unexplainedExitPctOfCre !== null) {
    sentences.push(
      `${money(m.unexplainedExit)} of CRE nonaccrual (${pctText(m.unexplainedExitPctOfCre)} of CRE loans) left the books without a charge-off or a transfer to OREO to account for it — consistent with a note sale, though cures and payoffs land in the same residual.`
    )
  }
  if (fired.has("modificationBuild") && m.modificationsCrePct !== null && m.modificationsCreChangePct !== null) {
    sentences.push(
      `Modifications to CRE borrowers in difficulty rose by ${pctText(m.modificationsCreChangePct)} of CRE loans to ${pctText(m.modificationsCrePct)} while past-dues were flat or falling: extending rather than resolving.`
    )
  }
  if (fired.has("creRunoff") && m.creRunoffPct !== null && m.creRunoff4qPct !== null) {
    sentences.push(
      `The CRE book shrank ${pctText(Math.abs(m.creRunoffPct), 1)} in the quarter and ${pctText(Math.abs(m.creRunoff4qPct), 1)} over four, beyond what charge-offs explain.`
    )
  }

  if (sentences.length === 0) {
    const judgedCount = SIGNAL_KEYS.length - latest.unjudged.length
    const earlier = byQuarter.slice(0, -1).filter((s) => s.fired.length > 0)
    const head =
      judgedCount === 0
        ? `None of the seven behaviour signals could be judged for ${label}; the inputs they need are not reported for this institution.`
        : `No behaviour signal fired in ${label}${judgedCount < SIGNAL_KEYS.length ? ` (${judgedCount} of ${SIGNAL_KEYS.length} could be judged)` : ""}: held-for-sale${
            m.hfsPct !== null ? ` is ${pctText(m.hfsPct)} of loans` : " is not reported"
          }, and charge-offs, OREO and modifications moved within the bank's own range.`
    sentences.push(head)
    if (earlier.length > 0) {
      const last = earlier[earlier.length - 1]
      sentences.push(
        `The last quarter with a signal was ${last.label} (${last.fired.map((k) => signalName(k)).join(", ")}).`
      )
    }
  }

  const step = steps[steps.length - 1]
  const roll: string[] = []
  if (step && step.priorNonaccrual !== null && step.currentNonaccrual !== null) {
    const dir = step.currentNonaccrual > step.priorNonaccrual ? "rose" : step.currentNonaccrual < step.priorNonaccrual ? "fell" : "was unchanged"
    roll.push(
      `CRE nonaccrual ${dir}${dir === "was unchanged" ? "" : ` from ${money(step.priorNonaccrual)} to ${money(step.currentNonaccrual)}`} in ${label}.`
    )
    if (step.unexplainedExit !== null) {
      const parts: string[] = []
      if (step.chargeOffs) parts.push(`${money(step.chargeOffs)} charged off`)
      if (step.oreoTransferProxy) parts.push(`${money(step.oreoTransferProxy)} of OREO added`)
      if (step.newNonaccrualProxy) parts.push(`${money(step.newNonaccrualProxy)} of 90-day past-dues that were due to migrate in`)
      const share = step.unexplainedExitShareOfPrior
      const verdict =
        step.unexplainedExit > 0
          ? `${money(step.unexplainedExit)} is unexplained by charge-offs or foreclosure${
              fired.has("unexplainedExit")
                ? ""
                : share !== null
                  ? ` — ${pctText(share * 100, 0)} of the prior balance, under the ${SIGNAL_THRESHOLDS.exitShareOfPriorNonaccrual * 100}% at which the exit signal fires`
                  : ""
            }`
          : step.unexplainedExit < 0
            ? `nonaccruals grew by ${money(-step.unexplainedExit)} more than the prior past-dues predicted`
            : "the movement is fully explained"
      roll.push(parts.length > 0 ? `Allowing for ${parts.join(", ")}, ${verdict}.` : `${verdict[0].toUpperCase()}${verdict.slice(1)}.`)
    } else {
      roll.push("The roll-forward cannot be completed for this quarter because one of its inputs is not reported.")
    }
  }

  return {
    text: [sentences.join(" "), roll.join(" ")].filter((p) => p.length > 0).join("\n\n"),
    signals: latest.fired,
  }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export function buildInstitutionBehavior(history: BehaviorHistory, asOfQuarter: string): InstitutionBehavior {
  const points = history.quarters.map(toPoint)
  const steps = rollForward(history, "cre")
  const byQuarter = signalsByQuarter(history)
  const latest = summarizeBank(history, asOfQuarter)
  const latestByCategory = CATEGORIES.map((category) => {
    const s = rollForward(history, category)
    return { category, label: CRE_CATEGORY_LABEL[category], step: s.length > 0 ? s[s.length - 1] : null }
  })
  return {
    cert: history.cert,
    name: history.name,
    state: history.state,
    asOfQuarter,
    points,
    rollForward: steps,
    latestByCategory,
    signalsByQuarter: byQuarter,
    latest,
    reading: buildReading(history, latest, steps, byQuarter),
  }
}
