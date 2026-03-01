"use server"

import { FRED_SERIES } from "@/lib/fred-constants"

export interface DataPoint {
  date: string
  value: number
}

export interface FredDataResponse {
  seriesId: string
  seriesName?: string
  data: DataPoint[]
  error?: string
  metadata?: {
    observationStart?: string
    observationEnd?: string
    count: number
  }
  source?: "fred" | "perplexity" | "fallback"
}

interface ChartDataPoint {
  month: string
  [key: string]: string | number
}

type SeriesResult = {
  data: ChartDataPoint[]
  source: "fred" | "perplexity" | "fallback" | "unavailable"
}

// API Configuration
const FRED_API_KEY = process.env.FRED_API_KEY
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY
const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

// Helper function to add delay between requests (rate limiting)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Fetch data from FRED API with improved error handling
 */
async function fetchFredData(seriesId: string, limit: number = 12): Promise<DataPoint[]> {
  if (!FRED_API_KEY) {
    console.warn("FRED_API_KEY not found, using fallback data")
    return []
  }

  try {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setFullYear(endDate.getFullYear() - 2)
    
    const formatDate = (date: Date) => date.toISOString().split('T')[0]
    
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: FRED_API_KEY,
      file_type: 'json',
      observation_start: formatDate(startDate),
      observation_end: formatDate(endDate),
      sort_order: 'desc',
    })
    
    const url = `${FRED_BASE_URL}?${params.toString()}`
    
    // Add delay to respect rate limits (120 requests per minute = ~500ms between requests)
    await delay(500)
    
    const response = await fetch(url, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    })

    if (!response.ok) {
      let errorMessage = `FRED API error: ${response.status}`
      try {
        const errorData = await response.text()
        if (errorData) {
          try {
            const jsonError = JSON.parse(errorData)
            if (jsonError.error_message) {
              errorMessage = `FRED API error: ${jsonError.error_message}`
            }
          } catch {
            // XML error format from FRED
            const messageMatch = errorData.match(/<error_message>(.*?)<\/error_message>/)
            if (messageMatch) {
              errorMessage = `FRED API error: ${messageMatch[1]}`
            }
          }
        }
      } catch (e) {
        console.error("Error parsing FRED error response:", e)
      }
      console.error(`Error fetching FRED series ${seriesId}:`, errorMessage)
      return []
    }

    const data = await response.json()
    
    if (data.error_code) {
      console.error(`FRED API error for series ${seriesId}: ${data.error_code} - ${data.error_message || 'Unknown error'}`)
      return []
    }
    
    if (!data.observations || data.observations.length === 0) {
      console.warn(`No observations found for series ${seriesId}`)
      return []
    }
    
    const validObservations = data.observations
      .filter((obs: any) => obs.value !== '.' && obs.value !== null && obs.value !== undefined)
      .slice(0, limit)
    
    if (validObservations.length === 0) {
      console.warn(`No valid observations found for series ${seriesId}`)
      return []
    }
    
    return validObservations.map((obs: any) => ({
      date: obs.date,
      value: parseFloat(obs.value) || 0,
    })).reverse()
  } catch (error) {
    console.error(`Error fetching FRED data for series ${seriesId}:`, error)
    return []
  }
}

/**
 * Fetch market data using Perplexity API
 */
async function fetchPerplexityMarketData(
  query: string,
  extractDataPoints: boolean = true
): Promise<any> {
  if (!PERPLEXITY_API_KEY) {
    console.warn("PERPLEXITY_API_KEY not found")
    return null
  }

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "You are a commercial real estate data analyst. Provide accurate, recent data in JSON format when requested. Focus on US CRE markets."
          },
          {
            role: "user",
            content: query,
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
      next: { revalidate: 1800 }, // Cache for 30 minutes (more dynamic than FRED)
    })

    if (!response.ok) {
      let errorMessage = `Perplexity API error: ${response.status}`
      try {
        const errorData = await response.text()
        if (errorData) {
          try {
            const jsonError = JSON.parse(errorData)
            if (jsonError.error?.message) {
              errorMessage = `Perplexity API error: ${jsonError.error.message} (${response.status})`
            } else if (jsonError.message) {
              errorMessage = `Perplexity API error: ${jsonError.message} (${response.status})`
            } else {
              errorMessage = `Perplexity API error: ${errorData.substring(0, 200)} (${response.status})`
            }
          } catch {
            errorMessage = `Perplexity API error: ${errorData.substring(0, 200)} (${response.status})`
          }
        }
      } catch (e) {
        // If we can't parse the error, use the status code
      }
      console.error(errorMessage)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    
    if (!content) {
      console.warn("No content returned from Perplexity")
      return null
    }

    if (extractDataPoints) {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\[[\s\S]*?\]/)
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0])
        } catch (e) {
          console.error("Failed to parse JSON from Perplexity response")
        }
      }
    }
    
    return content
  } catch (error) {
    console.error("Error fetching from Perplexity:", error)
    return null
  }
}

/**
 * Hybrid approach: Try FRED first, fallback to Perplexity, then to static data
 */
export async function fetchPriceIndexData(
  level: "national" | "florida" | "miami"
): Promise<SeriesResult> {
  // Try FRED first
  const fredData = await fetchFredData(FRED_SERIES.priceIndex, 12)
  
  if (fredData.length > 0) {
    return {
      source: "fred",
      data: fredData.map((point) => {
      const date = new Date(point.date)
      const month = date.toLocaleDateString("en-US", { month: "short" })
      return {
        month,
        index: point.value,
      }
      }),
    }
  }

  // Fallback to Perplexity for recent trends
  const levelQueries = {
    national: "What is the current US commercial real estate price index trend for the last 12 months? Provide monthly data points.",
    florida: "What is the current Florida commercial real estate price index trend for the last 12 months? Provide monthly data points.",
    miami: "What is the current Miami Metro commercial real estate price index trend for the last 12 months? Provide monthly data points.",
  }

  const perplexityData = await fetchPerplexityMarketData(
    `${levelQueries[level]} Return only a JSON array with format: [{"month": "Jan", "index": 100.5}, ...]`,
    true
  )

  if (perplexityData && Array.isArray(perplexityData) && perplexityData.length > 0) {
    console.log("Using Perplexity data for price index")
    return { data: perplexityData, source: "perplexity" }
  }

  return { data: [], source: "unavailable" }
}

export async function fetchDelinquencyData(
  level: "national" | "florida" | "miami"
): Promise<ChartDataPoint[]> {
  try {
    // Fetch delinquency data from FRED
    const officeData = await fetchFredData(FRED_SERIES.officeDelinquency, 12)
    
    if (officeData && officeData.length > 0) {
      const chartData = officeData.map((point) => {
        const date = new Date(point.date)
        const month = date.toLocaleDateString("en-US", { month: "short" })
        
        return {
          month,
          rate: Number(point.value.toFixed(2)),
        }
      })
      
      console.log(`Using FRED data for delinquency rates (${level}):`, chartData.length, "points")
      return chartData
    }
  } catch (error) {
    console.error(`Error fetching delinquency data for ${level}:`, error)
    return []
  }
}

export async function fetchTransactionVolumeData(
  level: "national" | "florida" | "miami"
): Promise<SeriesResult> {
  // Transaction volume primarily from Perplexity (not available in FRED)
  const queries = {
    national: "What were the quarterly commercial real estate transaction volumes in the United States for the last 4 quarters? Provide data in billions of dollars.",
    florida: "What were the quarterly commercial real estate transaction volumes in Florida for the last 4 quarters? Provide data in billions of dollars.",
    miami: "What were the quarterly commercial real estate transaction volumes in Miami Metro area for the last 4 quarters? Provide data in billions of dollars.",
  }

  const perplexityData = await fetchPerplexityMarketData(
    `${queries[level]} Return only a JSON array with format: [{"quarter": "Q1 '24", "volume": 38.5}, ...]`,
    true
  )

  if (perplexityData && Array.isArray(perplexityData) && perplexityData.length > 0) {
    console.log("Using Perplexity data for transaction volume")
    return { data: perplexityData.map(d => ({ ...d, month: "" })), source: "perplexity" }
  }

  return { data: [], source: "unavailable" }
}

/**
 * Server action to fetch raw FRED data for inspection with enhanced diagnostics
 */
export async function fetchRawFredData(seriesId: string, limit: number = 50): Promise<FredDataResponse> {
  if (!FRED_API_KEY) {
    return {
      seriesId,
      data: [],
      error: "❌ FRED_API_KEY not found in environment variables. Please add it to your .env.local file.",
      source: "fallback",
    }
  }

  try {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setFullYear(endDate.getFullYear() - 2)
    
    const formatDate = (date: Date) => date.toISOString().split('T')[0]
    
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: FRED_API_KEY,
      file_type: 'json',
      observation_start: formatDate(startDate),
      observation_end: formatDate(endDate),
      sort_order: 'desc',
    })
    
    const url = `${FRED_BASE_URL}?${params.toString()}`
    
    // Add delay for rate limiting
    await delay(500)
    
    const response = await fetch(url, {
      next: { revalidate: 3600 },
    })

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorData = await response.text()
        if (errorData) {
          try {
            const jsonError = JSON.parse(errorData)
            if (jsonError.error_message) {
              errorMessage = jsonError.error_message
            }
          } catch {
            const messageMatch = errorData.match(/<error_message>(.*?)<\/error_message>/)
            if (messageMatch) {
              errorMessage = messageMatch[1]
            }
          }
        }
      } catch (e) {
        // Keep the default error message
      }
      
      // Add helpful context based on common errors
      if (response.status === 400) {
        errorMessage += " (Check if series ID is valid)"
      } else if (response.status === 401 || response.status === 403) {
        errorMessage += " (Check your FRED API key)"
      } else if (response.status === 429) {
        errorMessage += " (Rate limit exceeded - wait 60 seconds)"
      }
      
      return {
        seriesId,
        data: [],
        error: `❌ ${errorMessage}`,
        source: "fallback",
      }
    }

    const data = await response.json()
    
    if (data.error_code) {
      return {
        seriesId,
        data: [],
        error: `❌ ${data.error_code}: ${data.error_message || 'Unknown error'}`,
        source: "fallback",
      }
    }
    
    if (!data.observations || data.observations.length === 0) {
      return {
        seriesId,
        data: [],
        error: "⚠️ No observations found for this series. The series may be discontinued or have no recent data.",
        source: "fallback",
      }
    }
    
    const validObservations = data.observations
      .filter((obs: any) => obs.value !== '.' && obs.value !== null && obs.value !== undefined)
      .slice(0, limit)
    
    const dataPoints = validObservations.map((obs: any) => ({
      date: obs.date,
      value: parseFloat(obs.value) || 0,
    })).reverse()
    
    return {
      seriesId,
      seriesName: data.seriess?.[0]?.title || undefined,
      data: dataPoints,
      metadata: {
        observationStart: data.observation_start || undefined,
        observationEnd: data.observation_end || undefined,
        count: dataPoints.length,
      },
      source: "fred",
    }
  } catch (error) {
    return {
      seriesId,
      data: [],
      error: `❌ ${error instanceof Error ? error.message : "Network error - check your connection"}`,
      source: "fallback",
    }
  }
}

// Fallback data functions (unchanged from your original)
function getFallbackPriceData(level: string): ChartDataPoint[] {
  const baseValues = {
    national: 100,
    florida: 105,
    miami: 110,
  }
  const base = baseValues[level as keyof typeof baseValues]

  return [
    { month: "Jan", index: base - 8 },
    { month: "Feb", index: base - 6 },
    { month: "Mar", index: base - 5 },
    { month: "Apr", index: base - 4 },
    { month: "May", index: base - 3 },
    { month: "Jun", index: base - 2 },
    { month: "Jul", index: base - 1 },
    { month: "Aug", index: base },
    { month: "Sep", index: base + 1 },
    { month: "Oct", index: base + 2 },
    { month: "Nov", index: base + 3 },
    { month: "Dec", index: base + 4 },
  ]
}

function getFallbackTransactionData(level: string): ChartDataPoint[] {
  const scales = {
    national: 1,
    florida: 0.13,
    miami: 0.058,
  }
  const scale = scales[level as keyof typeof scales]

  return [
    { quarter: "Q1 '24", volume: 38.5 * scale, month: "" },
    { quarter: "Q2 '24", volume: 42.1 * scale, month: "" },
    { quarter: "Q3 '24", volume: 35.8 * scale, month: "" },
    { quarter: "Q4 '24", volume: 26.1 * scale, month: "" },
  ]
}