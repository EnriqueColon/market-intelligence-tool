/**
 * FDIC API Service
 * Fetches bank failure data from the public FDIC API
 * Reference: https://banks.data.fdic.gov/docs/
 */

const FDIC_BASE_URL = 'https://banks.data.fdic.gov/api';

// Field definitions for the failures endpoint
const FAILURE_FIELDS = [
  'CERT',      // Certificate Number
  'NAME',      // Institution Name
  'CITY',      // City
  'STATE',     // State
  'FAILDATE',  // Failure Date
  'SAVR',      // Savings Fund Loss
  'COST',      // Estimated Loss to DIF
  'RESTYPE',   // Resolution Type
  'RESTYPE1',  // Resolution Description
  'QBFDEP',    // Total Deposits at Failure
  'QBFASSET',  // Total Assets at Failure
  'FIN'        // FDIC Fund
].join(',');

export interface RawFDICFailure {
  data: {
    CERT: string
    NAME: string
    CITY: string
    STATE: string
    FAILDATE: string
    SAVR?: number
    COST?: number
    RESTYPE?: string
    RESTYPE1?: string
    QBFDEP?: number
    QBFASSET?: number
    FIN?: string
  }
}

export interface TransformedFailure {
  cert: string
  name: string
  city: string
  state: string
  failDate: Date
  failDateFormatted: string
  totalAssets: number
  totalDeposits: number
  estimatedLoss: number
  resolutionType: string
}

export interface YearlyAggregation {
  year: string
  failures: number
  totalAssets: number
  estimatedLoss: number
}

export interface QuarterlyAggregation {
  quarter: string
  failures: number
  assets: number
}

export interface StateAggregation {
  state: string
  failures: number
  totalAssets: number
}

export interface SummaryStats {
  ytdFailures: number
  priorYearFailures: number
  last5YearAvg: string
  totalAssetsLast5Years: number
  largestFailure: TransformedFailure | null
}

/**
 * Fetch all bank failures (no date filtering needed - small dataset)
 */
export async function fetchAllBankFailures(limit = 500): Promise<RawFDICFailure[]> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    format: 'json',
    fields: FAILURE_FIELDS,
    sort_by: 'FAILDATE',
    sort_order: 'DESC'
  });

  const url = `${FDIC_BASE_URL}/failures?${params.toString()}`;
  
  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 } // Cache for 1 hour
    });
    
    if (!response.ok) {
      throw new Error(`FDIC API error: ${response.status}`);
    }

    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Failed to fetch FDIC data:', error);
    throw error;
  }
}

/**
 * Fetch failures by state
 */
export async function fetchFailuresByState(state: string, limit = 100): Promise<RawFDICFailure[]> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    format: 'json',
    fields: FAILURE_FIELDS,
    filters: `STATE:${state}`,
    sort_by: 'FAILDATE',
    sort_order: 'DESC'
  });

  const url = `${FDIC_BASE_URL}/failures?${params.toString()}`;
  
  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 }
    });
    
    if (!response.ok) {
      throw new Error(`FDIC API error: ${response.status}`);
    }

    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Failed to fetch FDIC data:', error);
    throw error;
  }
}

/**
 * Transform raw FDIC data into dashboard-friendly format
 */
export function transformFailureData(rawData: RawFDICFailure[]): TransformedFailure[] {
  return rawData.map(item => ({
    cert: item.data.CERT,
    name: item.data.NAME,
    city: item.data.CITY,
    state: item.data.STATE,
    failDate: new Date(item.data.FAILDATE),
    failDateFormatted: formatDate(item.data.FAILDATE),
    totalAssets: parseFloat(String(item.data.QBFASSET)) || 0,
    totalDeposits: parseFloat(String(item.data.QBFDEP)) || 0,
    estimatedLoss: parseFloat(String(item.data.COST)) || 0,
    resolutionType: item.data.RESTYPE1 || item.data.RESTYPE || 'Unknown'
  }));
}

/**
 * Aggregate failures by year
 */
export function aggregateByYear(failures: TransformedFailure[]): YearlyAggregation[] {
  const yearMap = new Map<string, YearlyAggregation>();
  
  failures.forEach(failure => {
    const year = failure.failDate.getFullYear().toString();
    
    if (!yearMap.has(year)) {
      yearMap.set(year, {
        year,
        failures: 0,
        totalAssets: 0,
        estimatedLoss: 0
      });
    }
    
    const yearData = yearMap.get(year)!;
    yearData.failures += 1;
    yearData.totalAssets += failure.totalAssets / 1000; // Convert to billions
    yearData.estimatedLoss += failure.estimatedLoss / 1000;
  });
  
  return Array.from(yearMap.values())
    .sort((a, b) => parseInt(a.year) - parseInt(b.year));
}

/**
 * Aggregate failures by quarter
 */
export function aggregateByQuarter(failures: TransformedFailure[], years = 2): QuarterlyAggregation[] {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
  
  const quarterMap = new Map<string, QuarterlyAggregation>();
  
  failures
    .filter(f => f.failDate >= cutoffDate)
    .forEach(failure => {
      const year = failure.failDate.getFullYear();
      const quarter = Math.floor(failure.failDate.getMonth() / 3) + 1;
      const key = `Q${quarter} ${year}`;
      
      if (!quarterMap.has(key)) {
        quarterMap.set(key, {
          quarter: key,
          failures: 0,
          assets: 0
        });
      }
      
      const qData = quarterMap.get(key)!;
      qData.failures += 1;
      qData.assets += failure.totalAssets / 1000;
    });
  
  return Array.from(quarterMap.values())
    .sort((a, b) => {
      const [qA, yA] = a.quarter.split(' ');
      const [qB, yB] = b.quarter.split(' ');
      return yA !== yB ? parseInt(yA) - parseInt(yB) : parseInt(qA.slice(1)) - parseInt(qB.slice(1));
    });
}

/**
 * Aggregate failures by state/region
 */
export function aggregateByState(failures: TransformedFailure[]): StateAggregation[] {
  const stateMap = new Map<string, StateAggregation>();
  
  failures.forEach(failure => {
    const state = failure.state;
    
    if (!stateMap.has(state)) {
      stateMap.set(state, {
        state,
        failures: 0,
        totalAssets: 0
      });
    }
    
    const stateData = stateMap.get(state)!;
    stateData.failures += 1;
    stateData.totalAssets += failure.totalAssets;
  });
  
  return Array.from(stateMap.values())
    .sort((a, b) => b.failures - a.failures);
}

/**
 * Calculate summary statistics
 */
export function calculateSummaryStats(failures: TransformedFailure[]): SummaryStats {
  const currentYear = new Date().getFullYear();
  const priorYear = currentYear - 1;
  
  const currentYearFailures = failures.filter(
    f => f.failDate.getFullYear() === currentYear
  );
  
  const priorYearFailures = failures.filter(
    f => f.failDate.getFullYear() === priorYear
  );
  
  const last5Years = failures.filter(
    f => f.failDate.getFullYear() >= currentYear - 5
  );
  
  const totalAssetsLast5Years = last5Years.reduce(
    (sum, f) => sum + f.totalAssets, 0
  );
  
  const largestFailure = failures.length > 0
    ? failures.reduce(
        (max, f) => f.totalAssets > max.totalAssets ? f : max,
        failures[0]
      )
    : null;
  
  return {
    ytdFailures: currentYearFailures.length,
    priorYearFailures: priorYearFailures.length,
    last5YearAvg: (last5Years.length / 5).toFixed(1),
    totalAssetsLast5Years: totalAssetsLast5Years / 1000, // In billions
    largestFailure
  };
}

/**
 * Format date helper
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format currency helper
 */
export function formatCurrencyValue(valueInMillions: number): string {
  if (valueInMillions >= 1000) {
    return `$${(valueInMillions / 1000).toFixed(1)}B`;
  }
  if (valueInMillions >= 1) {
    return `$${valueInMillions.toFixed(0)}M`;
  }
  return `$${(valueInMillions * 1000).toFixed(0)}K`;
}
