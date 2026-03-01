/**
 * Noncurrent Debug Snapshot
 * Instruments NPL, noncurrent ratios, and reserve coverage to diagnose data integrity issues.
 * Only active when NEXT_PUBLIC_NONCURRENT_DEBUG=true.
 *
 * Field sources (FDIC API /api/financials):
 * - NPL Ratio: NALNLS / LNLSNET * 100. NALNLS=nonaccrual loans (thousands), LNLSNET=net loans (thousands)
 * - Noncurrent/Loans: FDIC NCLNLSR. Denominator: gross loans (LNLSNET)
 * - Noncurrent/Assets: FDIC NCLNLS. Denominator: ASSET. Fallback: NCLNLSR * (LNLSNET/ASSET)
 * - Reserve Coverage: FDIC LNLSDEPR. Numerator: ALLL, Denominator: Total Loans (LNLSNET)
 * - Gross Loans: LNLSNET (thousands; *1000 for dollars)
 * - Total Assets: ASSET (thousands; *1000 for dollars)
 */

import { normalizePercent, normalizePercentToDecimal } from "./format/metrics"

function formatCurrency(value: number | null | undefined): number {
  if (value === null || value === undefined || isNaN(value)) return 0
  return value * 1000 // FDIC reports in thousands
}

/**
 * Unit detection for NCLNLS and NCLNLSR.
 * value<=1 => decimal | 1<value<=100 => percent | >100 => invalid
 */
function detectUnit(value: number): "decimal" | "percent" | "invalid" {
  if (!Number.isFinite(value)) return "invalid"
  if (value <= 1) return "decimal"
  if (value > 1 && value <= 100) return "percent"
  return "invalid"
}

export interface NoncurrentDebugSnapshot {
  bank: { cert: string; name: string; rssd?: string }
  quarter: string
  fdic_endpoint?: string
  field_sources: {
    npl_ratio: string
    noncurrent_to_loans: string
    noncurrent_to_assets: string
    reserve_coverage: string
    gross_loans: string
    total_assets: string
  }
  raw: {
    CERT?: string
    RSSD?: string
    REPDTE?: string
    ASSET?: number
    LNLSNET?: number
    NALNLS?: number
    NCLNLS?: number
    NCLNLSR?: number
    LNLSDEPR?: number
    P9ASSET?: number
    /** Noncurrent loan amount derived: NCLNLS% * ASSET or NCLNLSR% * LNLSNET */
    noncurrent_loan_amount_derived?: number
  }
  internal: {
    npl_ratio: { value: number; storage: "percent_points" | "decimal" }
    noncurrent_to_loans_ratio: { value: number; storage: "percent_points" | "decimal" }
    noncurrent_to_assets_ratio: { value: number; storage: "percent_points" | "decimal" }
    reserve_coverage: { value: number; storage: "percent_points" | "decimal"; numerator_note: string; denominator_note: string }
    gross_loans_dollars: number
    total_assets_dollars: number
  }
  display: {
    npl_ratio_pct: string
    noncurrent_to_loans_pct: string
    noncurrent_to_assets_pct: string
    reserve_coverage_pct: string
  }
  unit_detection: {
    NCLNLS: { raw: number; branch: "decimal" | "percent" | "invalid" }
    NCLNLSR: { raw: number; branch: "decimal" | "percent" | "invalid" }
  }
}

/**
 * Build a Noncurrent Debug Snapshot from a raw FDIC API record.
 * Mirrors the logic in fdic-data-transformer.ts for npl, noncurrent, and reserve.
 */
export function buildNoncurrentDebugSnapshot(raw: Record<string, unknown>): NoncurrentDebugSnapshot {
  const cert = String(raw.CERT ?? "")
  const name = String(raw.NAME ?? "Unknown")
  const repdte = String(raw.REPDTE ?? "")
  const assetRaw = Number(raw.ASSET ?? 0)
  const lnlsnetRaw = Number(raw.LNLSNET ?? 0)
  const nalnlsRaw = Number(raw.NALNLS ?? 0)
  const nclnlsRaw = Number(raw.NCLNLS ?? 0)
  const nclnlsrRaw = Number(raw.NCLNLSR ?? 0)
  const lnlsdeprRaw = Number(raw.LNLSDEPR ?? 0)

  const totalAssets = formatCurrency(assetRaw)
  const totalLoans = lnlsnetRaw * 1000 // LNLSNET is in thousands
  const nonAccrualLoans = nalnlsRaw * 1000

  // NPL Ratio: NALNLS / LNLSNET, stored as decimal (0.008 = 0.8%)
  const nplRatioDecimal = totalLoans > 0 ? nonAccrualLoans / totalLoans : 0

  // Noncurrent to loans: NCLNLSR. FDIC (% ) = percent points. Stored as decimal.
  const noncurrentToLoansDecimal = normalizePercentToDecimal(nclnlsrRaw, "NCLNLSR") ?? 0

  // Noncurrent to assets: NCLNLS or fallback ntl * (loans/assets) when NCLNLS missing
  let noncurrentToAssetsDecimal = 0
  if (Number.isFinite(nclnlsRaw) && nclnlsRaw !== 0) {
    noncurrentToAssetsDecimal = normalizePercentToDecimal(nclnlsRaw, "NCLNLS") ?? 0
  } else if (assetRaw > 0 && lnlsnetRaw > 0) {
    const ntl = normalizePercentToDecimal(nclnlsrRaw, "NCLNLSR") ?? 0
    noncurrentToAssetsDecimal = ntl * (lnlsnetRaw / assetRaw)
  }

  // Reserve coverage: LNLSDEPR. Stored as decimal.
  const reserveCoverageDecimal = normalizePercentToDecimal(lnlsdeprRaw, "LNLSDEPR") ?? 0

  // Display values (decimal * 100 -> percent string)
  const nplDisplay = nplRatioDecimal != null && Number.isFinite(nplRatioDecimal)
    ? (nplRatioDecimal * 100).toFixed(1) + "%"
    : "—"
  const noncurrentLoansDisplay =
    noncurrentToLoansDecimal != null && Number.isFinite(noncurrentToLoansDecimal)
      ? (noncurrentToLoansDecimal * 100).toFixed(1) + "%"
      : "—"
  const noncurrentAssetsDisplay =
    noncurrentToAssetsDecimal != null && Number.isFinite(noncurrentToAssetsDecimal)
      ? (noncurrentToAssetsDecimal * 100).toFixed(1) + "%"
      : "—"
  const reserveDisplay =
    reserveCoverageDecimal != null && Number.isFinite(reserveCoverageDecimal)
      ? (reserveCoverageDecimal * 100).toFixed(1) + "%"
      : "—"

  return {
    bank: { cert, name, rssd: raw.RSSD != null ? String(raw.RSSD) : undefined },
    quarter: repdte,
    field_sources: {
      npl_ratio: "NALNLS / LNLSNET * 100. FDIC: NALNLS (nonaccrual, thousands), LNLSNET (net loans, thousands)",
      noncurrent_to_loans: "FDIC NCLNLSR. Denominator: gross loans (LNLSNET).",
      noncurrent_to_assets: "FDIC NCLNLS. Denominator: ASSET. Fallback: NCLNLSR * (LNLSNET/ASSET).",
      reserve_coverage: "FDIC LNLSDEPR. Numerator: ALLL, Denominator: Total Loans (LNLSNET).",
      gross_loans: "LNLSNET (thousands; *1000 for dollars). Denominator for NCLNLSR.",
      total_assets: "ASSET (thousands; *1000 for dollars). Denominator for NCLNLS.",
    },
    raw: {
      CERT: raw.CERT != null ? String(raw.CERT) : undefined,
      RSSD: raw.RSSD != null ? String(raw.RSSD) : undefined,
      REPDTE: repdte || undefined,
      ASSET: assetRaw,
      LNLSNET: lnlsnetRaw,
      NALNLS: nalnlsRaw,
      NCLNLS: nclnlsRaw,
      NCLNLSR: nclnlsrRaw,
      LNLSDEPR: lnlsdeprRaw,
      P9ASSET: raw.P9ASSET != null ? Number(raw.P9ASSET) : undefined,
      noncurrent_loan_amount_derived:
        assetRaw > 0 && nclnlsRaw !== 0
          ? (normalizePercentToDecimal(nclnlsRaw) ?? 0) * assetRaw * 1000
          : lnlsnetRaw > 0 && nclnlsrRaw !== 0
            ? (normalizePercentToDecimal(nclnlsrRaw) ?? 0) * lnlsnetRaw * 1000
            : undefined,
    },
    internal: {
      npl_ratio: { value: Number(nplRatioDecimal.toFixed(4)), storage: "decimal" },
      noncurrent_to_loans_ratio: {
        value: noncurrentToLoansDecimal,
        storage: "decimal",
      },
      noncurrent_to_assets_ratio: {
        value: noncurrentToAssetsDecimal,
        storage: "decimal",
      },
      reserve_coverage: {
        value: reserveCoverageDecimal,
        storage: "decimal",
        numerator_note: "ALLL (Allowance for Loan and Lease Losses). FDIC provides LNLSDEPR = ALLL / Total Loans.",
        denominator_note: "LNLSNET (Net Loans & Leases, thousands).",
      },
      gross_loans_dollars: totalLoans,
      total_assets_dollars: totalAssets,
    },
    display: {
      npl_ratio_pct: nplDisplay,
      noncurrent_to_loans_pct: noncurrentLoansDisplay,
      noncurrent_to_assets_pct: noncurrentAssetsDisplay,
      reserve_coverage_pct: reserveDisplay,
    },
    unit_detection: {
      NCLNLS: { raw: nclnlsRaw, branch: detectUnit(nclnlsRaw) },
      NCLNLSR: { raw: nclnlsrRaw, branch: detectUnit(nclnlsrRaw) },
    },
  }
}
