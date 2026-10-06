/**
 * Prompt Corrective Action capital categories.
 *
 * The regulators' own answer to "how much capital is enough": 12 CFR 324.403
 * sorts every insured bank into one of five categories each quarter, and the
 * category decides what the supervisor must do — nothing, restrict dividends,
 * demand a capital plan, or close the bank. Community Bank & Trust - West
 * Georgia reported a 0.16% leverage ratio for March 2026 and was closed on
 * 1 May; the category said so a month before the closure did.
 *
 * The thresholds here are the published ones, not working conventions:
 *
 *   | Category                      | Total RBC | Tier 1 RBC | CET1   | Leverage |
 *   | well capitalised              | ≥ 10%     | ≥ 8%       | ≥ 6.5% | ≥ 5%     |
 *   | adequately capitalised        | ≥ 8%      | ≥ 6%       | ≥ 4.5% | ≥ 4%     |
 *   | undercapitalised              | < 8%      | < 6%       | < 4.5% | < 4%     |
 *   | significantly undercapitalised| < 6%      | < 4%       | < 3%   | < 3%     |
 *   | critically undercapitalised   | tangible equity ÷ total assets ≤ 2%      |
 *
 * A bank must clear *every* ratio to sit in a category, so the binding ratio is
 * the weakest one, and that is what `binding` reports.
 *
 * Two things the Call Report forces us to handle:
 *
 *  - **CBLR filers** (community banks that elected the Community Bank Leverage
 *    Ratio) report no risk-based ratios at all — the fields arrive as 0 or
 *    absent — and are treated as well capitalised while their leverage ratio is
 *    at or above 9%. We classify them on the leverage ratio alone and say so in
 *    `basis`, so a missing ratio never reads as a zero one.
 *  - **Critically undercapitalised** is defined on tangible equity, which the
 *    Call Report does not carry directly. Total equity over total assets is the
 *    nearest reported figure and is used when available; the leverage ratio
 *    (Tier 1 over average assets) is the fallback, since Tier 1 is never larger
 *    than tangible equity by much.
 *
 * Ratios are in percent points, as the FDIC publishes them.
 */

export type CapitalCategory = "well" | "adequate" | "under" | "significant" | "critical"

export type CapitalInput = {
  /** Tier 1 leverage ratio (`RBC1AAJ`). */
  leverageRatio?: number | null
  /** Tier 1 risk-based capital ratio (`RBC1RWAJ`). */
  tier1RbcRatio?: number | null
  /** Total risk-based capital ratio (`RBCRWAJ`). */
  totalRbcRatio?: number | null
  /** Common equity tier 1 ratio (`RBCT1CER`). */
  cet1Ratio?: number | null
  /** Total equity ÷ total assets, in percent points, for the critical test. */
  equityToAssetsPct?: number | null
}

export type CapitalClassification = {
  category: CapitalCategory
  /** "Well capitalised", for display. */
  label: string
  /** Which ratios were available to classify on. */
  basis: "risk-based" | "leverage-only"
  /** The ratio holding the bank in this category, e.g. "leverage 3.80%". */
  binding: string
}

/** Ordinal severity, so categories can be compared: higher is worse. */
export const CATEGORY_RANK: Record<CapitalCategory, number> = {
  well: 0,
  adequate: 1,
  under: 2,
  significant: 3,
  critical: 4,
}

export const CATEGORY_LABEL: Record<CapitalCategory, string> = {
  well: "Well capitalised",
  adequate: "Adequately capitalised",
  under: "Undercapitalised",
  significant: "Significantly undercapitalised",
  critical: "Critically undercapitalised",
}

/** Leverage ratio at or above which a CBLR filer is well capitalised. */
export const CBLR_WELL_CAPITALISED = 9

const CRITICAL_TANGIBLE_EQUITY = 2

type Ratio = { name: string; value: number; well: number; adequate: number; significant: number }

/** A reported ratio: finite and non-zero. Zero is how an absent ratio arrives. */
function reported(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0
}

function categoryFor(ratio: Ratio): CapitalCategory {
  if (ratio.value >= ratio.well) return "well"
  if (ratio.value >= ratio.adequate) return "adequate"
  if (ratio.value >= ratio.significant) return "under"
  return "significant"
}

const fmt = (v: number) => `${v.toFixed(2)}%`

/**
 * Classify one quarter's capital position. Returns `null` when no capital
 * ratio was reported at all, which is a gap in the filing rather than a
 * category.
 */
export function classifyCapital(input: CapitalInput): CapitalClassification | null {
  const ratios: Ratio[] = []
  if (reported(input.totalRbcRatio))
    ratios.push({ name: "total risk-based", value: input.totalRbcRatio, well: 10, adequate: 8, significant: 6 })
  if (reported(input.tier1RbcRatio))
    ratios.push({ name: "Tier 1 risk-based", value: input.tier1RbcRatio, well: 8, adequate: 6, significant: 4 })
  if (reported(input.cet1Ratio))
    ratios.push({ name: "CET1", value: input.cet1Ratio, well: 6.5, adequate: 4.5, significant: 3 })

  const riskBased = ratios.length > 0
  const leverage = reported(input.leverageRatio) ? input.leverageRatio : null
  if (leverage == null && !riskBased) return null

  // Critically undercapitalised overrides everything else.
  const tangible = reported(input.equityToAssetsPct) ? input.equityToAssetsPct : leverage
  if (tangible != null && tangible <= CRITICAL_TANGIBLE_EQUITY) {
    const name = reported(input.equityToAssetsPct) ? "equity to assets" : "leverage"
    return {
      category: "critical",
      label: CATEGORY_LABEL.critical,
      basis: riskBased ? "risk-based" : "leverage-only",
      binding: `${name} ${fmt(tangible)}`,
    }
  }

  if (!riskBased) {
    // CBLR filer, or a filing with only the leverage ratio present.
    const lev = leverage as number
    const category: CapitalCategory =
      lev >= CBLR_WELL_CAPITALISED ? "well" : lev >= 5 ? "well" : lev >= 4 ? "adequate" : lev >= 3 ? "under" : "significant"
    return { category, label: CATEGORY_LABEL[category], basis: "leverage-only", binding: `leverage ${fmt(lev)}` }
  }

  if (leverage != null) ratios.push({ name: "leverage", value: leverage, well: 5, adequate: 4, significant: 3 })

  let worst: { category: CapitalCategory; ratio: Ratio } | null = null
  for (const ratio of ratios) {
    const category = categoryFor(ratio)
    if (!worst || CATEGORY_RANK[category] > CATEGORY_RANK[worst.category]) worst = { category, ratio }
  }
  const { category, ratio } = worst!
  return {
    category,
    label: CATEGORY_LABEL[category],
    basis: "risk-based",
    binding: `${ratio.name} ${fmt(ratio.value)}`,
  }
}

/**
 * Sentence for a move between categories, or `null` when the category did not
 * worsen. Improvements are not reported: this feeds a deterioration list.
 */
export function describeCapitalDowngrade(
  previous: CapitalClassification | null,
  latest: CapitalClassification | null
): string | null {
  if (!previous || !latest) return null
  if (CATEGORY_RANK[latest.category] <= CATEGORY_RANK[previous.category]) return null
  return `Capital category fell from ${previous.label.toLowerCase()} to ${latest.label.toLowerCase()} (${latest.binding}).`
}
