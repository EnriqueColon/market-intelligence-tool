/**
 * Metric formatting utilities for FDIC financial data.
 * Internal convention: percent-type ratios stored as DECIMALS (0.008 = 0.8%, not 0.8).
 * Display: decimal * 100 -> percent string.
 */

/**
 * FDIC semantics: Fields marked "(% )" in FDIC API (NCLNLS, NCLNLSR, LNLSDEPR, etc.) are
 * percent points. E.g. NCLNLSR=0.795 means 0.795%, not 79.5%.
 */

/**
 * Convert FDIC percent-point field to decimal for internal storage.
 * FDIC "(% )" fields are percent points: 0.795 => 0.795% => decimal 0.00795.
 *
 * Divides by 100 whatever the magnitude: 0.795 => 0.00795, 79.5 => 0.795,
 * 102.5 => 1.025. There is no threshold and no inference.
 *
 * This used to warn "treating as basis points" above 100, which described a
 * rescaling it never performed and fired about thirty times per page load on
 * LNLSDEPR — a bank lending more than it takes in deposits is ordinary. A
 * warning that cries wolf on a normal value is worse than none, because it is
 * the noise a real signal has to be spotted in.
 */
export function normalizePercentToDecimal(
  rawValue: number | null | undefined,
  _fieldName?: string
): number | null {
  if (rawValue === null || rawValue === undefined || !Number.isFinite(rawValue)) return null
  return rawValue / 100
}

/**
 * Normalize an FDIC percent-unit field to percent units.
 *
 * Use this for ROA, ROE, NIMR and the four regulatory capital ratios. FDIC
 * reports all of them in percent units already, so the only correct handling
 * is to trust the value and reject non-numbers.
 *
 * **There used to be a `normalizePercent` here that guessed at the scale, and
 * both of its guesses were wrong.**
 *
 * It divided anything above 100 on the assumption that no real value is ever
 * that large. Capital ratios routinely are: 66 of 4,352 institutions reported
 * CET1 above 100% in 2026Q1, JPMorgan Chase Bank Dearborn at 506.72%, and all
 * of them rendered near 1%, so the best capitalised banks in the country
 * appeared to be the worst. Nine institutions had ROE above 100% and one had
 * ROA above 100%, distorted the same way.
 *
 * It also multiplied anything at or below 1, on the assumption that such a
 * value must be a decimal fraction. That is the more damaging half, because a
 * bank earning less than one percent on assets is the ordinary case, not an
 * edge case: 1,441 of 4,352 institutions — a third of the industry — reported
 * ROA between 0 and 1 percent, and every one was shown a hundred times too
 * high. NBH Bank's 1.00% ROA displayed as 99.98%.
 *
 * The units are not in doubt and do not need to be inferred. FDIC's ROA equals
 * `NETINC * 4 / ASSET5 * 100` on all 4,352 institutions, and its ROE equals
 * `NETINC * 4 / EQ5 * 100` on all 4,334 that report equity, both to six
 * significant figures. Percent units, always.
 */
export function normalizeFdicPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return value
}

/**
 * The four PCA capital ratios (RBCT1CER, RBC1AAJ, RBC1RWAJ, RBCRWAJ).
 *
 * No rescaling, for the reason above — a capital ratio above 100% is the case
 * most likely to tempt someone into reintroducing a heuristic.
 *
 * Zero returns null, because no operating bank has zero regulatory capital and
 * FDIC uses zero to mean "did not compute this ratio". Institutions on the
 * Community Bank Leverage Ratio framework report RBCRWAJ as a literal 0 and
 * omit RBCT1CER and RBC1RWAJ entirely — 1,765 of 4,352 as of 2026-03-31, 40.6%
 * of the industry — because electing CBLR excuses them from risk-weighting.
 * Passing that zero through rendered them at 0.00% total risk-based capital,
 * indistinguishable from a failed bank, when their median leverage ratio is
 * 11.80% and CBLR election requires at least 9%. The other 17 are branches of
 * foreign banks, which hold capital at the parent and file no US ratio at all.
 * Only 2 institutions genuinely report total risk-based capital below 8%.
 *
 * Returning null rather than zero is what lets `cet1Ratio ?? leverageRatio`
 * reach the leverage ratio, which is the figure a CBLR filer actually reports.
 */
export function normalizeCapitalRatioPercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return null
  return n
}

/**
 * Format a value in percent units to display string (e.g. 1.25 → "1.25%").
 */
export function formatPercent(valuePercentUnits: number | null | undefined, decimals = 2): string {
  if (valuePercentUnits === null || valuePercentUnits === undefined || !Number.isFinite(valuePercentUnits))
    return "—"
  return valuePercentUnits.toFixed(decimals) + "%"
}

/**
 * Format a decimal ratio (0.008 = 0.8%) for display. Use for nplRatio, noncurrent ratios, loanLossReserve.
 */
export function formatDecimalAsPercent(decimal: number | null | undefined, decimals = 2): string {
  if (decimal === null || decimal === undefined || !Number.isFinite(decimal)) return "—"
  return (decimal * 100).toFixed(decimals) + "%"
}

/**
 * Format a percentage-point delta with sign (e.g. 0.15 → "+0.15%", -0.20 → "-0.20%").
 */
export function formatDeltaPercentPoints(
  deltaPercentUnits: number | null | undefined,
  decimals = 2
): string {
  if (deltaPercentUnits === null || deltaPercentUnits === undefined || !Number.isFinite(deltaPercentUnits))
    return "—"
  const sign = deltaPercentUnits >= 0 ? "+" : ""
  return sign + deltaPercentUnits.toFixed(decimals) + "%"
}

/**
 * Format money with $ and M/B suffixes for readability.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1e9) return "$" + (value / 1e9).toFixed(1) + "B"
  if (abs >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M"
  if (abs >= 1e3) return "$" + (value / 1e3).toFixed(1) + "K"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Format a multiple (e.g. 3.2 → "3.20x").
 */
export function formatMultiple(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  return value.toFixed(2) + "x"
}

/**
 * Format CRE/Capital as x-multiple for tooltips and display.
 * Accepts value in multiple units (e.g. 9.75); if in percent (e.g. 975), pass percentValue / 100.
 */
export function formatCapitalMultiple(value: number | null | undefined): string {
  return formatMultiple(value)
}

const _warnedRoa = new Set<string>()
const _warnedNim = new Set<string>()

/**
 * Dev-only: log a warning once if ROA or NIM is unrealistically high after normalization.
 */
export function warnIfUnrealisticPercent(
  metric: "ROA" | "NIM",
  value: number,
  bankName: string,
  rawValue: number
): void {
  if (process.env.NODE_ENV !== "development") return
  const threshold = metric === "ROA" ? 10 : 20
  if (value <= threshold) return
  const key = `${metric}:${bankName}`
  const warned = metric === "ROA" ? _warnedRoa : _warnedNim
  if (warned.has(key)) return
  warned.add(key)
  console.warn(
    `[metrics] Unrealistic ${metric} (${value.toFixed(2)}%) for ${bankName}; raw FDIC value: ${rawValue}. Possible upstream scaling issue.`
  )
}
