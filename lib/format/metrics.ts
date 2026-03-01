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
 * - null/undefined => null
 * - raw <= 1: 0.795 => decimal 0.00795
 * - 1 < raw <= 100: 79.5 => decimal 0.795
 * - raw > 100: divide by 100, log warning (possible basis points)
 */
export function normalizePercentToDecimal(
  rawValue: number | null | undefined,
  _fieldName?: string
): number | null {
  if (rawValue === null || rawValue === undefined || !Number.isFinite(rawValue)) return null
  const decimal = rawValue / 100
  if (rawValue > 100 && process.env.NODE_ENV === "development") {
    console.warn(
      `[metrics] FDIC percent field raw=${rawValue} > 100; treating as basis points. decimal=${decimal}`
    )
  }
  return decimal
}

/**
 * Normalize a raw percent value to percent units (1.25 = 1.25%).
 * FDIC API may return decimal (0.0125), percent units (1.25), or basis points (125).
 * Used for ROA, NIM, capital ratios (displayed as percent, not stored as decimal).
 *
 * Heuristics:
 * - value > 100: likely basis points or double-scaled → divide by 100
 * - 0 < value <= 1: likely decimal ratio (0.0125 = 1.25%) → multiply by 100
 * - 1 < value <= 100: assume already percent units
 * - value <= 0: return as-is (negative ROA/NIM possible)
 */
export function normalizePercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  if (value > 100) return value / 100
  if (value > 0 && value <= 1) return value * 100
  return value
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
