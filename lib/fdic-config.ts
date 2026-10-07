/**
 * FDIC API Configuration
 * Reference: https://api.fdic.gov/banks/docs
 */

/**
 * Base URLs include the path prefix the endpoints hang off, because the two
 * hosts disagree about it: `api.fdic.gov` serves `/banks/financials` while
 * `banks.data.fdic.gov` serves `/api/financials`. Folding the prefix into the
 * base is what lets both work from one set of endpoint constants.
 *
 * This previously did not work. The base was the bare host and every endpoint
 * carried `/api/`, so the configured fallback resolved to
 * `api.fdic.gov/banks/api/financials`, which is a 404 — and `fetchFDICData`
 * treats 4xx as unrecoverable and stops rather than trying the next host. The
 * documented two-host protection was therefore never real; it would have turned
 * a primary-host outage into empty data rather than a retry.
 *
 * `api.fdic.gov` is primary because `banks.data.fdic.gov` now answers with a
 * 301 to it. `fetch` follows redirects, so nothing was broken by that, but it
 * cost an extra round trip on every call.
 *
 * That redirect also means the fallback is now an *alias* rather than a second
 * independent host: it points at the same place, so it will not survive an
 * api.fdic.gov outage. It is kept because it costs nothing — it is only tried
 * after a primary failure — but it should not be mistaken for redundancy.
 * `npm run verify:fdic-hosts` checks both and says so.
 */
const FDIC_DEFAULT_BASE = 'https://api.fdic.gov/banks'
const FDIC_LEGACY_BASE = 'https://banks.data.fdic.gov/api'

/** Accepts the historical override, which named the host without its prefix. */
function resolveBaseUrl(override: string | undefined): string {
  const trimmed = override?.trim().replace(/\/+$/, '')
  if (!trimmed) return FDIC_DEFAULT_BASE
  if (trimmed === 'https://banks.data.fdic.gov') return FDIC_LEGACY_BASE
  return trimmed
}

export const FDIC_CONFIG = {
  // Server-side FDIC endpoint override (optional for production).
  baseUrl: resolveBaseUrl(process.env.FDIC_API_URL),
  // Fallback host used when the primary host has transient DNS/network issues.
  fallbackBaseUrls: [FDIC_LEGACY_BASE],
  // Server-only credential. Do not expose as NEXT_PUBLIC_*.
  apiKey: process.env.FDIC_API_KEY || process.env.NEXT_PUBLIC_FDIC_API_KEY || null,
  defaultLimit: 100,
  cacheTimeout: 3600000, // 1 hour in milliseconds
  defaultFormat: 'json' as const,
}

export const FDIC_ENDPOINTS = {
  financials: '/financials',
  institutions: '/institutions',
  failures: '/failures',
  locations: '/locations',
  history: '/history',
  summary: '/summary',
  sod: '/sod',
  demographics: '/demographics',
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
  /**
   * Bank *behaviour* fields for the Market Analytics expansion: what a bank is
   * doing about its CRE book, as opposed to the condition fields above. A
   * separate list, not additions to `financials`, because the screening cache
   * entry is already 1.26MB against a 2MB ceiling and because every pull on
   * the tab shares that list; these are pulled on their own path.
   *
   * Every field was checked against the official catalogue
   * (api.fdic.gov/banks/docs/risview_properties.yaml, 2,378 fields) and, where
   * the FFIEC CDR bulk subset carries the item, tied to the published Call
   * Report for three banks (CERT 35541, 24156, 14851; 2026-06-30):
   *   LNLSSALE = RCON5369, ORE = RCON2150, NARSLNLT = RCONHK28,
   *   P3RSLNLT = RCONHK26, P9RSLNLT = RCONHK27 — all exact.
   *
   * Dollar fields are in thousands. `DR*`/`CR*`/`NT*` without a `Q` are
   * year-to-date, as on Schedule RI-B; the `*Q` nets are the quarter alone.
   */
  behavior: [
    'CERT',
    'NAME',
    'REPDTE',
    'STNAME',
    'ASSET',
    'LNLSGR', // Gross loans and leases: the denominator for every rate below
    // ── Schedule RC-C CRE balances, the denominators for the category rates.
    // Same fields and the same definition (`computeCreLoans`) as the rest of
    // the tab, so a rate here and a ratio there agree on what CRE is.
    'LNRECONS', 'LNREMULT', 'LNRENRES', 'LNRENROW', 'LNRENROT',
    // ── Schedule RC line 4.a: loans and leases held for sale. The "we are about
    // to sell" balance. Titled "held for resale" in the catalogue, which is why
    // a search for "held for sale" misses it. Total only: the Call Report has
    // no HFS breakdown by loan type.
    'LNLSSALE',
    'NALNSALE', // of which nonaccrual
    'P3LNSALE', // of which 30-89 days past due
    'P9LNSALE', // of which 90+ days past due
    // ── Schedule RI line 5.i: net gains (losses) on sales of loans and leases.
    'NETGNSLN', // year-to-date
    'NTGLLNQ', // the quarter alone — no differencing needed
    // ── Schedule RI-B Part I, columns A (charge-offs) and B (recoveries), by
    // CRE category. Year-to-date; `NT*Q` is the quarter's net.
    'DRRECONS', 'CRRECONS', 'NTRECONS', 'NTRECONQ', // 1.a construction & land development
    'DRREMULT', 'CRREMULT', 'NTREMULT', 'NTREMULQ', // 1.d multifamily
    'DRRENRES', 'CRRENRES', 'NTRENRES', 'NTRENRSQ', // 1.e nonfarm nonresidential, both halves
    'DRRENROT', 'CRRENROT', 'NTRENROT', // 1.e.(2) of which non-owner-occupied; owner-occupied is derived as the difference
    // ── Schedule RC-M item 3: other real estate owned, by property type.
    'ORE', // total
    'ORECONS', // 3.a construction & land development
    'OREMULT', // 3.c multifamily
    'ORENRES', // 3.d nonfarm nonresidential
    'ORERES', // 3.b 1-4 family
    'OREAG', // farmland
    // ── Schedule RC-N, by CRE category: columns A (30-89), B (90+), C (nonaccrual).
    'P3RECONS', 'P9RECONS', 'NARECONS',
    'P3REMULT', 'P9REMULT', 'NAREMULT',
    'P3RENRES', 'P9RENRES', 'NARENRES',
    'P3RENROT', 'P9RENROT', 'NARENROT', // of which non-owner-occupied
    // ── Schedule RC-C Part I Memorandum 1 and RC-N Memorandum 1: loan
    // modifications to borrowers experiencing financial difficulty (ASU
    // 2022-02, from Q1 2023). The catalogue still titles these "restructured",
    // the pre-2023 TDR label, but the series is live and ties to RCONHK26/27/28.
    'RSLNLTOT', // total modified loans
    'RSCONS', // construction & land development
    'RSMULT', // multifamily
    'RSNRES', // nonfarm nonresidential
    'RSCI', // commercial & industrial
    'RSLNREFM', // 1-4 family
    'RSOTHER', // all other
    'P3RSLNLT', // modified and 30-89 days past due
    'P9RSLNLT', // modified and 90+ days past due
    'NARSLNLT', // modified and nonaccrual
    // ── Schedule RC-S: loans serviced for others. The only RC-S item that
    // bears on CRE; the rest of the schedule is residential and card
    // securitisation.
    'LNSERV',
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

