"use server"

import { buildExportData } from "@/app/actions/export-market-analytics-report"
import {
  generateAnalystNarrative,
  type AnalystNarrative,
  type NarrativeInput,
} from "@/lib/report/narrative/generate-analyst-narrative"

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const narrativeCache = new Map<string, { narrative: AnalystNarrative; expires: number }>()

function cacheKey(scope: string, state: string | undefined, asOfQuarter: string): string {
  return `${scope}|${state ?? "national"}|${asOfQuarter}`
}

export async function fetchAnalystNarrative(
  scope: "National" | string,
  state?: string
): Promise<{ narrative: AnalystNarrative | null; error?: string }> {
  try {
    const data = await buildExportData(scope)
    const asOfQuarter = data.asOfQuarter
    const key = cacheKey(scope, state, asOfQuarter)

    const cached = narrativeCache.get(key)
    if (cached && cached.expires > Date.now()) {
      return { narrative: cached.narrative }
    }

    const narrativeScope: "national" | "state" = scope === "National" ? "national" : "state"
    const kpiInstitutions = data.kpis.find((k) => k.label === "Institutions Screened")?.value ?? "0"
    const kpiNpl = data.kpis.find((k) => k.label === "Avg NPL Ratio")?.value ?? "—"
    const kpiNoncurrentLoans = data.kpis.find((k) => k.label === "Avg Noncurrent / Loans")?.value ?? "—"
    const kpiReserve = data.kpis.find((k) => k.label === "Avg Reserve Coverage")?.value ?? "—"
    const kpiCre = data.kpis.find((k) => k.label === "Avg CRE Concentration")?.value ?? "—"

    const input: NarrativeInput = {
      scope: narrativeScope,
      state: narrativeScope === "state" ? scope : undefined,
      asOfQuarter,
      kpis: {
        institutionsScreened: Number(kpiInstitutions) || 0,
        avgCreConcentration: kpiCre,
        avgNplRatio: kpiNpl,
        avgNoncurrentLoans: kpiNoncurrentLoans,
        avgReserveCoverage: kpiReserve,
        avgCreToTier1Tier2:
          data.capitalKpis.avgCreToTier1Tier2 != null
            ? data.capitalKpis.avgCreToTier1Tier2.toFixed(2) + "x"
            : null,
        avgCreToEquity:
          data.capitalKpis.avgCreToEquity != null
            ? data.capitalKpis.avgCreToEquity.toFixed(2) + "x"
            : null,
        coveragePct: data.capitalKpis.coveragePct,
      },
      dispersionStats: data.dispersionStats,
      topByCreCapital: data.topByCreToCapital,
      topByOpportunityScore: data.topByOpportunityScore,
      summaryByState: data.summaryByState,
    }

    const narrative = await generateAnalystNarrative(input)
    narrativeCache.set(key, { narrative, expires: Date.now() + CACHE_TTL_MS })

    return { narrative }
  } catch (err) {
    console.error("fetchAnalystNarrative error:", err)
    return {
      narrative: null,
      error: err instanceof Error ? err.message : "Failed to generate narrative",
    }
  }
}
