"use server"

import { FDIC_CONFIG, FDIC_ENDPOINTS, FDIC_FIELDS } from "@/lib/fdic-config"
import {
  transformFinancialData,
  transformInstitutionData,
  transformFailureData,
  transformDemographicsData,
  BankFinancialData,
  BankInstitutionData,
  BankFailureData,
  DemographicsData,
} from "@/lib/fdic-data-transformer"
import { buildNoncurrentDebugSnapshot, type NoncurrentDebugSnapshot } from "@/lib/noncurrent-debug"

interface FDICApiResponse<T> {
  data: T[]
  meta?: {
    total: number
    parameters: Record<string, any>
  }
  error?: string
}

/**
 * Build filter string for FDIC API.
 * Uses Elasticsearch query string syntax. String values must be quoted for phrase matching
 * (e.g. "New York" requires STNAME:"NEW YORK" - unquoted fails).
 */
function buildFilterString(filters: Record<string, any>): string {
  return Object.entries(filters)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map(v => `${key}:"${String(v).replace(/"/g, '\\"')}"`).join(' OR ')
      }
      // Handle Elasticsearch date range (e.g. REPDTE:[2024-01-01 TO *])
      if (typeof value === 'string' && /^\[.*\s+TO\s+/.test(value)) {
        return `${key}:${value}`
      }
      // Handle comparison operators (>, <, >=, <=)
      if (typeof value === 'string' && /^[><]=?/.test(value)) {
        return `${key}:${value}`
      }
      // Wrap string values in double quotes for phrase matching (required for multi-word states like "New York")
      if (typeof value === 'string') {
        return `${key}:"${value.replace(/"/g, '\\"')}"`
      }
      return `${key}:${value}`
    })
    .join(' AND ')
}

/** Last ~6 quarters for trend analysis; keeps API dataset small (~36k vs 1.6M rows) */
function recentQuartersFilter(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 18)
  const startDate = d.toISOString().slice(0, 7) + '-01'
  return `[${startDate} TO *]`
}

/**
 * Generic FDIC API fetch function
 */
async function fetchFDICData<T>(
  endpoint: string,
  params: {
    filters?: Record<string, any>
    fields?: readonly string[]
    limit?: number
    offset?: number
    sort_by?: string
    sort_order?: 'ASC' | 'DESC'
    format?: string
  } = {}
): Promise<FDICApiResponse<T>> {
  try {
    const {
      filters = {},
      fields = [],
      limit = FDIC_CONFIG.defaultLimit,
      offset,
      sort_by = 'ASSET',
      sort_order = 'DESC',
      format = FDIC_CONFIG.defaultFormat,
    } = params

    const queryParams = new URLSearchParams({
      format,
      limit: limit.toString(),
    })
    if (offset != null && offset > 0) {
      queryParams.append('offset', offset.toString())
    }

    if (Object.keys(filters).length > 0) {
      queryParams.append('filters', buildFilterString(filters))
    }

    if (fields.length > 0) {
      queryParams.append('fields', fields.join(','))
    }

    if (sort_by) {
      queryParams.append('sort_by', sort_by)
      queryParams.append('sort_order', sort_order)
    }

    const url = `${FDIC_CONFIG.baseUrl}${endpoint}?${queryParams.toString()}`

    // FDIC financials responses can exceed Next.js 2MB cache limit; skip cache for large requests
    const skipCache = limit >= 5000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 45000) // 45s timeout
    try {
      const response = await fetch(url, {
        ...(skipCache ? { cache: 'no-store' as RequestCache } : { next: { revalidate: FDIC_CONFIG.cacheTimeout / 1000 } }),
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`FDIC API error: ${response.status} - ${errorText}`)
        console.error(`FDIC API URL: ${url}`)
        return {
          data: [],
          error: `FDIC API error: ${response.status}`,
        }
      }

      const jsonData = await response.json()

      // FDIC API returns data in different formats depending on endpoint
      if (jsonData.data && Array.isArray(jsonData.data)) {
        const normalized = jsonData.data.map((item: any) => item?.data ?? item)
        return {
          data: normalized,
          meta: jsonData.meta,
        }
      }

      if (Array.isArray(jsonData)) {
        const normalized = jsonData.map((item: any) => item?.data ?? item)
        return {
          data: normalized,
        }
      }

      return {
        data: [],
        error: 'Unexpected response format from FDIC API',
      }
    } catch (error) {
      clearTimeout(timeoutId)
      const msg = error instanceof Error ? error.message : 'Unknown error'
      const isTimeout = msg.includes('abort') || msg.includes('AbortError')
      console.error(`Error fetching FDIC data from ${endpoint}:`, error)
      return {
        data: [],
        error: isTimeout ? 'Request timed out. Try selecting a state for faster results.' : msg,
      }
    }
  } catch (error) {
    console.error(`Error fetching FDIC data from ${endpoint}:`, error)
    return {
      data: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

const FDIC_PAGE_SIZE = 10000
const FDIC_MAX_PAGES = 20 // Cap at 200k rows to avoid runaway requests

/**
 * Fetch financial data for banks
 * @param state - State filter (e.g. "Florida"). Omit for national.
 * @param limit - Max rows per request. Use fetchAll: true to get all institutions.
 * @param fetchAll - When true, paginate to fetch all records for the region (for full distribution).
 */
export async function fetchFDICFinancials(
  state?: string,
  limit: number = 100,
  fetchAll: boolean = false
): Promise<{ data: BankFinancialData[]; error?: string }> {
  try {
    const filters: Record<string, any> = {
      // Restrict to last ~6 quarters: reduces dataset from 1.6M to ~36k rows for faster response
      REPDTE: recentQuartersFilter(),
    }
    if (state) {
      filters.STNAME = state.toUpperCase()
    }

    if (!fetchAll) {
      const response = await fetchFDICData<any>(
        FDIC_ENDPOINTS.financials,
        {
          filters,
          fields: FDIC_FIELDS.financials,
          limit,
          sort_by: 'ASSET',
          sort_order: 'DESC',
        }
      )
      if (response.error) return { data: [], error: response.error }
      const transformed = transformFinancialData(response.data)
      return { data: transformed }
    }

    // Paginate to fetch all institutions for full distribution
    const allData: any[] = []
    let offset = 0
    let totalFromMeta: number | null = null

    for (let page = 0; page < FDIC_MAX_PAGES; page++) {
      const response = await fetchFDICData<any>(
        FDIC_ENDPOINTS.financials,
        {
          filters,
          fields: FDIC_FIELDS.financials,
          limit: FDIC_PAGE_SIZE,
          offset,
          sort_by: 'ASSET',
          sort_order: 'DESC',
        }
      )
      if (response.error) return { data: [], error: response.error }
      const batch = response.data
      if (batch.length === 0) break
      allData.push(...batch)
      if (response.meta?.total != null) totalFromMeta = response.meta.total
      if (batch.length < FDIC_PAGE_SIZE) break
      offset += batch.length
      if (totalFromMeta != null && offset >= totalFromMeta) break
    }

    const transformed = transformFinancialData(allData)
    return { data: transformed }
  } catch (error) {
    console.error("Error in fetchFDICFinancials:", error)
    return {
      data: [],
      error: error instanceof Error ? error.message : "Unknown FDIC financials error",
    }
  }
}

/** Normalize reportDate to YYYY-MM-DD for FDIC API filter. */
function normalizeReportDateForFDIC(reportDate: string): string {
  const s = String(reportDate || "").trim()
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  if (s.includes("T")) return s.slice(0, 10)
  return s.slice(0, 10)
}

/**
 * Fetch raw FDIC financial data for a single institution and quarter.
 * Used by Noncurrent Debug Snapshot when NEXT_PUBLIC_NONCURRENT_DEBUG is enabled.
 */
export async function fetchNoncurrentDebugSnapshot(
  cert: string,
  reportDate: string
): Promise<{ snapshot: NoncurrentDebugSnapshot | null; error?: string }> {
  if (!cert || !reportDate) {
    return { snapshot: null, error: "cert and reportDate are required" }
  }

  const datePart = normalizeReportDateForFDIC(reportDate)
  const filters: Record<string, any> = {
    CERT: cert,
    REPDTE: datePart,
  }

  const response = await fetchFDICData<any>(FDIC_ENDPOINTS.financials, {
    filters,
    fields: FDIC_FIELDS.financials,
    limit: 1,
  })

  if (response.error) {
    return { snapshot: null, error: response.error }
  }

  const rawRecord = response.data[0]
  if (!rawRecord) {
    return { snapshot: null, error: `No FDIC record for CERT=${cert} REPDTE=${datePart}` }
  }

  const snapshot = buildNoncurrentDebugSnapshot(rawRecord as Record<string, unknown>)
  snapshot.fdic_endpoint = `${FDIC_CONFIG.baseUrl}${FDIC_ENDPOINTS.financials}`
  return { snapshot }
}

/**
 * Fetch institution data
 */
export async function fetchFDICInstitutions(
  state?: string,
  limit: number = 100
): Promise<{ data: BankInstitutionData[]; error?: string }> {
  const filters: Record<string, any> = { ACTIVE: 1 }
  if (state) {
    filters.STNAME = state.toUpperCase()
  }

  const response = await fetchFDICData<any>(
    FDIC_ENDPOINTS.institutions,
    {
      filters,
      fields: FDIC_FIELDS.institutions,
      limit,
      sort_by: 'ASSET',
      sort_order: 'DESC',
    }
  )

  if (response.error) {
    return { data: [], error: response.error }
  }

  const transformed = transformInstitutionData(response.data)
  return { data: transformed }
}

/**
 * Fetch bank failure data
 * Date format: YYYY-MM-DD (will be converted to YYYYMMDD for API)
 */
export async function fetchFDICFailures(
  startDate?: string,
  endDate?: string,
  state?: string,
  limit: number = 100
): Promise<{ data: BankFailureData[]; error?: string }> {
  try {
    const params = new URLSearchParams({
      limit: limit.toString(),
      format: 'json',
      fields: FDIC_FIELDS.failures.join(','),
      sort_by: 'FAILDATE',
      sort_order: 'DESC',
    })

    // Build filter conditions
    const filterConditions: string[] = []

    if (state) {
      const stateMap: Record<string, string> = {
        Florida: "FL",
      }
      const stateCode =
        state.length === 2 ? state.toUpperCase() : stateMap[state] || state
      filterConditions.push(`PSTALP:${stateCode}`)
    }

    // Convert YYYY-MM-DD to YYYYMMDD for FDIC API
    if (startDate) {
      const formatted = startDate.replace(/-/g, '')
      filterConditions.push(`FAILDATE:>${formatted}`)
    }

    if (endDate) {
      const formatted = endDate.replace(/-/g, '')
      filterConditions.push(`FAILDATE:<${formatted}`)
    }

    if (filterConditions.length > 0) {
      params.append('filters', filterConditions.join(' AND '))
    }

    const url = `${FDIC_CONFIG.baseUrl}${FDIC_ENDPOINTS.failures}?${params.toString()}`

    const response = await fetch(url, {
      next: { revalidate: FDIC_CONFIG.cacheTimeout / 1000 },
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`FDIC API error: ${response.status} - ${errorText}`)
      console.error(`FDIC API URL: ${url}`)
      return { data: [], error: `FDIC API error: ${response.status}` }
    }

    const jsonData = await response.json()
    const data = (jsonData.data || []).map((item: any) => item?.data ?? item)
    
    const transformed = transformFailureData(data)
    return { data: transformed }
  } catch (error) {
    console.error('Error fetching FDIC failures:', error)
    return {
      data: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Fetch demographics data
 * Note: FDIC API doesn't have a demographics endpoint.
 * This function uses the locations endpoint to approximate demographic data.
 */
export async function fetchFDICDemographics(
  metroArea?: string,
  state?: string,
  limit: number = 200
): Promise<{ data: DemographicsData[]; error?: string }> {
  const filters: Record<string, any> = {}

  if (metroArea) {
    filters.CBSANAME = `"${metroArea}"`
  }

  // The RISVIEW demographics schema doesn't include a state field; ignore if provided.
  if (state) {
    console.log('Note: demographics schema has no state filter; ignoring state parameter.')
  }

  const response = await fetchFDICData<any>(
    FDIC_ENDPOINTS.demographics,
    {
      filters,
      fields: FDIC_FIELDS.demographics,
      limit,
      sort_by: 'REPDTE',
      sort_order: 'DESC',
    }
  )

  if (response.error) {
    return { data: [], error: response.error }
  }

  const transformed = transformDemographicsData(response.data)
  return { data: transformed }
}

/**
 * Fetch summary/aggregate data
 */
export async function fetchFDICSummary(
  year?: number,
  state?: string
): Promise<{ data: any[]; error?: string }> {
  const filters: Record<string, any> = {}
  
  if (year) {
    filters.YEAR = year
  }
  if (state) {
    filters.STNAME = state.toUpperCase()
  }

  const response = await fetchFDICData<any>(
    FDIC_ENDPOINTS.summary,
    {
      filters,
      fields: FDIC_FIELDS.summary,
      limit: 10,
      sort_by: 'YEAR',
      sort_order: 'DESC',
    }
  )

  if (response.error) {
    return { data: [], error: response.error }
  }

  return { data: response.data }
}

/**
 * Fetch summary of deposits (SOD) data
 */
export async function fetchFDICSod(
  year?: number,
  state?: string,
  limit: number = 100
): Promise<{ data: any[]; error?: string }> {
  const filters: Record<string, any> = {}

  if (year) {
    filters.YEAR = year
  }

  if (state) {
    const stateMap: Record<string, string> = {
      Florida: "FL",
    }
    const stateCode = state.length === 2 ? state.toUpperCase() : stateMap[state] || state
    filters.STALPBR = stateCode
  }

  const response = await fetchFDICData<any>(
    FDIC_ENDPOINTS.sod,
    {
      filters,
      fields: FDIC_FIELDS.sod,
      limit,
      sort_by: 'DEPSUMBR',
      sort_order: 'DESC',
    }
  )

  if (response.error) {
    return { data: [], error: response.error }
  }

  return { data: response.data }
}

