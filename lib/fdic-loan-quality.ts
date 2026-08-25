/**
 * Loan-quality ratios derived from FDIC call report dollar amounts.
 *
 * Kept in its own module with no imports so it can be unit-tested directly,
 * following the pattern of lib/fdic-cre.ts.
 *
 * Every input here is an FDIC dollar amount in thousands and every output is a
 * DECIMAL (0.008 = 0.8%), matching the internal convention in
 * lib/fdic-data-transformer.ts.
 *
 * The reason this module exists is that three of these four ratios were built
 * on a field whose FDIC name reads like a ratio but holds dollars, or on a
 * denominator that disagrees with the one FDIC uses for its own published
 * version of the same ratio. Both mistakes survive a build and a unit test and
 * produce numbers that look plausible in a table.
 */

/** Ratio of two same-unit dollar amounts, guarded and clamped to [0, 1]. */
function boundedRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0
  if (denominator <= 0) return 0
  const ratio = numerator / denominator
  if (!Number.isFinite(ratio)) return 0
  return Math.min(1, Math.max(0, ratio))
}

/**
 * Gross loans and leases (FDIC LNLSGR).
 *
 * FDIC's own loan-quality ratios are all struck against gross loans, so this is
 * the denominator to use rather than LNLSNET. `LNLSNET + LNATRES` equals
 * LNLSGR on all 4,352 institutions in 2026Q1, so the sum is a safe fallback for
 * callers that did not request LNLSGR.
 */
export function resolveGrossLoans(input: {
  /** FDIC LNLSGR, thousands. Preferred when present. */
  grossLoans?: number | null
  /** FDIC LNLSNET, thousands. */
  netLoans: number
  /** FDIC LNATRES, thousands. */
  allowance: number
}): number {
  const { grossLoans, netLoans, allowance } = input
  if (grossLoans != null && Number.isFinite(grossLoans) && grossLoans > 0) return grossLoans
  const net = Number.isFinite(netLoans) ? netLoans : 0
  const res = Number.isFinite(allowance) ? allowance : 0
  const derived = net + res
  return derived > 0 ? derived : 0
}

/**
 * Noncurrent loans and leases as a share of total assets.
 *
 * **FDIC NCLNLS holds dollars, not a percentage.** The name sits next to
 * NCLNLSR, which really is a percentage, and the FDIC field list glosses it as
 * "Noncurrent Loans to Assets", so it reads like a ratio. It is not:
 * `NCLNLS == P9LNLS + NALNLS` exactly on all 4,352 institutions in 2026Q1, in
 * thousands of dollars. JPMorgan Chase reports NCLNLS = 12,861,000, meaning
 * $12.9bn of noncurrent loans, not 12.9 million percent.
 *
 * Dividing that by 100 as though it were percent points and clamping the result
 * to 100% rendered 3,398 of 4,352 institutions — 78% of the industry, including
 * every large bank — as having exactly 100.00% of assets noncurrent, when the
 * median true figure among them is 0.435%.
 */
export function computeNoncurrentToAssets(input: {
  /** FDIC NCLNLS, thousands of dollars. */
  noncurrentLoans: number
  /** FDIC ASSET, thousands of dollars. */
  totalAssets: number
}): number {
  return boundedRatio(input.noncurrentLoans, input.totalAssets)
}

/**
 * Allowance for loan and lease losses as a share of gross loans — the figure
 * shown as "Reserve Coverage".
 *
 * Struck against gross loans because that is what FDIC's own published
 * allowance ratio uses: `LNATRES / LNLSGR` reproduces LNATRESR exactly on all
 * 4,258 institutions that report it, while `LNATRES / LNLSNET` matches only
 * 1,140. Net loans are gross loans minus this very allowance, so using them
 * puts the allowance in its own denominator and overstates the coverage —
 * by up to 2.80 percentage points at reserve-heavy card lenders.
 */
export function computeReserveCoverage(input: {
  /** FDIC LNATRES, thousands of dollars. */
  allowance: number
  /** FDIC LNLSGR, thousands of dollars. */
  grossLoans: number
}): number {
  return boundedRatio(input.allowance, input.grossLoans)
}

/**
 * Nonaccrual loans and leases as a share of gross loans — the NPL ratio.
 *
 * Gross for the same reason as the allowance above, and for consistency with
 * the noncurrent ratio displayed beside it: FDIC's NCLNLSR is
 * `(P9LNLS + NALNLS) / LNLSGR`, which reconciles exactly on all 4,258
 * reporting institutions. Using net loans overstated the NPL ratio on 3,555 of
 * 4,352 institutions, and by more than 0.10 percentage points on 57 of them.
 */
export function computeNonaccrualRatio(input: {
  /** FDIC NALNLS, thousands of dollars. */
  nonaccrualLoans: number
  /** FDIC LNLSGR, thousands of dollars. */
  grossLoans: number
}): number {
  return boundedRatio(input.nonaccrualLoans, input.grossLoans)
}

/**
 * Assets past due as a share of total assets, for the 30-89 day and 90+ day
 * buckets.
 *
 * FDIC P3ASSET and P9ASSET are dollar amounts in thousands despite the "ASSET"
 * suffix, and they cover all past-due assets rather than only loans — they are
 * greater than or equal to the loan-only P3LNLS and P9LNLS on every
 * institution. Total assets is therefore the consistent denominator, and the
 * columns are labelled "/ Assets" accordingly.
 */
export function computePastDueToAssets(input: {
  /** FDIC P3ASSET or P9ASSET, thousands of dollars. */
  pastDueAssets: number
  /** FDIC ASSET, thousands of dollars. */
  totalAssets: number
}): number {
  return boundedRatio(input.pastDueAssets, input.totalAssets)
}
