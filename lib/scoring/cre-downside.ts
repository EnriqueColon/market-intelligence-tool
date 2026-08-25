/**
 * How large a loss on the CRE book this institution can absorb.
 *
 * The rest of the tool reports where a bank stands today. An underwriter's
 * question is the next one: how much has to go wrong before it matters. This
 * takes a mark — a percentage loss on the CRE portfolio — and reports the
 * resulting capital ratio, plus the mark at which the institution reaches the
 * regulatory floor.
 *
 * ## Two capital regimes, not one
 *
 * A little under a third of institutions report no risk-weighted assets at all
 * — 24 of 86 in Florida at 2025Q4 — because they have elected the Community
 * Bank Leverage Ratio framework, which exempts them from risk-based capital
 * reporting.
 *
 * The trap is that FDIC returns **zero** for their RWAJ and RBCRWAJ, not null.
 * A `!= null` guard passes a zero straight through into a denominator. Every
 * capital test here is therefore a positivity test, and the alternative of
 * falling back to the `0.75 × assets` proxy used elsewhere in the tool is
 * refused outright: it would put a fabricated denominator under a number an
 * underwriter is going to quote to a credit committee.
 *
 * So each regime is handled on its own terms and labelled:
 *
 *  - **Risk-based filers** are measured on total risk-based capital over RWA.
 *  - **CBLR filers** are measured on Tier 1 over average assets.
 *
 * ## Choosing floors that mean the same thing
 *
 * The two regimes have to be measured against comparable levels or the
 * resulting break-even marks cannot be read side by side. An earlier version of
 * this used the 9% CBLR level for leverage filers against the 8% total risk-
 * based floor, and every one of the thinnest cushions in Florida came back a
 * CBLR filer — not a finding, an artifact. 9% is where a bank *loses its
 * election* and has to start reporting risk-based ratios; it is an operational
 * event, not a capital-adequacy one, and CBLR banks deliberately run just above
 * it. Comparing it to a floor that risk-based banks sit seven points clear of
 * made every CBLR bank look one bad quarter from trouble.
 *
 * The headline floor is therefore Prompt Corrective Action's
 * *adequately capitalised* level on each measure (12 CFR 324.403), which is the
 * genuinely matched pair: 8% total risk-based capital, and 4% Tier 1 leverage.
 * The 9% CBLR trigger is still reported for leverage filers, as a second and
 * clearly separate marker, because losing the election does matter — it just is
 * not the same question.
 *
 * ## Reconciliation
 *
 * The base ratio is not recomputed from parts where FDIC publishes it. For
 * risk-based filers it is RBCRWAJ, and `(RBCT1J + RBCT2) / RWAJ` was verified to
 * reproduce it to three decimal places on live data. For CBLR filers the
 * denominator is *derived from* the published leverage ratio
 * (`RBCT1J / (RBC1AAJ / 100)`) rather than from period-end assets, because the
 * leverage denominator is average assets over the quarter and period-end assets
 * miss it by several percent. Deriving it this way makes the base case equal
 * FDIC's published figure by construction.
 *
 * ## What the model does and does not do
 *
 * The mark is applied as a straight deduction from capital, with the
 * denominator held constant. Two simplifications are folded into that, and both
 * push the result the same way:
 *
 *  - No tax benefit. A real loss is deductible, so the after-tax hit to capital
 *    is smaller — though the deferred tax asset it creates is itself capped for
 *    capital purposes, which is why stress screens usually ignore it.
 *  - No relief in the denominator. Charging off a CRE loan removes a
 *    100%-risk-weighted asset and so lowers RWA, which would lift the resulting
 *    ratio slightly.
 *
 * Both omissions make the scenario more severe than reality, which is the
 * correct direction for underwriting. It is a screen, not a capital plan.
 */

/** PCA adequately-capitalised level for total risk-based capital. */
export const ADEQUATE_RBC = 8

/** PCA adequately-capitalised level for the Tier 1 leverage ratio. */
export const ADEQUATE_LEVERAGE = 4

/** The Community Bank Leverage Ratio itself. Below this, the election is lost. */
export const CBLR_TRIGGER = 9

export type CapitalRegime = "risk-based" | "leverage"

/** A level the stressed ratio is measured against. */
export type CapitalFloor = {
  /** Percent points. */
  value: number
  label: string
  /** What actually happens at this level. */
  consequence: string
  /**
   * The mark at which the ratio reaches this level, as a decimal. Null when the
   * institution is already below it, or when its whole CRE book is too small to
   * take it there.
   */
  breakEvenMark: number | null
  /** True when the institution is under this level before any stress. */
  alreadyBelow: boolean
}

export type DownsideInput = {
  /** CRE loans in dollars, on the 2006-guidance definition used tool-wide. */
  creLoans: number
  /** FDIC RBCT1J, dollars. */
  tier1Dollars?: number | null
  /** FDIC RBCT2, dollars. */
  tier2Dollars?: number | null
  /** FDIC RWAJ, dollars. Reported as zero, not null, by CBLR filers. */
  riskWeightedAssets?: number | null
  /** FDIC RBCRWAJ, percent points. Reported as zero, not null, by CBLR filers. */
  totalRbcRatio?: number | null
  /** FDIC RBC1AAJ, percent points. Reported by essentially everyone. */
  leverageRatio?: number | null
}

export type DownsideScenario = {
  regime: CapitalRegime
  /** Human name of the ratio being stressed. */
  ratioLabel: string
  /**
   * Levels this ratio is measured against, binding one first. Leverage filers
   * carry a second entry for the 9% CBLR election trigger.
   */
  floors: CapitalFloor[]
  /** The PCA adequately-capitalised level. Shorthand for `floors[0]`. */
  floor: CapitalFloor
  /** The published ratio today, in percent points. */
  baseRatio: number
  /** Capital in dollars that the mark is deducted from. */
  capital: number
  /** The constant denominator. */
  denominator: number
  creLoans: number
  /** Resulting ratio at each mark, in percent points. Can go negative. */
  marks: { mark: number; ratio: number; lossDollars: number; belowFloor: boolean }[]
  /** The mark that reaches the PCA floor. Shorthand for `floors[0].breakEvenMark`. */
  breakEvenMark: number | null
  /** Set when the institution is already under the PCA floor before any stress. */
  alreadyBelowFloor: boolean
}

/** Marks shown by default. Wide enough to bracket the 2008 CRE experience. */
export const DEFAULT_MARKS = [0.05, 0.1, 0.2, 0.3]

const positive = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 0

/**
 * Build the scenario, or return null when the institution reports neither a
 * usable risk-based capital position nor a usable leverage ratio.
 *
 * Returning null is the point. Every alternative — a zero, a proxy denominator,
 * a silently omitted row — presents a guess as a measurement.
 */
export function computeDownside(
  input: DownsideInput,
  marks: number[] = DEFAULT_MARKS
): DownsideScenario | null {
  const { creLoans } = input
  if (!positive(creLoans)) return null

  const basis = buildRiskBased(input) ?? buildLeverage(input)
  if (!basis) return null

  const { regime, ratioLabel, levels, capital, denominator, baseRatio } = basis

  const ratioAt = (mark: number) => ((capital - mark * creLoans) / denominator) * 100

  const floors: CapitalFloor[] = levels.map(({ value, label, consequence }) => {
    const alreadyBelow = baseRatio < value
    // Solve (capital - m*cre)/denominator = value/100 for m. A mark above 100%
    // is not a scenario, so it reads as unreachable rather than as a number.
    const solved = (capital - (value / 100) * denominator) / creLoans
    return {
      value,
      label,
      consequence,
      alreadyBelow,
      breakEvenMark: alreadyBelow || solved > 1 ? null : solved,
    }
  })

  const primary = floors[0]

  return {
    regime,
    ratioLabel,
    floors,
    floor: primary,
    baseRatio,
    capital,
    denominator,
    creLoans,
    marks: marks.map((mark) => {
      const ratio = ratioAt(mark)
      return { mark, ratio, lossDollars: mark * creLoans, belowFloor: ratio < primary.value }
    }),
    breakEvenMark: primary.breakEvenMark,
    alreadyBelowFloor: primary.alreadyBelow,
  }
}

function buildRiskBased(input: DownsideInput) {
  const { tier1Dollars, tier2Dollars, riskWeightedAssets, totalRbcRatio } = input
  if (!positive(riskWeightedAssets) || !positive(tier1Dollars)) return null
  // Tier 2 is legitimately zero at many banks, so absence is not disqualifying.
  const capital = tier1Dollars + (Number.isFinite(tier2Dollars as number) ? (tier2Dollars as number) : 0)
  return {
    regime: "risk-based" as const,
    ratioLabel: "Total risk-based capital",
    levels: [
      {
        value: ADEQUATE_RBC,
        label: "8% adequately capitalised",
        consequence: "Below this the institution is no longer adequately capitalised under PCA.",
      },
    ],
    capital,
    denominator: riskWeightedAssets,
    // Prefer FDIC's published ratio; the computed one matches it but the
    // published figure is the one an underwriter can look up and check.
    baseRatio: positive(totalRbcRatio) ? totalRbcRatio : (capital / riskWeightedAssets) * 100,
  }
}

function buildLeverage(input: DownsideInput) {
  const { tier1Dollars, leverageRatio } = input
  if (!positive(leverageRatio) || !positive(tier1Dollars)) return null
  // Average assets, backed out of the published ratio rather than taken from
  // period-end ASSET, so the base case equals RBC1AAJ exactly.
  const averageAssets = tier1Dollars / (leverageRatio / 100)
  return {
    regime: "leverage" as const,
    ratioLabel: "Tier 1 leverage",
    // Binding level first. The CBLR trigger is the nearer of the two and will
    // usually be hit long before the PCA floor, which is exactly why it is
    // listed second rather than used as the headline: reaching it costs the
    // institution its reporting election, not its capital adequacy.
    levels: [
      {
        value: ADEQUATE_LEVERAGE,
        label: "4% adequately capitalised",
        consequence: "Below this the institution is no longer adequately capitalised under PCA.",
      },
      {
        value: CBLR_TRIGGER,
        label: "9% CBLR election",
        consequence:
          "Below this it loses the community-bank election and must report full risk-based ratios.",
      },
    ],
    capital: tier1Dollars,
    denominator: averageAssets,
    baseRatio: leverageRatio,
  }
}
