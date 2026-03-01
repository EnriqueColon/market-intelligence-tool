/**
 * Analyst narrative generator for Executive Report.
 * Uses OpenAI to produce institutional-grade narrative from FDIC-derived metrics.
 * Server-side only; never exposes API key to the client.
 */

import type { DispersionStats } from "@/lib/opportunity-score-dispersion"
import type { ExportRow, SummaryByStateRow } from "@/app/actions/export-market-analytics-report"

export type AnalystNarrative = {
  executiveSummary: {
    creExposureOverview: string
    capitalBufferOverview: string
    creditDeteriorationSignals: string
    riskDispersionScreening: string
    implications: string
  }
  sections: {
    creConcentrationAndCapitalExposure: string
    stateBreakdown: string
    bankLevelScreening: string
    creditDeteriorationIndicators: string
    methodologyNarrative: string
  }
  qualityChecks: {
    usedOnlyProvidedNumbers: boolean
    noForecastingLanguage: boolean
  }
}

export type NarrativeInput = {
  scope: "national" | "state"
  state?: string
  asOfQuarter: string
  kpis: {
    institutionsScreened: number
    avgCreConcentration: string
    avgNplRatio: string
    avgNoncurrentLoans: string
    avgReserveCoverage: string
    avgCreToTier1Tier2: string | null
    avgCreToEquity: string | null
    coveragePct: number
  }
  dispersionStats: DispersionStats
  topByCreCapital: ExportRow[]
  topByOpportunityScore: ExportRow[]
  summaryByState: SummaryByStateRow[]
}

const FORBIDDEN_WORDS = /\b(will|forecast|projected|expected)\b/i

function formatRatio(value: number | null | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return value.toFixed(2) + "x"
}

function buildPromptInput(input: NarrativeInput): string {
  const topCre = input.topByCreCapital.slice(0, 15).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    state: r.state,
    creToT1T2: formatRatio(r.capitalRatios?.creToTier1Tier2),
    score: r.opportunityScore,
    crePct: r.creConcentration != null ? r.creConcentration.toFixed(1) + "%" : "—",
    nplPct: r.nplRatio != null ? ((r.nplRatio ?? 0) * 100).toFixed(1) + "%" : "—",
  }))
  const topScore = input.topByOpportunityScore.slice(0, 15).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    state: r.state,
    score: r.opportunityScore,
    creToT1T2: formatRatio(r.capitalRatios?.creToTier1Tier2),
  }))
  const stateSummary = input.scope === "national" && input.summaryByState.length > 0
    ? input.summaryByState.slice(0, 10).map((r) => ({
        state: r.state,
        bankCount: r.bankCount,
        totalAssets: r.totalAssets,
        creLoans: r.creLoans,
        weightedCreToCap: r.weightedAvgCreToCap != null ? r.weightedAvgCreToCap.toFixed(2) + "x" : "—",
      }))
    : []

  return JSON.stringify({
    scope: input.scope,
    state: input.state,
    asOfQuarter: input.asOfQuarter,
    kpis: input.kpis,
    dispersionStats: {
      n: input.dispersionStats.n,
      min: input.dispersionStats.min,
      max: input.dispersionStats.max,
      p10: input.dispersionStats.p10,
      p25: input.dispersionStats.p25,
      p50: input.dispersionStats.p50,
      p75: input.dispersionStats.p75,
      p90: input.dispersionStats.p90,
      iqr: input.dispersionStats.iqr,
      share_ge_70: input.dispersionStats.share_ge_70,
      share_ge_80: input.dispersionStats.share_ge_80,
      dominant_bin: input.dispersionStats.dominant_bin,
      dominant_bin_share: input.dispersionStats.dominant_bin_share,
      dispersion_level: input.dispersionStats.dispersion_level,
    },
    topByCreCapital: topCre,
    topByOpportunityScore: topScore,
    summaryByState: stateSummary,
  }, null, 2)
}

function buildFallbackNarrative(input: NarrativeInput): AnalystNarrative {
  const scopeLabel = input.scope === "national" ? "National" : input.state ?? "State"
  const creOverview = `As of ${input.asOfQuarter}, the FDIC-screened cohort for ${scopeLabel} comprises ${input.kpis.institutionsScreened} institutions. Weighted average CRE concentration stands at ${input.kpis.avgCreConcentration}, with capital-based exposure metrics (CRE/(T1+T2): ${input.kpis.avgCreToTier1Tier2 ?? "—"}, CRE/Equity: ${input.kpis.avgCreToEquity ?? "—"}) reflecting the cohort's aggregate positioning.`
  const capOverview = `Capital data coverage is ${input.kpis.coveragePct.toFixed(1)}% of the screened institutions. Where available, asset-weighted CRE-to-capital ratios provide a regulatory lens on concentration relative to Tier 1 and Tier 2 capital.`
  const creditSignals = `Credit quality indicators for the cohort show average NPL ratio of ${input.kpis.avgNplRatio}, noncurrent-to-loans of ${input.kpis.avgNoncurrentLoans}, and reserve coverage of ${input.kpis.avgReserveCoverage}. These metrics are descriptive of the latest quarter and do not imply forward-looking outcomes.`
  const dispersion = `Opportunity Score distribution exhibits ${input.dispersionStats.dispersion_level} dispersion (median ${input.dispersionStats.p50.toFixed(1)}, IQR ${input.dispersionStats.p25.toFixed(1)}–${input.dispersionStats.p75.toFixed(1)}). ${Math.round(input.dispersionStats.share_ge_80)}% of institutions score >=80; ${Math.round(input.dispersionStats.share_ge_70)}% score >=70. The dominant band is ${input.dispersionStats.dominant_bin} (${input.dispersionStats.dominant_bin_share}%).`
  const implications = `The screen supports a selective approach to identifying institutions with elevated CRE exposure and credit stress indicators. Further due diligence should rely on primary filings and loan-level data.`

  const creSection = `CRE concentration and capital exposure for ${scopeLabel} as of ${input.asOfQuarter} reflect the metrics above. The Opportunity Score composite weights CRE concentration (35%), NPL from noncurrent-to-loans (35%), reserves (15%), and capital (15%) to rank institutions.`
  const stateSection = input.scope === "national" && input.summaryByState.length > 0
    ? `State-level aggregation shows variation in bank count, total assets, and CRE exposure. Top states by weighted CRE-to-capital include: ${input.summaryByState.slice(0, 5).map((r) => `${r.state} (${r.bankCount} banks)`).join("; ")}.`
    : ""
  const bankSection = `Bank-level screening ranks institutions by CRE/(T1+T2) and by Opportunity Score. Top names in the CRE-to-capital ranking reflect elevated concentration relative to regulatory capital.`
  const creditSection = `NPL, noncurrent-to-loans, and reserve metrics are derived from FDIC call reports. The cohort averages are observational and should be interpreted in context of the screening criteria.`
  const methodologySection = `Methodology: CRE/(T1+T2) and CRE/Equity use FDIC regulatory capital ratios. Opportunity Score is a weighted composite (CRE 35%, NPL from noncurrent-to-loans 35%, reserve 15%, capital 15%). Source: FDIC call reports, latest available quarter.`

  return {
    executiveSummary: {
      creExposureOverview: creOverview,
      capitalBufferOverview: capOverview,
      creditDeteriorationSignals: creditSignals,
      riskDispersionScreening: dispersion,
      implications,
    },
    sections: {
      creConcentrationAndCapitalExposure: creSection,
      stateBreakdown: stateSection,
      bankLevelScreening: bankSection,
      creditDeteriorationIndicators: creditSection,
      methodologyNarrative: methodologySection,
    },
    qualityChecks: {
      usedOnlyProvidedNumbers: true,
      noForecastingLanguage: true,
    },
  }
}

function validateNarrative(parsed: unknown, input: NarrativeInput): parsed is AnalystNarrative {
  if (!parsed || typeof parsed !== "object") return false
  const o = parsed as Record<string, unknown>
  if (!o.executiveSummary || typeof o.executiveSummary !== "object") return false
  const es = o.executiveSummary as Record<string, unknown>
  const esKeys = ["creExposureOverview", "capitalBufferOverview", "creditDeteriorationSignals", "riskDispersionScreening", "implications"]
  if (!esKeys.every((k) => typeof es[k] === "string")) return false
  if (!o.sections || typeof o.sections !== "object") return false
  const sec = o.sections as Record<string, unknown>
  const secKeys = ["creConcentrationAndCapitalExposure", "stateBreakdown", "bankLevelScreening", "creditDeteriorationIndicators", "methodologyNarrative"]
  if (!secKeys.every((k) => typeof sec[k] === "string")) return false
  if (!o.qualityChecks || typeof o.qualityChecks !== "object") return false
  const qc = o.qualityChecks as Record<string, unknown>
  if (qc.usedOnlyProvidedNumbers !== true || qc.noForecastingLanguage !== true) return false

  const fullText = [
    ...Object.values(es),
    ...Object.values(sec),
  ].join(" ")
  if (FORBIDDEN_WORDS.test(fullText)) return false

  return true
}

export async function generateAnalystNarrative(input: NarrativeInput): Promise<AnalystNarrative> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return buildFallbackNarrative(input)
  }

  const systemPrompt = `You are a credit/CRE research analyst writing an institutional memo for an investment committee.

You may ONLY use the numeric facts provided in the input JSON. If a metric is missing, explicitly say "data not available for this cohort."
No new stats, no new dates, no invented sources.
Tone: neutral, investment committee, concise but detailed (like an analyst note).
Avoid adjectives like "massive," "crash," "booming," etc.
No recommendations to buy/sell. Use observational framing.
Do NOT use words: will, forecast, projected, expected.
Reference "as of {asOfQuarter}" and the scope (National or state name) in your narrative.`

  const userPrompt = `Using the following FDIC-derived metrics, write a 5–8 paragraph analyst narrative. Return ONLY valid JSON with no markdown or extra text.

Required JSON structure:
{
  "executiveSummary": {
    "creExposureOverview": "1-2 sentences on CRE exposure and concentration",
    "capitalBufferOverview": "1-2 sentences on capital coverage and CRE-to-capital",
    "creditDeteriorationSignals": "1-2 sentences on NPL, noncurrent ratio, reserves",
    "riskDispersionScreening": "1-2 sentences on Opportunity Score distribution",
    "implications": "1-2 sentences on screening implications"
  },
  "sections": {
    "creConcentrationAndCapitalExposure": "paragraph on CRE and capital metrics",
    "stateBreakdown": "paragraph on state-level breakdown (national only; empty string if state scope)",
    "bankLevelScreening": "paragraph on top banks by CRE/capital and Opportunity Score",
    "creditDeteriorationIndicators": "paragraph on credit quality indicators",
    "methodologyNarrative": "paragraph on methodology and data sources"
  },
  "qualityChecks": {
    "usedOnlyProvidedNumbers": true,
    "noForecastingLanguage": true
  }
}

Input facts:
${buildPromptInput(input)}`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.warn("OpenAI narrative API error:", response.status, errText)
      return buildFallbackNarrative(input)
    }

    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content
    if (!content) return buildFallbackNarrative(input)

    const parsed = JSON.parse(content.replace(/^```json\s?|\s?```$/g, "").trim()) as unknown
    if (!validateNarrative(parsed, input)) {
      console.warn("Narrative validation failed, using fallback")
      return buildFallbackNarrative(input)
    }

    return parsed as AnalystNarrative
  } catch (err) {
    console.error("Analyst narrative generation error:", err)
    return buildFallbackNarrative(input)
  }
}
