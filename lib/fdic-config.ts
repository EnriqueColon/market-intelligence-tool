/**
 * FDIC API Configuration
 * Reference: https://api.fdic.gov/banks/docs
 */

export const FDIC_CONFIG = {
  // Server-side FDIC endpoint override (optional for production).
  baseUrl: process.env.FDIC_API_URL || 'https://banks.data.fdic.gov',
  // Fallback host used when the primary host has transient DNS/network issues.
  fallbackBaseUrls: [
    'https://api.fdic.gov/banks',
  ],
  // Server-only credential. Do not expose as NEXT_PUBLIC_*.
  apiKey: process.env.FDIC_API_KEY || process.env.NEXT_PUBLIC_FDIC_API_KEY || null,
  defaultLimit: 100,
  cacheTimeout: 3600000, // 1 hour in milliseconds
  defaultFormat: 'json' as const,
}

export const FDIC_ENDPOINTS = {
  financials: '/api/financials',
  institutions: '/api/institutions',
  failures: '/api/failures',
  locations: '/api/locations',
  history: '/api/history',
  summary: '/api/summary',
  sod: '/api/sod',
  demographics: '/api/demographics',
} as const

/**
 * FDIC API Field Definitions
 * Based on FDIC API documentation
 */
export const FDIC_FIELDS = {
  financials: [
    'CERT', // Certificate Number
    'NAME', // Institution Name
    'REPDTE', // Report Date
    'ASSET', // Total Assets
    'DEP', // Total Deposits
    'LNRE', // Total Real Estate Loans
    'LNRECONS', // Construction & Land Development Loans
    'LNREMULT', // Multifamily Real Estate Loans
    'LNRENRES', // Non-Residential Real Estate Loans (owner- and non-owner-occupied)
    'LNRENROW', // Non-Residential, OWNER-occupied — excluded from the 300% CRE screen
    'LNRENROT', // Non-Residential, NON-owner-occupied — the CRE half of LNRENRES
    // Closed-end 1-4 family residential, despite FDIC glossing it as "all other
    // loans secured by real estate". LNRERES - LNRELOC = LNREOTH exactly on all
    // 4,352 institutions, so it is residential lending sitting inside LNRERES,
    // not a commercial category. Do NOT add to CRE: it double-counts, and it is
    // not CRE in the first place. See fdic-cre.ts.
    'LNREOTH',
    // LNREDOM is every real estate loan in domestic offices, equal to LNRE on
    // 4,335 of 4,352 institutions. It is not the 1-4 family figure; LNRERES is.
    'LNREDOM',
    'LNRERES', // 1-4 Family Residential Loans (revolving LNRELOC + closed-end LNREOTH)
    'UCLN', // Unused Loan Commitments (total)
    'UCCOMRE', // Unused Commitments: Commercial Real Estate, Construction & Land Development
    'LNLSNET', // Net Loans & Leases (gross minus the allowance)
    // Gross loans and leases: the denominator FDIC uses for every one of its own
    // loan-quality ratios. LNLSNET + LNATRES = LNLSGR on all 4,352 institutions.
    'LNLSGR',
    // Dollar amounts in thousands, not ratios, despite the suffix. They cover all
    // past-due assets, so they are >= the loan-only P3LNLS/P9LNLS everywhere.
    'P3ASSET', // Assets Past Due 30-89 Days (thousands)
    'P9ASSET', // Assets Past Due 90+ Days (thousands)
    'NALNLS', // Nonaccrual Loans & Leases
    'NCLNLSR', // Noncurrent Loans to Loans (past due 90+ + nonaccrual as % of gross loans)
    // Dollars, not a percentage: NCLNLS = P9LNLS + NALNLS exactly on all 4,352
    // institutions. JPMorgan Chase reports 12,861,000, meaning $12.9bn.
    'NCLNLS', // Noncurrent Loans & Leases (thousands)
    'LNATRES', // Allowance for Loan and Lease Losses (dollars, thousands) — the real reserve
    'ROA', // Return on Assets
    'ROE', // Return on Equity
    'EEFFR', // Efficiency Ratio
    'NIMR', // Net Interest Income Ratio
    'LNLSDEPR', // Net loans and leases to deposits (%). Not a reserve — see LNATRES
    'NETINC', // Net Income
    'RBCT1CER', // Common Equity Tier 1 Ratio
    'RBC1AAJ', // Leverage Ratio (PCA)
    'RBC1RWAJ', // Tier 1 Risk-Based Capital Ratio (PCA)
    'RBCRWAJ', // Total Risk-Based Capital Ratio (PCA)
    // Reported capital and risk-weighted assets in dollars. (RBCT1J + RBCT2) / RWAJ
    // reproduces FDIC's own RBCRWAJ exactly, so these give a true denominator
    // for CRE-to-capital rather than a ratio times an assumed risk weighting.
    'RBCT1J', // Tier 1 Capital (thousands)
    'RBCT2', // Tier 2 Capital (thousands)
    'RWAJ', // Risk-Weighted Assets (thousands)
    // EQTOT, not EQCAP: EQCAP is not a field this endpoint serves and returned
    // nothing on every request, so CRE/Equity silently fell back to Tier 1.
    // EQTOT = ASSET - LIAB on all 4,352 institutions. (EQ is bank-only equity,
    // excluding noncontrolling interests, and misses the identity on 93 of them.)
    'EQTOT', // Total Equity Capital (thousands)
    'STNAME', // State Name
    'CITY', // City
  ],
  institutions: [
    'CERT',
    'NAME',
    'CITY',
    'STNAME',
    'ASSET',
    'DEP',
    'NETINC',
    'ROA',
    'ROE',
    'DATEUPDT',
    'ACTIVE',
  ],
  failures: [
    'CERT',
    'NAME',
    'CITY',
    'CITYST',
    'PSTALP',
    'FAILDATE',
    'FAILYR',
    'RESDATE',
    'COST',
    'RESTYPE',
    'RESTYPE1',
    'SAVR',
    'QBFDEP',
    'QBFASSET',
  ],
  locations: [
    'CERT',
    'NAME',
    'UNESSION',
    'SERVTYPE',
    'MAINOFF',
    'ADDRESS',
    'CITY',
    'STALP',
    'ZIP',
    'COUNTY',
    'CBSA_METRO_NAME',
  ],
  summary: [
    'YEAR',
    'STNAME',
    'ASSET',
    'DEP',
    'LNLSNET',
    'LNRE',
    'LNRECONS',
    'LNREMULT',
    'LNRENRES',
    'LNRERES',
    'LNREAG',
    'NETINC',
    'NIM',
    'NONII',
    'NONIX',
    'NCLNLS',
    'NALNLS',
    'P3LNLS',
    'P9LNLS',
    'ORE',
  ],
  sod: [
    'YEAR',
    'CERT',
    'NAMEFULL',
    'NAMEBR',
    'BRNUM',
    'ADDRESS',
    'CITY',
    'CITYBR',
    'CITY2BR',
    'STALP',
    'STALPBR',
    'STNAME',
    'STNAMEBR',
    'ZIP',
    'ZIPBR',
    'DEPSUM',
    'DEPSUMBR',
  ],
  demographics: [
    'CERT',
    'REPDTE',
    'CALLYM',
    'CALLYMD',
    'CBSANAME',
    'CSA',
    'CNTYNUM',
    'METRO',
    'MICRO',
    'BRANCH',
    'OFFSOD',
    'OFFTOT',
    'OFFSTATE',
    'MNRTYCDE',
    'RISKTERR',
    'FDICTERR',
  ],
} as const

