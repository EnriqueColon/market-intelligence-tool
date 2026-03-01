/**
 * Portfolio Metrics Constants
 * Based on Q3 2025 Investment Committee Report
 */

export interface FundMetrics {
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  grossIRR: number
  netIRR: number
  grossMOIC: number
  netMOIC: number
  leverageRatioLegal?: number
  leverageRatioSHE?: number
  leverageRatioUPB?: number
  ltvUPB?: number
  ltvLegal?: number
}

export interface CollateralExposure {
  value: number
  pct: number
}

export interface AssetStatus {
  performing: number
  nonPerforming: number
  reo: number
}

export interface Pipeline {
  acquisition: number
  origination: number
}

export const PORTFOLIO_METRICS = {
  totalAssets: 407842790,
  totalLiabilities: 224028483,
  totalEquity: 183814307,
  weightedGrossIRR: 0.2545,
  weightedNetIRR: 0.1846,
  grossMOIC: 1.65,
  netMOIC: 1.46,
  
  funds: {
    SHEDDF1: {
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
      grossIRR: 0.2254,
      netIRR: 0.1596,
      grossMOIC: 1.59,
      netMOIC: 1.40,
    } as FundMetrics,
    SHEDDF2: {
      totalAssets: 1600218,
      totalLiabilities: 1405096,
      totalEquity: 195121,
      grossIRR: 0.1881,
      netIRR: 0.1250,
      grossMOIC: 1.59,
      netMOIC: 1.37,
      leverageRatioLegal: 0.8590,
      leverageRatioSHE: 0.2590,
      leverageRatioUPB: 4.7916,
      ltvUPB: 0.054,
      ltvLegal: 0.3015,
    } as FundMetrics,
    SHEDDF3: {
      totalAssets: 93613740,
      totalLiabilities: 17583320,
      totalEquity: 76030420,
      grossIRR: 0.1521,
      netIRR: 0.1035,
      grossMOIC: 1.81,
      netMOIC: 1.55,
      leverageRatioLegal: 0.1907,
      leverageRatioSHE: 0.1659,
      leverageRatioUPB: 0.2832,
      ltvUPB: 0.5859,
      ltvLegal: 0.8702,
    } as FundMetrics,
    SHEDDF3_TIDES: {
      totalAssets: 83299300,
      totalLiabilities: 60372737,
      totalEquity: 22926563,
      grossIRR: 0.1556,
      netIRR: 0.1460,
      grossMOIC: 1.97,
      netMOIC: 1.89,
      leverageRatioLegal: 0.7238,
      leverageRatioSHE: 0.6188,
      leverageRatioUPB: 1.4422,
      ltvUPB: 0.8550,
      ltvLegal: 0.4291,
    } as FundMetrics,
    SHEDDF4: {
      totalAssets: 189847775,
      totalLiabilities: 120857963,
      totalEquity: 68989811,
      grossIRR: 0.4420,
      netIRR: 0.3067,
      grossMOIC: 1.47,
      netMOIC: 1.34,
      leverageRatioLegal: 0.6479,
      leverageRatioSHE: 0.4297,
      leverageRatioUPB: 0.7454,
      ltvUPB: 0.5764,
      ltvLegal: 0.6631,
    } as FundMetrics,
    PAM4D: {
      totalAssets: 39481757,
      totalLiabilities: 23809366,
      totalEquity: 15672391,
      grossIRR: 0.4101,
      netIRR: 0.3653,
      grossMOIC: 1.40,
      netMOIC: 1.36,
      leverageRatioLegal: 0.6257,
      leverageRatioSHE: 0.4600,
      leverageRatioUPB: 0.6872,
      ltvUPB: 0.6695,
      ltvLegal: 0.7353,
    } as FundMetrics,
  },
  
  collateralExposure: {
    hotel: { value: 97400000, pct: 0.182 } as CollateralExposure,
    multifamily: { value: 75800000, pct: 0.142 } as CollateralExposure,
    land: { value: 63000000, pct: 0.118 } as CollateralExposure,
    residential: { value: 133000000, pct: 0.249 } as CollateralExposure,
    industrial: { value: 12000000, pct: 0.022 } as CollateralExposure,
    commercial: { value: 22000000, pct: 0.041 } as CollateralExposure,
    office: { value: 15600000, pct: 0.029 } as CollateralExposure,
    retail: { value: 22000000, pct: 0.041 } as CollateralExposure, // ARM Ventures
  },
  
  assetStatus: {
    performing: 0.35,
    nonPerforming: 0.45,
    reo: 0.20,
  } as AssetStatus,
  
  pipeline: {
    q32025: {
      acquisition: 620573882,
      origination: 328160000,
    } as Pipeline,
    q12025: {
      acquisition: 561950000,
      origination: 569930000,
    } as Pipeline,
    q42024: {
      acquisition: 625714332,
      origination: 191703908,
    } as Pipeline,
  },
  
  // Calculated portfolio averages for benchmarking
  get averageLTV(): number {
    const funds = Object.values(this.funds).filter(f => f.ltvUPB !== undefined)
    const avg = funds.reduce((sum, f) => sum + (f.ltvUPB || 0), 0) / funds.length
    return avg
  },
  
  get averageLeverageRatio(): number {
    const funds = Object.values(this.funds).filter(f => f.leverageRatioSHE !== undefined)
    const avg = funds.reduce((sum, f) => sum + (f.leverageRatioSHE || 0), 0) / funds.length
    return avg
  },
  
  get nonPerformingPct(): number {
    return this.assetStatus.nonPerforming
  },
} as const

