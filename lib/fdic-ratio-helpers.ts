/**
 * FDIC-derived capital-based CRE risk ratios.
 * Uses existing FDIC financial data (ratios + dollar amounts).
 * Capital dollar amounts are derived from regulatory ratios when not directly available.
 */

/**
 * RWA as fraction of total assets, used only when FDIC does not report RWAJ.
 *
 * This proxy overstates risk-weighted assets for most banks, which inflates the
 * derived capital base and so understates CRE-to-capital — 394% against a true
 * 443% on a sample Florida bank. Reported RBCT1J, RBCT2 and RWAJ are preferred
 * wherever present; they reconcile to FDIC's published RBCRWAJ exactly.
 */
const RWA_TO_ASSETS_PROXY = 0.75

export type CapitalCoverage = {
  hasTier1: boolean
  hasTier2: boolean
  hasTier1Tier2: boolean
  hasEquity: boolean
}

export type CapitalRatios = {
  tier1Capital: number | null
  tier2Capital: number | null
  tier1PlusTier2Capital: number | null
  totalEquity: number | null
  creToTier1Tier2: number | null
  creToEquity: number | null
  constructionToTier1Tier2: number | null
  multifamilyToTier1Tier2: number | null
  coverage: CapitalCoverage
  /** Whether the capital base is FDIC-reported or inferred from ratios. */
  basis: CapitalBasis
}

type FinancialInput = {
  totalAssets: number
  creLoans: number
  constructionLoans: number
  multifamilyLoans: number
  leverageRatio?: number
  tier1RbcRatio?: number
  totalRbcRatio?: number
  cet1Ratio?: number
  /** Total equity capital in dollars (if available from API) */
  totalEquityDollars?: number | null
  /** Reported Tier 1 capital in dollars (FDIC RBCT1J) */
  tier1Dollars?: number | null
  /** Reported Tier 2 capital in dollars (FDIC RBCT2) */
  tier2Dollars?: number | null
  /** Reported risk-weighted assets in dollars (FDIC RWAJ) */
  riskWeightedAssets?: number | null
}

/** True when the capital base came from reported dollars rather than a proxy. */
export type CapitalBasis = "reported" | "derived" | "none"

const positive = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 0

/**
 * Derive Tier 1 capital from leverage ratio.
 * Leverage ratio (PCA) = Tier 1 Capital / Total Exposure (≈ Total Assets).
 * FDIC reports ratio as percentage (e.g. 8.5 for 8.5%).
 */
function deriveTier1Capital(leverageRatio: number, totalAssets: number): number {
  if (!Number.isFinite(leverageRatio) || !Number.isFinite(totalAssets) || totalAssets <= 0) return 0
  return (leverageRatio / 100) * totalAssets
}

/**
 * Derive Tier 1 + Tier 2 capital from the total RBC ratio.
 * Total RBC = (Tier1 + Tier2) / RWA, so (Tier1+Tier2) = totalRbcRatio * RWA.
 * Uses reported RWA when available and only then falls back to the proxy.
 */
function deriveTier1PlusTier2(
  totalRbcRatio: number,
  totalAssets: number,
  riskWeightedAssets?: number | null
): number {
  if (!Number.isFinite(totalRbcRatio)) return 0
  const rwa = positive(riskWeightedAssets)
    ? riskWeightedAssets
    : Number.isFinite(totalAssets) && totalAssets > 0
      ? RWA_TO_ASSETS_PROXY * totalAssets
      : 0
  if (rwa <= 0) return 0
  return (totalRbcRatio / 100) * rwa
}

/**
 * Compute capital-based CRE risk ratios from FDIC financial data.
 * Returns null for ratios when denominator is missing or zero.
 */
export function computeCapitalRatios(input: FinancialInput): CapitalRatios {
  const {
    totalAssets,
    creLoans,
    constructionLoans,
    multifamilyLoans,
    leverageRatio,
    tier1RbcRatio,
    totalRbcRatio,
    cet1Ratio,
    totalEquityDollars,
    tier1Dollars,
    tier2Dollars,
    riskWeightedAssets,
  } = input

  const tier1Capital = positive(tier1Dollars)
    ? tier1Dollars
    : leverageRatio != null && Number.isFinite(leverageRatio)
      ? deriveTier1Capital(leverageRatio, totalAssets)
      : null

  // Tier 2 is legitimately zero at many small banks, so presence is tested
  // rather than positivity — otherwise their capital base silently falls back
  // to the proxy.
  const tier2Capital: number | null =
    tier2Dollars != null && Number.isFinite(tier2Dollars) ? tier2Dollars : null

  const reportedTotalCapital =
    positive(tier1Dollars) && tier2Capital != null ? tier1Dollars + tier2Capital : null

  const capitalBasis: CapitalBasis = reportedTotalCapital
    ? "reported"
    : totalRbcRatio != null && Number.isFinite(totalRbcRatio)
      ? "derived"
      : tier1Capital != null
        ? "derived"
        : "none"

  const tier1PlusTier2Capital =
    reportedTotalCapital ??
    (totalRbcRatio != null && Number.isFinite(totalRbcRatio)
      ? deriveTier1PlusTier2(totalRbcRatio, totalAssets, riskWeightedAssets)
      : tier1Capital)

  const totalEquity =
    totalEquityDollars != null && Number.isFinite(totalEquityDollars) && totalEquityDollars > 0
      ? totalEquityDollars
      : tier1Capital

  const hasTier1 = tier1Capital != null && tier1Capital > 0
  const hasTier2 = tier2Capital != null && tier2Capital > 0
  const hasTier1Tier2 = tier1PlusTier2Capital != null && tier1PlusTier2Capital > 0
  const hasEquity = totalEquity != null && totalEquity > 0

  const creToTier1Tier2 =
    hasTier1Tier2 && creLoans > 0 ? creLoans / tier1PlusTier2Capital! : null

  const creToEquity =
    hasEquity && creLoans > 0 ? creLoans / totalEquity! : null

  const constructionToTier1Tier2 =
    hasTier1Tier2 && constructionLoans > 0 ? constructionLoans / tier1PlusTier2Capital! : null

  const multifamilyToTier1Tier2 =
    hasTier1Tier2 && multifamilyLoans > 0 ? multifamilyLoans / tier1PlusTier2Capital! : null

  return {
    tier1Capital,
    tier2Capital,
    tier1PlusTier2Capital: tier1PlusTier2Capital ?? null,
    totalEquity: totalEquity ?? null,
    creToTier1Tier2,
    creToEquity,
    constructionToTier1Tier2,
    multifamilyToTier1Tier2,
    coverage: { hasTier1, hasTier2, hasTier1Tier2, hasEquity },
    basis: capitalBasis,
  }
}

export type CoverageSummary = {
  tier1Pct: number
  tier2Pct: number
  tier1Tier2Pct: number
  equityPct: number
}

/**
 * Compute coverage summary (% of cohort with each capital field) for a list of CapitalRatios.
 */
export function computeCoverageSummary(ratios: { coverage: CapitalCoverage }[]): CoverageSummary {
  const n = ratios.length
  if (n === 0) return { tier1Pct: 0, tier2Pct: 0, tier1Tier2Pct: 0, equityPct: 0 }
  const tier1 = ratios.filter((r) => r.coverage.hasTier1).length
  const tier2 = ratios.filter((r) => r.coverage.hasTier2).length
  const tier1Tier2 = ratios.filter((r) => r.coverage.hasTier1Tier2).length
  const equity = ratios.filter((r) => r.coverage.hasEquity).length
  return {
    tier1Pct: (tier1 / n) * 100,
    tier2Pct: (tier2 / n) * 100,
    tier1Tier2Pct: (tier1Tier2 / n) * 100,
    equityPct: (equity / n) * 100,
  }
}
