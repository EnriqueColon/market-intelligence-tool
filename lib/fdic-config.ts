/**
 * FDIC API Configuration
 * Reference: https://api.fdic.gov/banks/docs
 */

export const FDIC_CONFIG = {
  // Server-side FDIC endpoint override (optional for production).
  baseUrl: process.env.FDIC_API_URL || 'https://banks.data.fdic.gov',
  // Server-only credential. Do not expose as NEXT_PUBLIC_*.
  apiKey: process.env.FDIC_API_KEY || null, // Currently not required, but prepared for future
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
    'LNRENRES', // Non-Residential Real Estate Loans
    'LNREOTH', // All other loans secured by real estate (RCFD5371; unclassified CRE)
    'LNREDOM', // 1-4 Family Residential Loans
    'UCLN', // Unused Loan Commitments (total)
    'UCCOMRE', // Unused Commitments: Commercial Real Estate, Construction & Land Development
    'LNLSNET', // Net Loans & Leases
    'P3ASSET', // Past Due 30-89 Days / Total Assets
    'P9ASSET', // Past Due 90+ Days / Total Assets
    'NALNLS', // Nonaccrual Loans & Leases
    'NCLNLSR', // Noncurrent Loans to Loans (past due 90+ + nonaccrual as % of gross loans)
    'NCLNLS', // Noncurrent Loans to Assets (past due 90+ + nonaccrual as % of total assets)
    'ROA', // Return on Assets
    'ROE', // Return on Equity
    'EEFFR', // Efficiency Ratio
    'NIMR', // Net Interest Income Ratio
    'LNLSDEPR', // Loan Loss Reserve / Total Loans
    'NETINC', // Net Income
    'RBCT1CER', // Common Equity Tier 1 Ratio
    'RBC1AAJ', // Leverage Ratio (PCA)
    'RBC1RWAJ', // Tier 1 Risk-Based Capital Ratio (PCA)
    'RBCRWAJ', // Total Risk-Based Capital Ratio (PCA)
    'EQCAP', // Total Equity Capital (thousands) - if available
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

