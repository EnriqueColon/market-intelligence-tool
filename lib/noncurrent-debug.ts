/**
 * Noncurrent Debug Snapshot
 * Instruments NPL, noncurrent ratios, and reserve coverage to diagnose data integrity issues.
 * Only active when NEXT_PUBLIC_NONCURRENT_DEBUG=true.
 *
 * Field sources (FDIC API /api/financials):
 * - NPL Ratio: NALNLS / LNLSGR * 100. NALNLS=nonaccrual loans (thousands)
 * - Noncurrent/Loans: FDIC NCLNLSR. Denominator: gross loans (LNLSGR)
 * - Noncurrent/Assets: NCLNLS / ASSET. NCLNLS is a dollar amount, not a percentage.
 * - Reserve Coverage: LNATRES / LNLSGR, which reproduces FDIC's own LNATRESR.
 *   (LNLSDEPR was used here previously; it is loans-to-deposits, not a reserve.)
 * - Gross Loans: LNLSGR, or LNLSNET + LNATRES where LNLSGR was not requested
 * - Total Assets: ASSET (thousands; *1000 for dollars)
 *
 * Mirrors lib/fdic-data-transformer.ts. Keep the two in step, or this snapshot
 * reports a mismatch that is its own.
 */

import { normalizePercentToDecimal } from "./format/metrics"

function formatCurrency(value: number | null | undefined): number {
  if (value === null || value === undefined || isNaN(value)) return 0
  return value * 1000 // FDIC reports in thousands
}

/**
 * Unit detection for NCLNLSR, which is a genuine percent field.
 * value<=1 => decimal | 1<value<=100 => percent | >100 => invalid
 *
 * Not applicable to NCLNLS, which holds thousands of dollars.
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
    LNATRES?: number
    P9ASSET?: number
    /** Noncurrent loan dollars: NCLNLS directly, or NCLNLSR% * gross loans. */
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
    NCLNLS: { raw: number; units: "thousands_of_dollars" }
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
  const lnatresRaw = Number(raw.LNATRES ?? 0)

  const totalAssets = formatCurrency(assetRaw)
  // LNLSGR where available, else net plus the allowance, which reproduces it.
  const grossLoansThousands = Number(raw.LNLSGR ?? 0) > 0 ? Number(raw.LNLSGR) : lnlsnetRaw + lnatresRaw
  const grossLoans = grossLoansThousands * 1000
  const nonAccrualLoans = nalnlsRaw * 1000

  // NPL Ratio: NALNLS / gross loans, stored as decimal (0.008 = 0.8%)
  const nplRatioDecimal = grossLoans > 0 ? nonAccrualLoans / grossLoans : 0

  // Noncurrent to loans: NCLNLSR. FDIC (% ) = percent points. Stored as decimal.
  const noncurrentToLoansDecimal = normalizePercentToDecimal(nclnlsrRaw, "NCLNLSR") ?? 0

  // Noncurrent to assets: NCLNLS is dollars, so this is a plain dollar ratio.
  // Falls back to the reported ratio rescaled onto assets when NCLNLS is absent.
  let noncurrentToAssetsDecimal = 0
  if (Number.isFinite(nclnlsRaw) && nclnlsRaw !== 0 && assetRaw > 0) {
    noncurrentToAssetsDecimal = nclnlsRaw / assetRaw
  } else if (assetRaw > 0 && grossLoansThousands > 0) {
    const ntl = normalizePercentToDecimal(nclnlsrRaw, "NCLNLSR") ?? 0
    noncurrentToAssetsDecimal = ntl * (grossLoansThousands / assetRaw)
  }
  noncurrentToAssetsDecimal = Math.min(1, Math.max(0, noncurrentToAssetsDecimal))

  // Reserve coverage: the allowance over gross loans, both in thousands.
  // LNLSDEPR was used here previously; it is loans-to-deposits, not a reserve.
  const reserveCoverageDecimal = grossLoansThousands > 0 ? lnatresRaw / grossLoansThousands : 0

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
      npl_ratio: "NALNLS / LNLSGR * 100. FDIC: NALNLS (nonaccrual, thousands), LNLSGR (gross loans, thousands)",
      noncurrent_to_loans: "FDIC NCLNLSR. Denominator: gross loans (LNLSGR).",
      noncurrent_to_assets: "NCLNLS / ASSET. NCLNLS is dollars (= P9LNLS + NALNLS), not a percentage.",
      reserve_coverage: "FDIC LNATRES / LNLSGR. Numerator: ALLL, Denominator: gross loans. Reproduces LNATRESR.",
      gross_loans: "LNLSGR, else LNLSNET + LNATRES (thousands; *1000 for dollars). Denominator for NCLNLSR.",
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
      LNATRES: lnatresRaw,
      P9ASSET: raw.P9ASSET != null ? Number(raw.P9ASSET) : undefined,
      noncurrent_loan_amount_derived:
        nclnlsRaw !== 0
          ? nclnlsRaw * 1000
          : grossLoansThousands > 0 && nclnlsrRaw !== 0
            ? (normalizePercentToDecimal(nclnlsrRaw) ?? 0) * grossLoansThousands * 1000
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
        numerator_note: "ALLL (Allowance for Loan and Lease Losses), FDIC LNATRES, over gross loans LNLSGR.",
        denominator_note: "LNLSGR (Gross Loans & Leases, thousands).",
      },
      gross_loans_dollars: grossLoans,
      total_assets_dollars: totalAssets,
    },
    display: {
      npl_ratio_pct: nplDisplay,
      noncurrent_to_loans_pct: noncurrentLoansDisplay,
      noncurrent_to_assets_pct: noncurrentAssetsDisplay,
      reserve_coverage_pct: reserveDisplay,
    },
    unit_detection: {
      NCLNLS: { raw: nclnlsRaw, units: "thousands_of_dollars" },
      NCLNLSR: { raw: nclnlsrRaw, branch: detectUnit(nclnlsrRaw) },
    },
  }
}
