/**
 * FRED Series IDs for Commercial Real Estate Data
 * 
 * Reference: https://fred.stlouisfed.org/
 * 
 * Note: Some CRE-specific data (like Green Street CPPI) requires subscriptions.
 * We use the best available public FRED series for CRE market indicators.
 */

export const FRED_SERIES = {
  // ============================================
  // DELINQUENCY RATES
  // ============================================
  
  // Commercial Real Estate Loans, Excluding Farmland, All Commercial Banks
  // This is the PRIMARY CRE delinquency series
  creDelinquency: "DRCRELEXFACBS",
  
  // All Loans and Leases Delinquency Rate (broader measure)
  allLoansDelinquency: "DRALACBS",
  
  // For sector-specific, we use the main CRE delinquency as a base
  // and apply sector multipliers in the code (office typically higher, industrial lower)
  officeDelinquency: "DRCRELEXFACBS",
  retailDelinquency: "DRCRELEXFACBS",
  multifamilyDelinquency: "DRCRELEXFACBS",
  industrialDelinquency: "DRCRELEXFACBS",

  // ============================================
  // LOAN VOLUMES & BALANCES
  // ============================================
  
  // Commercial Real Estate Loans, All Commercial Banks (Weekly, SA)
  creLoanVolume: "CREACBW027SBOG",
  
  // Real Estate Loans, All Commercial Banks
  realEstateLoanVolume: "RELACBW027SBOG",
  
  // Total Loans and Leases, All Commercial Banks
  totalLoans: "TOTLL",

  // ============================================
  // INTEREST RATES (Impact CRE financing)
  // ============================================
  
  // 10-Year Treasury Constant Maturity Rate (CRE financing benchmark)
  treasury10Y: "DGS10",
  
  // 30-Year Fixed Rate Mortgage Average
  mortgageRate30Y: "MORTGAGE30US",
  
  // Federal Funds Effective Rate
  fedFundsRate: "FEDFUNDS",
  
  // Prime Loan Rate (commercial lending benchmark)
  primeLoanRate: "DPRIME",

  // ============================================
  // PROPERTY PRICE INDICES
  // ============================================
  
  // S&P/Case-Shiller U.S. National Home Price Index (residential proxy)
  // Note: True CRE indices like Green Street CPPI require subscriptions
  homePriceIndex: "CSUSHPINSA",
  
  // Commercial Property Price Index alternatives:
  // We fall back to GDP Deflator or PPI for commercial construction
  priceIndex: "CSUSHPINSA", // Best available public proxy
  
  // Producer Price Index: Construction Materials
  constructionPPI: "WPUSI012011",

  // ============================================
  // ECONOMIC INDICATORS (CRE demand drivers)
  // ============================================
  
  // Real Gross Domestic Product
  gdp: "GDPC1",
  
  // Unemployment Rate
  unemploymentRate: "UNRATE",
  
  // Industrial Production Index (industrial/warehouse demand driver)
  industrialProduction: "INDPRO",
  
  // Retail Sales (retail CRE demand driver)
  retailSales: "RSXFS",
  
  // Office Employment (office CRE demand driver)
  // All Employees: Professional and Business Services
  officeEmployment: "USPRIV",

  // ============================================
  // BANKING SECTOR HEALTH
  // ============================================
  
  // Net Charge-Off Rate on Commercial Real Estate Loans
  creChargeOffRate: "CABOREA",
  
  // Allowance for Loan and Lease Losses
  loanLossAllowance: "ALLACBW027SBOG",

  // ============================================
  // CMBS & CAPITAL MARKETS
  // ============================================
  
  // Asset-Backed Securities Outstanding (includes CMBS)
  absOutstanding: "ABSODNS",
  
  // Corporate Bond Yield (BBB) - spread indicator for CRE financing
  bbbCorporateBondYield: "BAMLC0A4CBBB",

} as const

// Series metadata for display purposes
export const FRED_SERIES_INFO: Record<string, { name: string; description: string; frequency: string }> = {
  DRCRELEXFACBS: {
    name: "CRE Delinquency Rate",
    description: "Delinquency Rate on Commercial Real Estate Loans, Excluding Farmland, All Commercial Banks",
    frequency: "Quarterly",
  },
  CREACBW027SBOG: {
    name: "CRE Loan Volume",
    description: "Commercial Real Estate Loans, All Commercial Banks",
    frequency: "Weekly",
  },
  DGS10: {
    name: "10-Year Treasury Rate",
    description: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity",
    frequency: "Daily",
  },
  CSUSHPINSA: {
    name: "Home Price Index",
    description: "S&P/Case-Shiller U.S. National Home Price Index",
    frequency: "Monthly",
  },
  FEDFUNDS: {
    name: "Fed Funds Rate",
    description: "Federal Funds Effective Rate",
    frequency: "Daily",
  },
  DPRIME: {
    name: "Prime Rate",
    description: "Bank Prime Loan Rate",
    frequency: "Daily",
  },
  CABOREA: {
    name: "CRE Charge-Off Rate",
    description: "Charge-Off Rate on Commercial Real Estate Loans, All Commercial Banks",
    frequency: "Quarterly",
  },
}

// Recommended series for different dashboard sections
export const DASHBOARD_SERIES = {
  // National overview
  national: {
    delinquency: "DRCRELEXFACBS",
    priceIndex: "CSUSHPINSA",
    loanVolume: "CREACBW027SBOG",
    interestRate: "DGS10",
  },
  // Lending analysis
  lending: {
    creLoanVolume: "CREACBW027SBOG",
    totalLoans: "TOTLL",
    primeRate: "DPRIME",
    fedFunds: "FEDFUNDS",
  },
  // Risk indicators
  risk: {
    delinquency: "DRCRELEXFACBS",
    chargeOffs: "CABOREA",
    allLoansDelinquency: "DRALACBS",
  },
} as const
