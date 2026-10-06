/**
 * One institution's last eight quarters, shaped for the drawer's trend panels.
 *
 * The Deteriorating list says *that* a bank is slipping; this shows *how*. It
 * is fetched per institution when the drawer opens rather than carried on the
 * screening row, because eight quarters of a dozen metrics for a thousand
 * banks would not fit the 2MB data-cache ceiling the table lives under, and a
 * single bank's history is a sub-second FDIC call that caches by itself.
 *
 * Every value is in **percent points**, whatever the FDIC publishes it as, so
 * the panels share one formatter. Missing values are `null`, never zero: a
 * CBLR filer reports no risk-based ratios, and plotting a zero would draw a
 * capital collapse that did not happen.
 *
 * The verdict reuses the signal detector behind Cohort Changes
 * (`lib/analytics/cohort-watch.ts`), so the sentence above the panels agrees
 * with the list that sent the reader here.
 */

import { classifyCapital, type CapitalCategory } from "@/lib/scoring/capital-category"
import { formatQuarter } from "@/lib/scoring/quarter"
import { normalizeReportDate } from "@/lib/analytics/headline-filing"
import { watchInstitution, type WatchInputRow } from "@/lib/analytics/cohort-watch"

/** What the trend needs per quarter, beyond `WatchInputRow`. */
export type TrendInputRow = WatchInputRow & {
  nplRatio?: number
  roa?: number
  netInterestMargin?: number
}

export type TrendPoint = {
  /** `YYYYMMDD`. */
  quarter: string
  /** `Q2 2026`. */
  label: string
  /** Noncurrent loans ÷ gross loans. */
  noncurrentPct: number | null
  /** Nonaccrual loans ÷ gross loans. */
  nplPct: number | null
  leveragePct: number | null
  cet1Pct: number | null
  totalRbcPct: number | null
  /** CRE ÷ (Tier 1 + Tier 2); 300 means 300%. */
  creToCapitalPct: number | null
  constructionToCapitalPct: number | null
  /** Allowance ÷ gross loans. */
  reservePct: number | null
  roaPct: number | null
  nimPct: number | null
  capital: { category: CapitalCategory; label: string } | null
}

export type TrendVerdict = {
  tone: "deteriorating" | "watch" | "stable" | "insufficient"
  /** Short heading: "Deteriorating", "Watch", "Stable", "Too little history". */
  heading: string
  /** One or two sentences. */
  text: string
}

export type InstitutionTrend = {
  cert: string
  name: string
  /** Oldest first, at most eight. */
  points: TrendPoint[]
  verdict: TrendVerdict
  /** True when no quarter reported a risk-based ratio: the capital panel is leverage only. */
  leverageOnly: boolean
}

export const TREND_QUARTERS = 8

const pct = (decimal: number | null | undefined): number | null =>
  typeof decimal === "number" && Number.isFinite(decimal) ? decimal * 100 : null

/** Percent points already; zero is how an absent ratio arrives. */
const points = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value !== 0 ? value : null

function toPoint(row: TrendInputRow): TrendPoint {
  const quarter = normalizeReportDate(row.reportDate)
  const classified = classifyCapital({
    leverageRatio: row.leverageRatio,
    tier1RbcRatio: row.tier1RbcRatio,
    totalRbcRatio: row.totalRbcRatio,
    cet1Ratio: row.cet1Ratio,
    equityToAssetsPct:
      row.totalEquityDollars != null && row.totalAssets > 0 ? (row.totalEquityDollars / row.totalAssets) * 100 : null,
  })
  return {
    quarter,
    label: formatQuarter(quarter),
    noncurrentPct: pct(row.noncurrent_to_loans_ratio),
    nplPct: pct(row.nplRatio),
    leveragePct: points(row.leverageRatio),
    cet1Pct: points(row.cet1Ratio),
    totalRbcPct: points(row.totalRbcRatio),
    creToCapitalPct: pct(row.creToTier1Tier2),
    constructionToCapitalPct: pct(row.constructionToTier1Tier2),
    // Zero reserves is a reporting gap, not a figure (see cohort-watch.ts).
    reservePct: row.loanLossReserve ? pct(row.loanLossReserve) : null,
    roaPct: typeof row.roa === "number" && Number.isFinite(row.roa) ? row.roa : null,
    nimPct: points(row.netInterestMargin),
    capital: classified ? { category: classified.category, label: classified.label } : null,
  }
}

/** Strip the trailing period so sentences can be joined with semicolons. */
const clause = (sentence: string) => sentence.replace(/\.$/, "")

function verdictFor(rows: TrendInputRow[], points: TrendPoint[]): TrendVerdict {
  if (points.length < 2) {
    return {
      tone: "insufficient",
      heading: "Too little history",
      text: `Only ${points.length} quarter${points.length === 1 ? "" : "s"} on file, so no trend can be read.`,
    }
  }
  const span = `${points[0].label}–${points[points.length - 1].label}`
  const item = watchInstitution(rows)
  if (!item) {
    return {
      tone: "stable",
      heading: "Stable",
      text: `No adverse signal across ${points.length} quarters (${span}): no capital-category change, no threshold crossed, no metric moving the wrong way for three quarters running.`,
    }
  }
  // "Deteriorating" is reserved for a capital-category downgrade, or a
  // supervisory crossing that is corroborated by at least one other signal.
  // A lone crossing at an otherwise well-capitalised bank is "Watch".
  const capitalDowngrade = item.signals.some((s) => s.kind === "capital")
  const supervisoryCrossing = item.signals.some((s) => s.kind === "crossing" && s.supervisory)
  const urgent = capitalDowngrade || (supervisoryCrossing && item.signals.length >= 2)
  const lead = item.signals.slice(0, 2).map((s) => clause(s.description))
  const rest = item.signals.length - lead.length
  return {
    tone: urgent ? "deteriorating" : "watch",
    heading: urgent ? "Deteriorating" : "Watch",
    text: `${lead.join("; ")}${rest > 0 ? `; and ${rest} more signal${rest === 1 ? "" : "s"}` : ""}.`,
  }
}

/**
 * Build the trend from an institution's quarters in any order. Keeps the
 * newest `TREND_QUARTERS`, oldest first for plotting.
 */
export function buildInstitutionTrend(cert: string, rows: TrendInputRow[]): InstitutionTrend {
  const byQuarter = new Map<string, TrendInputRow>()
  for (const row of rows) {
    const q = normalizeReportDate(row.reportDate)
    if (q) byQuarter.set(q, row)
  }
  const ordered = Array.from(byQuarter.keys()).sort().slice(-TREND_QUARTERS)
  const kept = ordered.map((q) => byQuarter.get(q)!)
  const trendPoints = kept.map(toPoint)
  const leverageOnly = trendPoints.every((p) => p.cet1Pct == null && p.totalRbcPct == null)
  return {
    cert,
    name: kept[kept.length - 1]?.name ?? rows[0]?.name ?? "",
    points: trendPoints,
    verdict: verdictFor(kept, trendPoints),
    leverageOnly,
  }
}
