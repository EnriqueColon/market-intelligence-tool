"use server"

import { unstable_cache } from "next/cache"
import { getLatestFdicQuarter } from "@/app/actions/fdic-latest-quarter"
import { computeCohortWatch, toInput } from "@/app/services/cohort-watch"
import { fetchAcquisitionsBy } from "@/app/services/fdic-structure-events"
import { describeAcquisition, type StructureEvent } from "@/lib/fdic-structure-events"
import type { CohortWatch } from "@/lib/analytics/cohort-watch"
import { buildInstitutionTrend, type InstitutionTrend } from "@/lib/analytics/institution-trend"
import {
  NARRATIVE_SYSTEM,
  buildNarrativeUserPrompt,
  checkNarrative,
  fallbackNarrative,
} from "@/lib/analytics/institution-trend-narrative"
import { callOpenAi, getOpenAiApiKey } from "@/lib/openai"
import { fetchFDICData } from "@/lib/fdic-client"
import { FDIC_ENDPOINTS, FDIC_FIELDS } from "@/lib/fdic-config"
import { transformFinancialData } from "@/lib/fdic-data-transformer"

/**
 * A week, keyed by scope and the published quarter, like the screening table:
 * a new quarter refreshes it by itself, and the timer only exists to pick up
 * amended call reports and FDIC structure records filed after the quarter —
 * a failure on 1 May shows up in `/failures` within days, not at quarter end.
 */
const WATCH_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

export type CohortWatchResult = { ok: true; watch: CohortWatch } | { ok: false; error: string }

/**
 * Deteriorating institutions and exits for the Market Analytics tab.
 *
 * Bump the key version when the change-detection thresholds, the PCA
 * classification or the exit window move, or cached entries keep reporting
 * under the old rules for a week.
 */
export async function getCohortWatch(scope: string): Promise<CohortWatchResult> {
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    async () => {
      const watch = await computeCohortWatch(scope)
      // Throw so unstable_cache stores only successes; an FDIC outage must not
      // blank the panel for a week.
      if (watch.error) throw new Error(watch.error)
      return watch
    },
    ["market-analytics-watch-v1", scope, quarter],
    { revalidate: WATCH_REVALIDATE_SECONDS }
  )
  try {
    return { ok: true, watch: await cached() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to build the cohort watch." }
  }
}

export type InstitutionHistory = {
  cert: string
  /** Institutions this bank has absorbed, newest first, as sentences. */
  acquisitions: { date: string; description: string; absorbedCert?: string }[]
}

/**
 * Corporate history for the institution drawer. Only acquisitions for now:
 * a bank in the drawer is by construction a going concern (it filed for the
 * headline quarter), so the events that can have happened *to* it are the
 * ones where it absorbed somebody else.
 */
export async function getInstitutionHistory(cert: string): Promise<InstitutionHistory> {
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    async () => {
      const events: StructureEvent[] = await fetchAcquisitionsBy(cert)
      return {
        cert,
        acquisitions: events.map((e) => ({
          date: e.date,
          description: describeAcquisition(e, { withDate: false }),
          absorbedCert: e.absorbed?.cert,
        })),
      }
    },
    ["institution-history-v1", cert, quarter],
    { revalidate: WATCH_REVALIDATE_SECONDS }
  )
  try {
    return await cached()
  } catch {
    return { cert, acquisitions: [] }
  }
}

export type InstitutionTrendResult = { ok: true; trend: InstitutionTrend } | { ok: false; error: string }

/** 27 months: nine quarters, one of headroom for the FDIC's publication lag. */
function trendWindowFilter(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 27)
  return `[${d.toISOString().slice(0, 7)}-01 TO *]`
}

/**
 * The last eight quarters for one institution, for the drawer's trend panels.
 *
 * One FDIC call for that CERT — about nine rows — rather than widening the
 * screening payload, which is already near the data-cache ceiling. Cached per
 * CERT and published quarter for a week; only successes are cached.
 */
export async function getInstitutionTrend(cert: string): Promise<InstitutionTrendResult> {
  if (!cert) return { ok: false, error: "No institution selected." }
  try {
    return { ok: true, trend: await loadInstitutionTrend(cert) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to load the institution's history." }
  }
}

/** Cached per CERT and published quarter; throws rather than caching a failure. */
async function loadInstitutionTrend(cert: string): Promise<InstitutionTrend> {
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    async () => {
      const response = await fetchFDICData<Record<string, unknown>>(FDIC_ENDPOINTS.financials, {
        filters: { CERT: cert, REPDTE: trendWindowFilter() },
        fields: FDIC_FIELDS.financials,
        limit: 12,
        sort_by: "REPDTE",
        sort_order: "DESC",
      })
      if (response.error) throw new Error(response.error)
      const rows = transformFinancialData(response.data ?? []).map(toInput)
      if (rows.length === 0) throw new Error(`No FDIC filings for CERT ${cert} in the last 27 months.`)
      return buildInstitutionTrend(cert, rows)
    },
    ["institution-trend-v1", cert, quarter],
    { revalidate: WATCH_REVALIDATE_SECONDS }
  )
  return cached()
}

export type InstitutionTrendNarrative = {
  text: string
  /** `model` passed the figure check; `fallback` is built from the signals alone. */
  source: "model" | "fallback"
  /** Why the model's answer was not used, when it was not. */
  note?: string
}

/**
 * The analyst reading under the trend panels. The model sees only the eight
 * quarters the panels plot; its answer is shown only if every figure in it is
 * one from that table (`checkNarrative`), otherwise the deterministic reading
 * built from the signals is shown instead. Cached per CERT and quarter for a
 * week; a fallback produced by a model failure is not cached, so the next
 * open tries again.
 */
export async function getInstitutionTrendNarrative(cert: string): Promise<InstitutionTrendNarrative | null> {
  if (!cert) return null
  let trend: InstitutionTrend
  try {
    trend = await loadInstitutionTrend(cert)
  } catch {
    return null
  }
  if (trend.points.length < 2) return { text: fallbackNarrative(trend), source: "fallback" }
  if (!getOpenAiApiKey()) {
    return { text: fallbackNarrative(trend), source: "fallback", note: "No model configured." }
  }
  const quarter = await getLatestFdicQuarter()
  const cached = unstable_cache(
    async (): Promise<InstitutionTrendNarrative> => {
      const text = await callOpenAi({
        system: NARRATIVE_SYSTEM,
        user: buildNarrativeUserPrompt(trend),
        // One short, checked, week-cached call per bank: worth the full model.
        // The mini tier misread a 0.7% allowance as "above the 1% screen".
        model: process.env.OPENAI_TREND_MODEL?.trim() || "gpt-4.1",
        temperature: 0.2,
        maxTokens: 450,
        timeoutMs: 30_000,
      })
      const check = checkNarrative(text, trend)
      if (!check.ok) {
        // Cache the fallback too: the same table will draw the same slip
        // again, and the reader should not wait on it twice.
        return { text: fallbackNarrative(trend), source: "fallback", note: `Model reading withheld — ${check.reason}.` }
      }
      return { text, source: "model" }
    },
    ["institution-trend-narrative-v1", cert, quarter],
    { revalidate: WATCH_REVALIDATE_SECONDS }
  )
  try {
    return await cached()
  } catch (error) {
    const message = error instanceof Error ? error.message : "model call failed"
    return { text: fallbackNarrative(trend), source: "fallback", note: `Model reading unavailable — ${message}.` }
  }
}
