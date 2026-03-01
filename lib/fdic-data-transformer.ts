/**
 * FDIC Data Transformation Utilities
 * Converts raw FDIC API responses to dashboard-ready formats.
 *
 * FDIC semantics: Fields marked "(% )" (NCLNLS, NCLNLSR, LNLSDEPR) are percent points.
 * All ratios stored internally as DECIMALS (0.008 = 0.8%). Display: decimal * 100 -> "%".
 */

import { PORTFOLIO_METRICS } from './portfolio-constants'
import { normalizePercent, normalizePercentToDecimal, warnIfUnrealisticPercent } from './format/metrics'

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
  otherRealEstateLoans: number
  residentialLoans: number
  totalUnusedCommitments: number
  creUnusedCommitments: number
  /** Total loans and leases (net), dollars. FDIC LNLSNET. */
  totalLoans: number
  /** Nonaccrual loans and leases, dollars. FDIC NALNLS. */
  nonaccrualLoans: number
  nplRatio: number
  pastDue3090: number
  pastDue90Plus: number
  /** Noncurrent loans to gross loans, decimal (FDIC NCLNLSR). Past due 90+ plus nonaccrual. Used for nplScore. */
  noncurrent_to_loans_ratio: number
  /** Noncurrent loans to total assets, decimal (FDIC NCLNLS). Display only, not used in scoring. */
  noncurrent_to_assets_ratio: number
  roa: number
  roe: number
  efficiencyRatio: number
  loanLossReserve: number
  netInterestMargin: number
  cet1Ratio: number
  leverageRatio: number
  tier1RbcRatio: number
  totalRbcRatio: number
  netIncome: number
  reportDate?: string
  /** Total equity capital in dollars (from EQCAP if available) */
  totalEquityDollars?: number | null
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
    const creLoans = constructionLoans + multifamilyLoans + nonResidentialLoans + otherRealEstateLoans
    const totalUnusedCommitments = formatCurrency(bank.UCLN || 0)
    const creUnusedCommitments = formatCurrency(bank.UCCOMRE || 0)
    const totalLoansThousands = Number(bank.LNLSNET || 0)
    const nonAccrualLoansThousands = Number(bank.NALNLS || 0)
    const totalLoans = formatCurrency(bank.LNLSNET || 0)
    const nonaccrualLoans = formatCurrency(bank.NALNLS || 0)
    const creConcentration = totalLoans > 0 ? (creLoans / totalLoans) * 100 : 0
    // NPL Ratio: NALNLS/LNLSNET, stored as decimal (0.008 = 0.8%)
    const nplRatio = totalLoansThousands > 0 ? nonAccrualLoansThousands / totalLoansThousands : 0

    const rawRoa = Number(bank.ROA || 0)
    const rawNim = Number(bank.NIMR || 0)
    const roa = normalizePercent(rawRoa) ?? 0
    const netInterestMargin = normalizePercent(rawNim) ?? 0

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
      residentialLoans: formatCurrency(bank.LNREDOM || 0),
      totalUnusedCommitments,
      creUnusedCommitments,
      totalLoans,
      nonaccrualLoans,
      nplRatio: Number(nplRatio.toFixed(4)),
      // P3ASSET, P9ASSET: Past due amounts in thousands (not ratios). Compute ratio = amount/ASSET.
      pastDue3090: (() => {
        const p3 = Number(bank.P3ASSET || 0)
        const asset = Number(bank.ASSET || 0)
        if (asset <= 0 || !Number.isFinite(p3)) return 0
        const ratio = p3 / asset
        return Math.min(1, Math.max(0, ratio))
      })(),
      pastDue90Plus: (() => {
        const p9 = Number(bank.P9ASSET || 0)
        const asset = Number(bank.ASSET || 0)
        if (asset <= 0 || !Number.isFinite(p9)) return 0
        const ratio = p9 / asset
        return Math.min(1, Math.max(0, ratio))
      })(),
      // NCLNLSR: FDIC Noncurrent Loans to Loans (%). Stored as decimal. Cap at 1.0 (100%).
      noncurrent_to_loans_ratio: (() => {
        const raw = Number(bank.NCLNLSR || 0)
        const decimal = normalizePercentToDecimal(raw, "NCLNLSR") ?? 0
        if (decimal > 0.20) {
          console.warn(`[FDIC] Extreme distress flag: ${bank.NAME} noncurrent_to_loans_ratio=${decimal} (raw NCLNLSR=${raw})`)
        }
        return Math.min(1, Math.max(0, decimal))
      })(),
      // NCLNLS: FDIC Noncurrent Loans to Assets (%). Stored as decimal. Fallback only when NCLNLS missing.
      // Cap at 1.0 (100%) — noncurrent loans cannot exceed total assets; FDIC outliers can corrupt averages.
      noncurrent_to_assets_ratio: (() => {
        const raw = Number(bank.NCLNLS || 0)
        let decimal = 0
        if (Number.isFinite(raw) && raw !== 0) {
          decimal = normalizePercentToDecimal(raw, "NCLNLS") ?? 0
        } else {
          const assetsThousands = Number(bank.ASSET || 0)
          const loansThousands = Number(bank.LNLSNET || 0)
          if (assetsThousands > 0 && loansThousands > 0) {
            const ntl = normalizePercentToDecimal(Number(bank.NCLNLSR || 0), "NCLNLSR") ?? 0
            decimal = ntl * (loansThousands / assetsThousands)
          }
        }
        return Math.min(1, Math.max(0, decimal))
      })(),
      roa,
      roe: normalizePercent(Number(bank.ROE || 0)) ?? 0,
      efficiencyRatio: Number(bank.EEFFR || 0),
      // LNLSDEPR: FDIC Loan Loss Reserve / Total Loans (%). Stored as decimal.
      loanLossReserve: normalizePercentToDecimal(Number(bank.LNLSDEPR || 0), "LNLSDEPR") ?? 0,
      netInterestMargin,
      cet1Ratio: normalizePercent(Number(bank.RBCT1CER || 0)) ?? 0,
      leverageRatio: normalizePercent(Number(bank.RBC1AAJ || 0)) ?? 0,
      tier1RbcRatio: normalizePercent(Number(bank.RBC1RWAJ || 0)) ?? 0,
      totalRbcRatio: normalizePercent(Number(bank.RBCRWAJ || 0)) ?? 0,
      netIncome: formatCurrency(bank.NETINC || 0),
      reportDate: bank.REPDTE,
      totalEquityDollars: bank.EQCAP != null ? formatCurrency(bank.EQCAP) : undefined,
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
    roa: formatPercentage(bank.ROA || 0),
    roe: formatPercentage(bank.ROE || 0),
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

