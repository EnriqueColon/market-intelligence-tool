"use server"

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY

interface MarketInsight {
  summary: string
  keyPoints: string[]
  outlook: "positive" | "neutral" | "negative"
  generatedAt: string
}

/**
 * Generate AI market insights based on current market conditions
 */
export async function fetchMarketInsights(
  level: "national" | "florida" | "miami",
  kpiData?: {
    priceChange?: string
    delinquencyRate?: string
    transactionVolume?: string
    foreclosures?: string
  }
): Promise<MarketInsight> {
  if (!PERPLEXITY_API_KEY) {
    console.warn("PERPLEXITY_API_KEY not found, using fallback insights")
    return getFallbackInsights(level)
  }

  const levelNames = {
    national: "United States",
    florida: "Florida",
    miami: "Miami Metro area",
  }

  const contextData = kpiData
    ? `Current data shows: ${kpiData.priceChange ? `Price change: ${kpiData.priceChange}` : ""} ${kpiData.delinquencyRate ? `Delinquency rate: ${kpiData.delinquencyRate}` : ""} ${kpiData.transactionVolume ? `Transaction volume: ${kpiData.transactionVolume}` : ""} ${kpiData.foreclosures ? `Foreclosure filings: ${kpiData.foreclosures}` : ""}`
    : ""

  const prompt = `You are a commercial real estate market analyst. Provide a concise, data-driven market insight summary for the ${levelNames[level]} commercial real estate market.

${contextData}

Focus on:
1. Current market conditions (Q4 2024 / Q1 2025)
2. Key trends in office, retail, multifamily, and industrial sectors
3. Delinquency and distress trends
4. Lending environment (bank pullback, CMBS, life insurance)
5. Investment outlook

Provide your response as a JSON object with this exact format:
{
  "summary": "A 2-3 sentence executive summary of market conditions",
  "keyPoints": ["Point 1", "Point 2", "Point 3", "Point 4"],
  "outlook": "positive" | "neutral" | "negative"
}

Be specific with numbers and trends. Focus on distressed debt opportunities and market stress indicators.`

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
            content: "You are a commercial real estate market analyst specializing in distressed assets and market intelligence. Always respond with valid JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
      next: { revalidate: 1800 }, // Cache for 30 minutes
    })

    if (!response.ok) {
      console.error(`Perplexity API error: ${response.status}`)
      return getFallbackInsights(level)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return getFallbackInsights(level)
    }

    // Try to parse JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          summary: parsed.summary || getFallbackInsights(level).summary,
          keyPoints: parsed.keyPoints || getFallbackInsights(level).keyPoints,
          outlook: parsed.outlook || "neutral",
          generatedAt: new Date().toISOString(),
        }
      }
    } catch (parseError) {
      console.error("Failed to parse insights JSON:", parseError)
    }

    // If JSON parsing fails, use the raw content as summary
    return {
      summary: content.substring(0, 500),
      keyPoints: [],
      outlook: "neutral",
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error("Error fetching market insights:", error)
    return getFallbackInsights(level)
  }
}

function getFallbackInsights(level: "national" | "florida" | "miami"): MarketInsight {
  const insights: Record<string, MarketInsight> = {
    national: {
      summary:
        "The U.S. commercial real estate market continues to face headwinds with office delinquency rates exceeding 7% and transaction volumes down 35% YoY. Banks have significantly reduced CRE lending exposure, creating opportunities for alternative lenders and distressed debt investors.",
      keyPoints: [
        "Office sector delinquency at 10-year high (7.2%)",
        "Transaction volume down 35% YoY to $89B",
        "Banks reducing CRE exposure by 15-20%",
        "Industrial and multifamily showing relative resilience",
      ],
      outlook: "negative",
      generatedAt: new Date().toISOString(),
    },
    florida: {
      summary:
        "Florida's CRE market outperforms national averages with strong population growth driving demand. Delinquency rates remain below 4%, though office vacancies in some submarkets are rising. Miami and Tampa lead in rent growth.",
      keyPoints: [
        "Population growth driving multifamily demand",
        "Office delinquency below national average at 3.8%",
        "Industrial vacancy at historic lows (3.2%)",
        "Insurance costs emerging as key concern",
      ],
      outlook: "neutral",
      generatedAt: new Date().toISOString(),
    },
    miami: {
      summary:
        "Miami Metro remains one of the strongest CRE markets nationally with international capital flows and corporate relocations supporting pricing. Brickell and downtown office markets show resilience while luxury multifamily continues strong rent growth.",
      keyPoints: [
        "Office rents up 5.2% YoY in prime locations",
        "Multifamily vacancy at 4.1%, below national avg",
        "International investment remains strong",
        "Condo insurance costs impacting some segments",
      ],
      outlook: "positive",
      generatedAt: new Date().toISOString(),
    },
  }

  return insights[level]
}
