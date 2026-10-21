/**
 * Seller Likelihood: which banks are about to have loan pools to sell.
 *
 * Steps 1-3 established what a bank is *doing* about its bad CRE — moving loans
 * to held-for-sale, selling them, charging them off, foreclosing, modifying.
 * This turns that into the question the business actually asks: of the banks
 * under pressure, which ones will be in the market next, and which are already
 * there.
 *
 * **Four states, and the useful one is not the obvious one.**
 *
 * - `active-seller` — action signals are firing now. The bank is moving assets,
 *   so there is something to bid on today.
 * - `pre-seller` — pressure is high and nothing has moved yet. This is the state
 *   worth watching: by the time a pool reaches the market the price has been
 *   set, and a bank that has stopped being able to carry its CRE but has not yet
 *   acted is the one to call first.
 * - `cleaned-up` — it acted, and the pressure has gone. Nothing left to buy.
 * - `stable` — no pressure, no action.
 *
 * **The score ranks within a state, it does not replace it.** A high score on a
 * stable bank means little; a high score on a pre-seller is the signal. So the
 * UI should always show both, and `describeState` exists so it can.
 *
 * Every input is a `BehaviorMeasures` field or a scope percentile from
 * `BankBehaviorSummary`, so nothing here needs new data. Null inputs reduce the
 * evidence a score is built on rather than counting as zero — a bank that does
 * not report its modifications is not a bank with none, and `confidence` says
 * how much of the score was actually observed.
 */

import type { BankBehaviorSummary, BehaviorMeasures, SignalKey } from "./bank-behavior-signals"

/**
 * What the assessment actually needs.
 *
 * Narrower than `BankBehaviorSummary` on purpose: the backtest judges a bank at
 * each of the quarters before it failed, and those quarters have measures and
 * signals but no cohort summary. Taking the whole summary would have forced the
 * backtest to fabricate one.
 */
export type SellerInput = Pick<
  BankBehaviorSummary,
  "cert" | "quarter" | "measures" | "percentiles" | "fired"
>

export type SellerState = "active-seller" | "pre-seller" | "cleaned-up" | "stable"

/**
 * Starting thresholds, gathered so the backtest can move them in one place —
 * the same discipline as `SIGNAL_THRESHOLDS`.
 *
 * Unlike the peer signals these can be validated: `scripts/backtest-seller-likelihood.ts`
 * runs them against the banks that actually failed between 2022 and 2026 and
 * reports what the score said in the quarters before. The sample is small (13
 * failures, of which three were liquidity runs on institutions far outside this
 * cohort), so it is a directional check rather than a statistical one, and the
 * script says so.
 */
export const SELLER_THRESHOLDS = {
  /** Score at or above which a bank counts as under pressure. */
  pressureScore: 70,
  /**
   * How much of the score must actually be observed before it can decide a
   * state.
   *
   * The score is computed over observed weight so a partial reporter is not
   * read as calm — but that cuts the other way too: a bank reporting one of six
   * components at its ceiling scores 100 on 15% confidence. Letting that drive
   * the state put 45% of the backtest's bank-quarters into `pre-seller`. Below
   * this floor the score is still reported, and still shown with its
   * confidence, but only an absolute rate can change the state.
   */
  minimumConfidence: 0.5,
  /**
   * …or this absolute rate, so a scope where everyone is stressed does not read
   * as a scope where nobody is, which a percentile alone would do.
   *
   * It must be corroborated by `absolutePathMinimumScore`: on its own this
   * floor put 29.7% of the 4,603-bank national cohort into `pre-seller`, which
   * is not a label that means anything.
   */
  nonaccrualRateFloor: 0.02,
  /** A bank on the absolute path still needs this much overall pressure. */
  absolutePathMinimumScore: 50,
  /**
   * Action signals in the newest quarter that make a bank an active seller.
   *
   * **Two, not one, and the backtest is why.** At one, the first run labelled
   * twelve of thirteen failed banks as active sellers — including Silicon
   * Valley, Signature and First Republic, which were deposit runs with no CRE
   * selling behaviour at all. That is not a 92% hit rate, it is a threshold
   * that fires on everything: step 2 measured CRE runoff alone at 12.6% of
   * banks nationally and unexplained exit at 8.6%, so one signal catches
   * roughly a quarter of the industry. Two or more was measured at 166 of
   * 4,603 banks — 3.6%, which is a list somebody can actually work.
   */
  activeActionCount: 2,
  /** Quarters of action history that still count as "recently acted". */
  recentActionQuarters: 4,
  /**
   * Below this score a pre-seller is not worth surfacing.
   *
   * Chosen by sweeping the real national cohort rather than by taste. At 40 the
   * ranked list was 1,005 banks — 21.8% of the industry, which nobody will work
   * through. At 70 it is 288: the 176 banks acting now, plus 112 under enough
   * pressure to call. Raising the confidence bar on top of this changes almost
   * nothing (112 to 103), because a high score is already a well-observed one.
   */
  minimumInterestingScore: 70,
} as const

/** What the score is built from, and what each part contributed. */
export type ScoreComponent = {
  key: string
  label: string
  /** 0-1 after normalisation, or null when the input was not reported. */
  value: number | null
  /** Share of the total score this component can contribute. */
  weight: number
  /** What it means, for the disclosure. */
  meaning: string
}

export type SellerLikelihood = {
  cert: string
  state: SellerState
  /** 0-100, or null when too little was reported to score at all. */
  score: number | null
  /** Share of the weight that was actually observed, 0-1. */
  confidence: number
  components: ScoreComponent[]
  /** The action signals that fired in the newest quarter. */
  firedActions: SignalKey[]
  /** Plain-language reason for the state, built from the figures. */
  reason: string
}

const ACTION_SIGNALS: readonly SignalKey[] = [
  "hfsTransfer",
  "realizedSale",
  "chargeOffSpike",
  "unexplainedExit",
  "foreclosureRoute",
  "creRunoff",
]

/** Normalise a rate onto 0-1 against a ceiling, so one outlier cannot dominate. */
function ratio(value: number | null, ceiling: number): number | null {
  if (value == null || ceiling <= 0) return null
  return Math.max(0, Math.min(1, value / ceiling))
}

function percentileAsFraction(p: number | null | undefined): number | null {
  return p == null ? null : Math.max(0, Math.min(1, p / 100))
}

/**
 * How much distressed CRE is sitting on the balance sheet, and how hard it is
 * to carry.
 *
 * Deliberately built from *pressure* rather than from action: a bank that has
 * already sold is not a future seller, and a bank whose nonaccruals are rising
 * while nothing moves is. The action side enters through the state, not the
 * score.
 */
function pressureComponents(summary: SellerInput): ScoreComponent[] {
  const m = summary.measures
  const p = summary.percentiles
  return [
    {
      key: "modificationBuild",
      label: "Modifications building",
      value: ratio(m.modificationsCrePct, 0.04),
      weight: 0.2,
      meaning: "Borrowers being given terms rather than being foreclosed on. The earliest sign a book is deteriorating.",
    },
    {
      key: "unexplainedExit",
      label: "Unexplained nonaccrual exit",
      value: ratio(m.unexplainedExitPctOfCre, 0.01),
      weight: 0.15,
      meaning: "Nonaccruals leaving the book without a charge-off or a foreclosure to explain it — often a quiet sale.",
    },
    {
      key: "oreoBuild",
      label: "Foreclosed property building",
      value: ratio(m.oreoCrePct, 0.03),
      weight: 0.15,
      meaning: "Property taken onto the balance sheet. It has to be sold eventually, and carrying it is expensive.",
    },
    {
      key: "chargeOffRate",
      label: "CRE charge-off rate",
      value: ratio(m.creNcoRateQ, 0.01),
      weight: 0.15,
      meaning: "Losses already taken this quarter, as a share of the CRE book.",
    },
    {
      key: "pressurePercentile",
      label: "Pressure against the cohort",
      value: percentileAsFraction(p.modificationsCrePct ?? p.oreoCrePct ?? p.creNcoRateQ),
      weight: 0.2,
      meaning: "Where the bank sits among its scope on the same measures. Context only — it cannot fire a signal.",
    },
    {
      key: "runoff",
      label: "CRE book shrinking",
      value: ratio(m.creRunoff4qPct == null ? null : -m.creRunoff4qPct, 0.15),
      weight: 0.15,
      meaning: "The book getting smaller beyond charge-offs over four quarters — running off, or being sold down.",
    },
  ]
}

/**
 * Is this bank under enough pressure to be a seller at all?
 *
 * Either its cohort percentile is high, or an absolute rate is — the second so
 * that a scope where everyone is stressed does not read as a scope where nobody
 * is, which a percentile alone would do.
 */
function isUnderPressure(summary: SellerInput, score: number | null, confidence: number): boolean {
  // A score built on one observed component is not evidence of pressure,
  // however high it is: the score is computed over observed weight, so one
  // component at its ceiling reads 100 on 15% confidence. Letting that decide
  // the state put 45% of the backtest's bank-quarters into `pre-seller`.
  const byScore =
    score != null &&
    confidence >= SELLER_THRESHOLDS.minimumConfidence &&
    score >= SELLER_THRESHOLDS.pressureScore
  const m = summary.measures
  // The absolute path needs corroboration: one rate above the floor, with no
  // other pressure behind it, described nearly a third of all banks.
  const hasHighRate =
    (m.oreoCrePct != null && m.oreoCrePct >= SELLER_THRESHOLDS.nonaccrualRateFloor) ||
    (m.modificationsCrePct != null && m.modificationsCrePct >= SELLER_THRESHOLDS.nonaccrualRateFloor)
  const byAbsolute = hasHighRate && score != null && score >= SELLER_THRESHOLDS.absolutePathMinimumScore
  return byScore || byAbsolute
}

export type SellerHistory = {
  /** Action signals fired in each of the previous quarters, newest first. */
  priorActionCounts: number[]
}

/**
 * The state and the score for one bank.
 *
 * `history` is optional: without it, `cleaned-up` cannot be distinguished from
 * `stable`, because both look like a bank doing nothing — so the function
 * returns `stable` and says so in the reason rather than guessing.
 */
export function assessSeller(summary: SellerInput, history?: SellerHistory): SellerLikelihood {
  const components = pressureComponents(summary)
  const observed = components.filter((c) => c.value != null)
  const totalWeight = components.reduce((a, c) => a + c.weight, 0)
  const observedWeight = observed.reduce((a, c) => a + c.weight, 0)
  const confidence = totalWeight > 0 ? observedWeight / totalWeight : 0

  // Scored over the weight actually observed, so a bank reporting half the
  // inputs is not penalised into looking calm — but `confidence` records it.
  const score =
    observedWeight > 0
      ? Math.round((observed.reduce((a, c) => a + (c.value as number) * c.weight, 0) / observedWeight) * 100)
      : null

  const firedActions = summary.fired.filter((k) => ACTION_SIGNALS.includes(k))
  const actedRecently =
    (history?.priorActionCounts ?? [])
      .slice(0, SELLER_THRESHOLDS.recentActionQuarters)
      .some((n) => n > 0) || firedActions.length > 0
  const underPressure = isUnderPressure(summary, score, confidence)

  let state: SellerState
  let reason: string

  if (firedActions.length >= SELLER_THRESHOLDS.activeActionCount) {
    state = "active-seller"
    reason = `Acting now: ${firedActions.length} action ${firedActions.length === 1 ? "signal" : "signals"} fired in ${summary.quarter}. There is something moving to bid on.`
  } else if (underPressure) {
    state = "pre-seller"
    reason = `Under pressure with nothing moving yet${
      score != null ? ` — pressure scores ${score} of 100 on ${Math.round(confidence * 100)}% of the measures` : ""
    }. The state worth calling first, because by the time a pool reaches the market the price is set.`
  } else if (actedRecently) {
    state = "cleaned-up"
    reason = `Acted within the last ${SELLER_THRESHOLDS.recentActionQuarters} quarters and the pressure has gone. Little left to buy.`
  } else if (!history) {
    state = "stable"
    reason = `No pressure and nothing moving. Without a prior-quarter history this cannot be distinguished from a bank that has already cleaned up.`
  } else {
    state = "stable"
    reason = `No pressure and no action in the last ${SELLER_THRESHOLDS.recentActionQuarters} quarters.`
  }

  return { cert: summary.cert, state, score, confidence, components, firedActions, reason }
}

export const STATE_LABELS: Record<SellerState, string> = {
  "active-seller": "Active seller",
  "pre-seller": "Pre-seller",
  "cleaned-up": "Cleaned up",
  stable: "Stable",
}

export const STATE_MEANINGS: Record<SellerState, string> = {
  "active-seller": "Action signals fired this quarter — assets are moving, so there is something to bid on now.",
  "pre-seller":
    "High pressure and nothing moving yet. The most actionable state: a bank that can no longer carry its CRE but has not acted is the one to approach before a pool is marketed.",
  "cleaned-up": "It acted recently and the pressure has gone. Little left to buy.",
  stable: "Neither under pressure nor acting.",
}

export function describeState(state: SellerState): { label: string; meaning: string } {
  return { label: STATE_LABELS[state], meaning: STATE_MEANINGS[state] }
}

/**
 * The banks worth a call, in order.
 *
 * Active sellers first because they are biddable today, then pre-sellers by
 * score. Cleaned-up and stable banks are excluded entirely rather than ranked
 * last — a list that ends in two thousand banks nobody will call is not a list.
 */
export function rankSellers(
  assessments: readonly SellerLikelihood[],
  // Typed, not inferred: `SELLER_THRESHOLDS` is `as const`, so the default
  // would otherwise narrow the parameter to the literal 40 and refuse any
  // other floor a caller passes.
  minimumScore: number = SELLER_THRESHOLDS.minimumInterestingScore
): SellerLikelihood[] {
  const rank: Record<SellerState, number> = { "active-seller": 0, "pre-seller": 1, "cleaned-up": 2, stable: 3 }
  return assessments
    .filter((a) => a.state === "active-seller" || (a.state === "pre-seller" && (a.score ?? 0) >= minimumScore))
    .sort((a, b) => rank[a.state] - rank[b.state] || (b.score ?? 0) - (a.score ?? 0))
}

/** How the cohort splits across the four states, for the panel header. */
export function stateCounts(assessments: readonly SellerLikelihood[]): Record<SellerState, number> {
  const counts: Record<SellerState, number> = { "active-seller": 0, "pre-seller": 0, "cleaned-up": 0, stable: 0 }
  for (const a of assessments) counts[a.state] += 1
  return counts
}
