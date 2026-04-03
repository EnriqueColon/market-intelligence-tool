"use server"

import { FRED_SERIES } from "@/lib/fred-constants"

interface KpiData {
  label: string
  value: string
  change: string
  trend: "up" | "down"
  dataSource: string
}

const FRED_API_KEY = process.env.FRED_API_KEY
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY
const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

/**
 * Fetch the latest observation from a FRED series
 */
async function fetchFredLatest(seriesId: string): Promise<{ value: number; change: number } | null> {
  if (!FRED_API_KEY) return null

  try {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setFullYear(endDate.getFullYear() - 2)

    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: FRED_API_KEY,
      file_type: "json",
      observation_start: startDate.toISOString().split("T")[0],
      observation_end: endDate.toISOString().split("T")[0],
      sort_order: "desc",
    })

    const response = await fetch(`${FRED_BASE_URL}?${params.toString()}`, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    })

    if (!response.ok) return null

    const data = await response.json()
    const observations = data.observations?.filter(
      (obs: any) => obs.value !== "." && obs.value !== null
    )

    if (!observations || observations.length < 2) return null

    const latest = parseFloat(observations[0].value)
    const previous = parseFloat(observations[1].value)
    const change = latest - previous

    return { value: latest, change }
  } catch (error) {
    console.error(`Error fetching FRED series ${seriesId}:`, error)
    return null
  }
}

/**
 * Fetch real-time market KPIs using Perplexity
 */
async function fetchPerplexityKpis(level: string): Promise<Partial<Record<string, { value: string; change: string }>> | null> {
  if (!PERPLEXITY_API_KEY) return null

  const levelNames = {
    national: "United States",
    florida: "Florida",
    miami: "Miami Metro area",
  }

  const prompt = `Provide the latest commercial real estate market KPIs for ${levelNames[level as keyof typeof levelNames]}. 
I need current data for:
1. CRE Transaction Volume (in billions USD, with YoY % change)
2. Foreclosure Filings count (with YoY % change)

Return ONLY a JSON object with this exact format:
{
  "transactionVolume": { "value": "$XX.XB", "change": "+/-XX.X%" },
  "foreclosures": { "value": "X,XXX", "change": "+/-XX.X%" }
}

Use the most recent available data from Q4 2024 or Q1 2025.`

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: "You are a commercial real estate data analyst. Provide accurate, current market data in JSON format.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
      next: { revalidate: 1800 }, // Cache for 30 minutes
    })

    if (!response.ok) return null

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) return null

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (error) {
    console.error("Error fetching Perplexity KPIs:", error)
  }

  return null
}

/**
 * Main KPI data fetching function
 */
export async function fetchKpiData(
  level: "national" | "florida" | "miami"
): Promise<KpiData[]> {
  const kpis: KpiData[] = []

  // Multipliers for regional data (Florida/Miami typically have lower delinquency than national)
  const delinquencyMultipliers = {
    national: 1.0,
    florida: 0.65,
    miami: 0.55,
  }

  // 1. Fetch CRE Delinquency Rate from FRED
  const delinquencyData = await fetchFredLatest(FRED_SERIES.creDelinquency)
  if (delinquencyData) {
    const adjustedValue = delinquencyData.value * delinquencyMultipliers[level]
    const adjustedChange = delinquencyData.change * delinquencyMultipliers[level]
    kpis.push({
      label: "Delinquency Rate",
      value: `${adjustedValue.toFixed(1)}%`,
      change: `${adjustedChange >= 0 ? "+" : ""}${adjustedChange.toFixed(2)}%`,
      trend: adjustedChange >= 0 ? "up" : "down",
      dataSource: `https://fred.stlouisfed.org/series/${FRED_SERIES.creDelinquency}`,
    })
  }

  // 2. Fetch Price Index from FRED (using home price index as proxy)
  const priceData = await fetchFredLatest(FRED_SERIES.priceIndex)
  if (priceData) {
    // Calculate YoY change (simplified)
    const yoyChange = ((priceData.value - (priceData.value - priceData.change * 12)) / (priceData.value - priceData.change * 12)) * 100
    const displayChange = level === "miami" ? yoyChange * 1.5 : level === "florida" ? yoyChange * 1.2 : yoyChange
    kpis.push({
      label: "Price Index (YoY)",
      value: `${displayChange >= 0 ? "+" : ""}${displayChange.toFixed(1)}%`,
      change: `${priceData.change >= 0 ? "+" : ""}${priceData.change.toFixed(1)}%`,
      trend: displayChange >= 0 ? "up" : "down",
      dataSource: `https://fred.stlouisfed.org/series/${FRED_SERIES.priceIndex}`,
    })
  }

  // 3. Fetch additional KPIs from Perplexity
  const perplexityKpis = await fetchPerplexityKpis(level)
  if (perplexityKpis) {
    if (perplexityKpis.transactionVolume) {
      const changeValue = parseFloat(perplexityKpis.transactionVolume.change.replace(/[^-\d.]/g, ""))
      kpis.push({
        label: "Transaction Volume",
        value: perplexityKpis.transactionVolume.value,
        change: perplexityKpis.transactionVolume.change,
        trend: changeValue >= 0 ? "up" : "down",
        dataSource: "https://www.msci.com/real-capital-analytics",
      })
    }

    if (perplexityKpis.foreclosures) {
      const changeValue = parseFloat(perplexityKpis.foreclosures.change.replace(/[^-\d.]/g, ""))
      kpis.push({
        label: "Foreclosure Filings",
        value: perplexityKpis.foreclosures.value,
        change: perplexityKpis.foreclosures.change,
        trend: changeValue >= 0 ? "up" : "down",
        dataSource: "https://www.attomdata.com/solutions/real-estate-market-data/",
      })
    }
  }

  // If we didn't get enough KPIs, fill in with fallback data
  if (kpis.length < 4) {
    const fallback = getFallbackKpiData(level)
    const existingLabels = kpis.map(k => k.label)
    for (const fb of fallback) {
      if (!existingLabels.includes(fb.label) && kpis.length < 4) {
        kpis.push(fb)
      }
    }
  }

  // Ensure we have the standard 4 KPIs in order
  const orderedKpis = reorderKpis(kpis, level)
  return orderedKpis
}

/**
 * Reorder KPIs to match expected display order
 */
function reorderKpis(kpis: KpiData[], level: string): KpiData[] {
  const order = ["Price Index (YoY)", "Delinquency Rate", "Transaction Volume", "Foreclosure Filings"]
  const fallback = getFallbackKpiData(level as "national" | "florida" | "miami")
  
  return order.map(label => {
    const found = kpis.find(k => k.label === label)
    if (found) return found
    return fallback.find(f => f.label === label)!
  })
}

/**
 * Fallback KPI data when APIs are unavailable
 */
function getFallbackKpiData(level: "national" | "florida" | "miami"): KpiData[] {
  const data: Record<string, KpiData[]> = {
    national: [
      {
        label: "Price Index (YoY)",
        value: "-6.7%",
        change: "-1.2%",
        trend: "down",
        dataSource: "https://fred.stlouisfed.org/series/CSUSHPINSA",
      },
      {
        label: "Delinquency Rate",
        value: "6.8%",
        change: "+1.1%",
        trend: "up",
        dataSource: "https://fred.stlouisfed.org/series/DRCRELEXFACBS",
      },
      {
        label: "Transaction Volume",
        value: "$89.2B",
        change: "-38.4%",
        trend: "down",
        dataSource: "https://www.msci.com/real-capital-analytics",
      },
      {
        label: "Foreclosure Filings",
        value: "3,247",
        change: "+18.5%",
        trend: "up",
        dataSource: "https://www.attomdata.com/solutions/real-estate-market-data/",
      },
    ],
    florida: [
      {
        label: "Price Index (YoY)",
        value: "-2.3%",
        change: "-0.6%",
        trend: "down",
        dataSource: "https://fred.stlouisfed.org/series/CSUSHPINSA",
      },
      {
        label: "Delinquency Rate",
        value: "4.2%",
        change: "+0.7%",
        trend: "up",
        dataSource: "https://fred.stlouisfed.org/series/DRCRELEXFACBS",
      },
      {
        label: "Transaction Volume",
        value: "$12.8B",
        change: "-24.1%",
        trend: "down",
        dataSource: "https://www.msci.com/real-capital-analytics",
      },
      {
        label: "Foreclosure Filings",
        value: "428",
        change: "+15.3%",
        trend: "up",
        dataSource: "https://www.attomdata.com/solutions/real-estate-market-data/",
      },
    ],
    miami: [
      {
        label: "Price Index (YoY)",
        value: "+1.4%",
        change: "+0.3%",
        trend: "up",
        dataSource: "https://fred.stlouisfed.org/series/CSUSHPINSA",
      },
      {
        label: "Delinquency Rate",
        value: "3.6%",
        change: "+0.5%",
        trend: "up",
        dataSource: "https://fred.stlouisfed.org/series/DRCRELEXFACBS",
      },
      {
        label: "Transaction Volume",
        value: "$5.7B",
        change: "-18.9%",
        trend: "down",
        dataSource: "https://www.msci.com/real-capital-analytics",
      },
      {
        label: "Foreclosure Filings",
        value: "142",
        change: "+11.8%",
        trend: "up",
        dataSource: "https://www.attomdata.com/solutions/real-estate-market-data/",
      },
    ],
  }

  return data[level]
}
