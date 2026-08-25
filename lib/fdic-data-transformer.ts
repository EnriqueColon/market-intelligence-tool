/**
 * FDIC Data Transformation Utilities
 * Converts raw FDIC API responses to dashboard-ready formats.
 *
 * FDIC semantics: Fields genuinely marked "(% )" (NCLNLSR, LNLSDEPR) are percent points.
 * All ratios stored internally as DECIMALS (0.008 = 0.8%). Display: decimal * 100 -> "%".
 *
 * A field name is not evidence of its units. NCLNLS reads like a ratio and holds
 * dollars; LNREDOM reads like a residential figure and holds every real estate
 * loan; LNREOTH reads like a commercial residual and holds closed-end
 * mortgages. Each derived column below is reconciled against a published FDIC
 * total by `scripts/audit-fdic-columns.mjs`; run it after changing any of them.
 */

import { PORTFOLIO_METRICS } from './portfolio-constants'
import { computeCreLoans } from './fdic-cre'
import {
  computeNonaccrualRatio,
  computeNoncurrentToAssets,
  computePastDueToAssets,
  computeReserveCoverage,
  resolveGrossLoans,
} from './fdic-loan-quality'
import {
  normalizeCapitalRatioPercent,
  normalizeFdicPercent,
  normalizePercentToDecimal,
  warnIfUnrealisticPercent,
} from './format/metrics'

export interface BankFinancialData {
  id: string
  name: string
  city?: string
  state?: string
  totalAssets: number
  creLoans: number
  creConcentration: number
  constructionLoans: number
  multifamilyLoans: number
  nonResidentialLoans: number
  /**
   * FDIC LNREOTH, dollars. Closed-end 1-4 family residential, not a commercial
   * category: `LNRERES - LNRELOC = LNREOTH` exactly on all 4,352 institutions.
   * It is neither part of `creLoans` nor a share of it, so do not divide it by
   * `creLoans` to build a CRE mix.
   */
  otherRealEstateLoans: number
  /** Excluded from `creLoans` by the 2006 guidance definition. */
  ownerOccupiedLoans: number
  /** The portion of non-residential CRE that counts toward the 300% screen. */
  nonOwnerOccupiedLoans: number
  /**
   * 1-4 family residential, dollars. FDIC LNRERES.
   *
   * Previously read from LNREDOM, which is every real estate loan in domestic
   * offices and equals LNRE on 4,335 of 4,352 institutions — 2.09x the true
   * residential book industry-wide.
   */
  residentialLoans: number
  totalUnusedCommitments: number
  creUnusedCommitments: number
  /** Total loans and leases (net), dollars. FDIC LNLSNET. */
  totalLoans: number
  /** Gross loans and leases, dollars. FDIC LNLSGR. Denominator for the loan-quality ratios. */
  grossLoans: number
  /** Nonaccrual loans and leases, dollars. FDIC NALNLS. */
  nonaccrualLoans: number
  /** Nonaccrual over gross loans, decimal. Gross to match FDIC's own NCLNLSR. */
  nplRatio: number
  /** Assets past due 30-89 days over total assets, decimal. FDIC P3ASSET / ASSET. */
  pastDue3090: number
  /** Assets past due 90+ days over total assets, decimal. FDIC P9ASSET / ASSET. */
  pastDue90Plus: number
  /** Noncurrent loans to gross loans, decimal (FDIC NCLNLSR). Past due 90+ plus nonaccrual. Used for nplScore. */
  noncurrent_to_loans_ratio: number
  /**
   * Noncurrent loans to total assets, decimal. Display only, not used in scoring.
   *
   * Computed from FDIC NCLNLS over ASSET. NCLNLS is a dollar amount — it equals
   * P9LNLS + NALNLS exactly on every institution — so reading it as percent
   * points and clamping pinned 3,398 of 4,352 institutions at exactly 100%.
   */
  noncurrent_to_assets_ratio: number
  roa: number
  roe: number
  efficiencyRatio: number
  /**
   * Allowance for loan and lease losses over gross loans, decimal. FDIC
   * LNATRES / LNLSGR, which reproduces FDIC's published LNATRESR exactly.
   *
   * Gross, not net: net loans are gross loans minus this very allowance, so a
   * net denominator puts the allowance inside itself and overstates coverage by
   * up to 2.80 percentage points at reserve-heavy card lenders.
   *
   * This was previously read from LNLSDEPR, which is the net loans-to-deposits
   * ratio, not a reserve at all — the two agree to the decimal place on every
   * institution. It was displayed as "Reserve Coverage" throughout, roughly
   * thirty times too large and meaning the opposite thing.
   */
  loanLossReserve: number
  /** Net loans and leases to deposits, decimal. FDIC LNLSDEPR. */
  loansToDeposits: number
  netInterestMargin: number
  /**
   * The four PCA capital ratios, in percent points, or null when the
   * institution does not report one.
   *
   * Null rather than zero, and not optional: a CBLR filer reports a literal 0
   * for RBCRWAJ and omits RBCT1CER and RBC1RWAJ, and zero regulatory capital
   * means the opposite of what a CBLR election implies. Consumers must fall
   * back — `cet1Ratio ?? leverageRatio` — rather than treat zero as a figure.
   */
  cet1Ratio: number | null
  leverageRatio: number | null
  tier1RbcRatio: number | null
  totalRbcRatio: number | null
  netIncome: number
  reportDate?: string
  /**
   * Total equity capital in dollars. FDIC EQTOT, which equals `ASSET - LIAB`
   * on all 4,352 institutions.
   *
   * Read from EQCAP until 2026-08-24, which this endpoint does not serve, so it
   * was undefined on every institution and CRE/Equity silently fell back to
   * Tier 1 capital. Not EQ, which is bank-only equity excluding noncontrolling
   * interests and so does not close the balance sheet on 93 institutions.
   */
  totalEquityDollars?: number | null
  /** Tier 1 capital in dollars. FDIC RBCT1J. */
  tier1Dollars?: number | null
  /** Tier 2 capital in dollars. FDIC RBCT2. */
  tier2Dollars?: number | null
  /** Risk-weighted assets in dollars. FDIC RWAJ. */
  riskWeightedAssets?: number | null
}

export interface BankInstitutionData {
  cert: string
  name: string
  city: string
  state: string
  totalAssets: number
  totalDeposits: number
  netIncome: number
  roa: number
  roe: number
  lastUpdate: string
  active: boolean
}

export interface BankFailureData {
  cert: string
  name: string
  city: string
  state: string
  failDate: string
  failYear?: string
  resolutionDate?: string
  cost: number
  resolutionType: string
  transactionType?: string
  insuranceFund?: string
  depositsAtFailure: number
  assetsAtFailure: number
}

export interface DemographicsData {
  cert: string
  reportDate?: string
  callYm?: string
  cbsaName?: string
  csa?: string
  countyFips?: string
  metroFlag?: number
  microFlag?: number
  branchFlag?: number
  officesSod?: number
  officesTotal?: number
  officesStates?: number
  minorityCode?: number
  riskTerritory?: string
  fdicTerritory?: string
}

export interface BenchmarkComparison {
  industryNPL: number
  industryLTV: number
  portfolioNPL: number
  portfolioLTV: number
  nplDelta: number
  ltvDelta: number
  industryAvgLeverage: number
  portfolioAvgLeverage: number
  leverageDelta: number
}

/**
 * Format currency values
 * FDIC reports values in thousands, so multiply by 1000
 */
export function formatCurrency(value: number | null | undefined): number {
  if (value === null || value === undefined || isNaN(value)) return 0
  return value * 1000 // Convert from thousands to actual dollars
}

/**
 * A reported dollar figure in thousands, or undefined when it is absent.
 *
 * Zero counts as absent for the capital-stack fields this guards, because FDIC
 * reports RWAJ as 0 for CBLR filers rather than omitting it, and a zero
 * denominator produces Infinity instead of a value a caller can test for.
 */
function positiveDollars(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? formatCurrency(n) : undefined
}

/**
 * Format percentage values
 */
export function formatPercentage(value: number | null | undefined, decimals: number = 2): number {
  if (value === null || value === undefined || isNaN(value)) return 0
  return Number((value * 100).toFixed(decimals))
}

/**
 * Transform raw FDIC financial data
 */
export function transformFinancialData(rawData: any[]): BankFinancialData[] {
  if (!Array.isArray(rawData)) return []
  
  return rawData.map(bank => {
    const assets = formatCurrency(bank.ASSET)
    const constructionLoans = formatCurrency(bank.LNRECONS || 0)
    const multifamilyLoans = formatCurrency(bank.LNREMULT || 0)
    const nonResidentialLoans = formatCurrency(bank.LNRENRES || 0)
    const otherRealEstateLoans = formatCurrency(bank.LNREOTH || 0)
    const ownerOccupiedLoans = formatCurrency(bank.LNRENROW || 0)
    const nonOwnerOccupiedLoans = formatCurrency(bank.LNRENROT || 0)

    // See lib/fdic-cre.ts for why LNREOTH is excluded and owner-occupied
    // property is dropped. Both are load-bearing for the 300% screen.
    const creLoans = computeCreLoans({
      constructionLoans,
      multifamilyLoans,
      nonResidentialLoans,
      ownerOccupiedLoans,
      nonOwnerOccupiedLoans,
    })
    const totalUnusedCommitments = formatCurrency(bank.UCLN || 0)
    const creUnusedCommitments = formatCurrency(bank.UCCOMRE || 0)
    const netLoansThousands = Number(bank.LNLSNET || 0)
    const allowanceThousands = Number(bank.LNATRES || 0)
    const assetsThousands = Number(bank.ASSET || 0)
    // The denominator FDIC uses for its own loan-quality ratios. LNLSGR is
    // preferred; net plus the allowance reproduces it on every institution.
    const grossLoansThousands = resolveGrossLoans({
      grossLoans: bank.LNLSGR != null ? Number(bank.LNLSGR) : null,
      netLoans: netLoansThousands,
      allowance: allowanceThousands,
    })
    const nonAccrualLoansThousands = Number(bank.NALNLS || 0)
    const totalLoans = formatCurrency(bank.LNLSNET || 0)
    const grossLoans = formatCurrency(grossLoansThousands)
    const nonaccrualLoans = formatCurrency(bank.NALNLS || 0)
    const creConcentration = totalLoans > 0 ? (creLoans / totalLoans) * 100 : 0
    const nplRatio = computeNonaccrualRatio({
      nonaccrualLoans: nonAccrualLoansThousands,
      grossLoans: grossLoansThousands,
    })

    const rawRoa = Number(bank.ROA || 0)
    const rawNim = Number(bank.NIMR || 0)
    // FDIC reports ROA, ROE and NIMR in percent units on every institution, so
    // these are trusted rather than rescaled. See normalizeFdicPercent.
    const roa = normalizeFdicPercent(rawRoa) ?? 0
    const netInterestMargin = normalizeFdicPercent(rawNim) ?? 0

    if (roa > 0) warnIfUnrealisticPercent('ROA', roa, bank.NAME || 'Unknown', rawRoa)
    if (netInterestMargin > 0) warnIfUnrealisticPercent('NIM', netInterestMargin, bank.NAME || 'Unknown', rawNim)

    return {
      id: String(bank.CERT || ''),
      name: bank.NAME || 'Unknown',
      city: bank.CITY,
      state: bank.STNAME,
      totalAssets: assets,
      creLoans,
      creConcentration: Number(creConcentration.toFixed(2)),
      constructionLoans,
      multifamilyLoans,
      nonResidentialLoans,
      otherRealEstateLoans,
      ownerOccupiedLoans,
      nonOwnerOccupiedLoans,
      residentialLoans: formatCurrency(bank.LNRERES || 0),
      totalUnusedCommitments,
      creUnusedCommitments,
      totalLoans,
      grossLoans,
      nonaccrualLoans,
      nplRatio: Number(nplRatio.toFixed(4)),
      // P3ASSET, P9ASSET: past due amounts in thousands, not ratios.
      pastDue3090: computePastDueToAssets({
        pastDueAssets: Number(bank.P3ASSET || 0),
        totalAssets: assetsThousands,
      }),
      pastDue90Plus: computePastDueToAssets({
        pastDueAssets: Number(bank.P9ASSET || 0),
        totalAssets: assetsThousands,
      }),
      // NCLNLSR: FDIC Noncurrent Loans to Loans (%). Stored as decimal. Cap at 1.0 (100%).
      noncurrent_to_loans_ratio: (() => {
        const raw = Number(bank.NCLNLSR || 0)
        const decimal = normalizePercentToDecimal(raw, "NCLNLSR") ?? 0
        if (decimal > 0.20) {
          console.warn(`[FDIC] Extreme distress flag: ${bank.NAME} noncurrent_to_loans_ratio=${decimal} (raw NCLNLSR=${raw})`)
        }
        return Math.min(1, Math.max(0, decimal))
      })(),
      // NCLNLS is a dollar amount, not a percentage. Falls back to the reported
      // noncurrent-to-loans ratio rescaled onto assets when it is missing.
      noncurrent_to_assets_ratio: (() => {
        const noncurrentThousands = Number(bank.NCLNLS || 0)
        if (Number.isFinite(noncurrentThousands) && noncurrentThousands !== 0) {
          return computeNoncurrentToAssets({
            noncurrentLoans: noncurrentThousands,
            totalAssets: assetsThousands,
          })
        }
        if (assetsThousands > 0 && grossLoansThousands > 0) {
          const ntl = normalizePercentToDecimal(Number(bank.NCLNLSR || 0), "NCLNLSR") ?? 0
          return Math.min(1, Math.max(0, ntl * (grossLoansThousands / assetsThousands)))
        }
        return 0
      })(),
      roa,
      roe: normalizeFdicPercent(Number(bank.ROE || 0)) ?? 0,
      efficiencyRatio: Number(bank.EEFFR || 0),
      // Reserve coverage from the allowance itself, over gross loans so it
      // reproduces FDIC's own LNATRESR. Both fields are reported in thousands,
      // so the ratio needs no unit conversion.
      loanLossReserve: computeReserveCoverage({
        allowance: allowanceThousands,
        grossLoans: grossLoansThousands,
      }),
      // LNLSDEPR: FDIC net loans and leases to deposits (%). Stored as decimal.
      loansToDeposits: normalizePercentToDecimal(Number(bank.LNLSDEPR || 0), "LNLSDEPR") ?? 0,
      netInterestMargin,
      // Null, not zero, when a ratio is absent — see normalizeCapitalRatioPercent.
      // CBLR filers report RBCRWAJ as 0 and omit the other two.
      cet1Ratio: normalizeCapitalRatioPercent(bank.RBCT1CER),
      leverageRatio: normalizeCapitalRatioPercent(bank.RBC1AAJ),
      tier1RbcRatio: normalizeCapitalRatioPercent(bank.RBC1RWAJ),
      totalRbcRatio: normalizeCapitalRatioPercent(bank.RBCRWAJ),
      netIncome: formatCurrency(bank.NETINC || 0),
      reportDate: bank.REPDTE,
      totalEquityDollars: bank.EQTOT != null ? formatCurrency(Number(bank.EQTOT)) : undefined,
      // Reported capital, so CRE-to-capital no longer has to infer a denominator
      // from a ratio and an assumed risk weighting.
      // Positivity, not presence. A CBLR filer reports RWAJ as 0 (1,748 of
      // 4,352), and a zero reaching a denominator yields Infinity rather than a
      // caught absence. Tier 2 keeps its zero, which is a real figure at small
      // banks that hold no subordinated debt.
      tier1Dollars: positiveDollars(bank.RBCT1J),
      tier2Dollars: bank.RBCT2 != null ? formatCurrency(Number(bank.RBCT2)) : undefined,
      riskWeightedAssets: positiveDollars(bank.RWAJ),
    }
  })
}

/**
 * Transform raw FDIC institution data
 */
export function transformInstitutionData(rawData: any[]): BankInstitutionData[] {
  if (!Array.isArray(rawData)) return []
  
  return rawData.map(bank => ({
    cert: String(bank.CERT || ''),
    name: bank.NAME || 'Unknown',
    city: bank.CITY || '',
    state: bank.STNAME || '',
    totalAssets: formatCurrency(bank.ASSET || 0),
    totalDeposits: formatCurrency(bank.DEP || 0),
    netIncome: formatCurrency(bank.NETINC || 0),
    // Percent units on this endpoint too, so multiplying by 100 overstated every
    // institution a hundredfold. Ergo Bank reports ROA 0.3648, meaning 0.36%.
    roa: normalizeFdicPercent(Number(bank.ROA ?? 0)) ?? 0,
    roe: normalizeFdicPercent(Number(bank.ROE ?? 0)) ?? 0,
    lastUpdate: bank.DATEUPDT || '',
    active: bank.ACTIVE === 1 || bank.ACTIVE === true,
  }))
}

/**
 * Transform raw FDIC failure data
 */
export function transformFailureData(rawData: any[]): BankFailureData[] {
  if (!Array.isArray(rawData)) return []
  
  return rawData.map(failure => {
    const cityState = typeof failure.CITYST === "string" ? failure.CITYST : ""
    const [cityFromCombined, stateFromCombined] = cityState.split(",").map((part: string) => part.trim())

    return {
      cert: String(failure.CERT || ''),
      name: failure.NAME || 'Unknown',
      city: failure.CITY || cityFromCombined || '',
      state: failure.STATE || failure.PSTALP || stateFromCombined || '',
      failDate: failure.FAILDATE || '',
      failYear: failure.FAILYR || undefined,
      resolutionDate: failure.RESDATE || undefined,
      cost: formatCurrency(failure.COST || 0),
      resolutionType: failure.RESTYPE || 'Unknown',
      transactionType: failure.RESTYPE1 || undefined,
      insuranceFund: failure.SAVR || failure.FUND || undefined,
      depositsAtFailure: formatCurrency(failure.QBFDEP || 0),
      assetsAtFailure: formatCurrency(failure.QBFASSET || 0),
    }
  })
}

/**
 * Transform raw FDIC demographics data
 */
export function transformDemographicsData(rawData: any[]): DemographicsData[] {
  if (!Array.isArray(rawData)) return []
  
  return rawData.map(demo => ({
    cert: String(demo.CERT || ''),
    reportDate: demo.REPDTE || undefined,
    callYm: demo.CALLYM || demo.CALLYMD || undefined,
    cbsaName: demo.CBSANAME || undefined,
    csa: demo.CSA || undefined,
    countyFips: demo.CNTYNUM || undefined,
    metroFlag: typeof demo.METRO === "number" ? demo.METRO : Number(demo.METRO || 0) || 0,
    microFlag: typeof demo.MICRO === "number" ? demo.MICRO : Number(demo.MICRO || 0) || 0,
    branchFlag: typeof demo.BRANCH === "number" ? demo.BRANCH : Number(demo.BRANCH || 0) || 0,
    officesSod: typeof demo.OFFSOD === "number" ? demo.OFFSOD : Number(demo.OFFSOD || 0) || 0,
    officesTotal: typeof demo.OFFTOT === "number" ? demo.OFFTOT : Number(demo.OFFTOT || 0) || 0,
    officesStates: typeof demo.OFFSTATE === "number" ? demo.OFFSTATE : Number(demo.OFFSTATE || 0) || 0,
    minorityCode: typeof demo.MNRTYCDE === "number" ? demo.MNRTYCDE : Number(demo.MNRTYCDE || 0) || 0,
    riskTerritory: demo.RISKTERR || undefined,
    fdicTerritory: demo.FDICTERR || undefined,
  }))
}

/**
 * Calculate industry benchmarks from FDIC data
 */
export function calculateBenchmarks(fdicData: BankFinancialData[]): BenchmarkComparison {
  if (fdicData.length === 0) {
    return {
      industryNPL: 0,
      industryLTV: 0,
      portfolioNPL: PORTFOLIO_METRICS.nonPerformingPct * 100,
      portfolioLTV: PORTFOLIO_METRICS.averageLTV * 100,
      nplDelta: 0,
      ltvDelta: 0,
      industryAvgLeverage: 0,
      portfolioAvgLeverage: PORTFOLIO_METRICS.averageLeverageRatio * 100,
      leverageDelta: 0,
    }
  }
  
  const validData = fdicData.filter(b =>
    (b.nplRatio > 0) || b.creConcentration > 0
  )
  
  const avgNPLDecimal = validData.length > 0
    ? validData.reduce((sum, b) => sum + b.nplRatio, 0) / validData.length
    : 0
  const avgNPL = avgNPLDecimal * 100 // Convert decimal to percent points for benchmark comparison
  
  const avgCREConcentration = validData.length > 0
    ? validData.reduce((sum, b) => sum + b.creConcentration, 0) / validData.length
    : 0
  
  // Estimate leverage from CRE concentration (proxy)
  const avgLeverage = avgCREConcentration / 3 // Rough approximation
  
  return {
    industryNPL: Number(avgNPL.toFixed(2)),
    industryLTV: Number(avgCREConcentration.toFixed(2)),
    portfolioNPL: PORTFOLIO_METRICS.nonPerformingPct * 100,
    portfolioLTV: PORTFOLIO_METRICS.averageLTV * 100,
    nplDelta: Number((PORTFOLIO_METRICS.nonPerformingPct * 100 - avgNPL).toFixed(2)),
    ltvDelta: Number((PORTFOLIO_METRICS.averageLTV * 100 - avgCREConcentration).toFixed(2)),
    industryAvgLeverage: Number(avgLeverage.toFixed(2)),
    portfolioAvgLeverage: PORTFOLIO_METRICS.averageLeverageRatio * 100,
    leverageDelta: Number((PORTFOLIO_METRICS.averageLeverageRatio * 100 - avgLeverage).toFixed(2)),
  }
}

/**
 * Identify distressed banks based on criteria
 */
export function identifyDistressedBanks(
  banks: BankFinancialData[],
  criteria: {
    minNPL?: number
    minCREConcentration?: number
    maxROA?: number
    states?: string[]
  } = {}
): BankFinancialData[] {
  const {
    minNPL = 0.03, // decimal: 0.03 = 3%
    minCREConcentration = 300,
    maxROA = 0.5,
    states = [],
  } = criteria
  
  return banks.filter(bank => {
    const matchesNPL = bank.nplRatio >= minNPL
    const matchesCRE = bank.creConcentration >= minCREConcentration
    const matchesROA = bank.roa <= maxROA
    const matchesState = states.length === 0 || (bank.state && states.includes(bank.state))
    
    return (matchesNPL || matchesCRE || matchesROA) && matchesState
  })
}

/**
 * Calculate aggregate statistics
 */
export function calculateAggregateStats(banks: BankFinancialData[]): {
  totalCRELoans: number
  averageNPLRatio: number
  averageLoanLossReserve: number
  totalAssets: number
  yoyChange?: number
} {
  if (banks.length === 0) {
    return {
      totalCRELoans: 0,
      averageNPLRatio: 0,
      averageLoanLossReserve: 0,
      totalAssets: 0,
    }
  }
  
  const totalCRELoans = banks.reduce((sum, b) => sum + b.creLoans, 0)
  const totalAssets = banks.reduce((sum, b) => sum + b.totalAssets, 0)
  const avgNPLDecimal = banks.reduce((sum, b) => sum + b.nplRatio, 0) / banks.length
  const avgLLRDecimal = banks.reduce((sum, b) => sum + b.loanLossReserve, 0) / banks.length

  return {
    totalCRELoans,
    averageNPLRatio: Number((avgNPLDecimal * 100).toFixed(2)),
    averageLoanLossReserve: Number((avgLLRDecimal * 100).toFixed(2)),
    totalAssets,
  }
}

