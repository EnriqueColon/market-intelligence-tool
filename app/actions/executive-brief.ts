"use server"

/**
 * What moved this quarter, for the Executive Brief.
 *
 * Deliberately narrow. An executive's question is "what changed and what needs
 * me", not "show me every institution", so this returns a short ranked list of
 * events rather than a cohort. The screening table already serves the other
 * question and is untouched.
 *
 * Built on the quarters the tool already fetches for its trend sparklines, so
 * this costs one FDIC round trip rather than a new data source.
 */

import { unstable_cache } from "next/cache"
import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { computeCapitalRatios } from "@/lib/fdic-ratio-helpers"
import {
  detectChanges,
  groupForBrief,
  type InstitutionChange,
  type QuarterObservation,
} from "@/lib/scoring/institution-change"

export type BriefEvent = InstitutionChange & {
  cert: string
  name: string
  state?: string
}

export type ExecutiveBrief = {
  scope: string
  asOfQuarter: string | null
  institutionCount: number
  /** Institutions with at least one event, not the number of events. */
  movedCount: number
  /**
   * True when the FDIC row cap bound the query, so this covers the largest
   * institutions rather than every one. Nine quarters per institution means the
   * cap is reached at roughly a thousand of them.
   */
  capped: boolean
  supervisoryCrossings: BriefEvent[]
  otherCrossings: BriefEvent[]
  trajectories: BriefEvent[]
  error?: string
}

/** How many of each kind to surface. A brief that needs scrolling is not a brief. */
const PER_SECTION = 6

/** Matches the screening tab, so the brief and the table see the same cohort. */
const ROW_CAP = 10000

const EMPTY = (scope: string, error?: string): ExecutiveBrief => ({
  scope,
  asOfQuarter: null,
  institutionCount: 0,
  movedCount: 0,
  capped: false,
  supervisoryCrossings: [],
  otherCrossings: [],
  trajectories: [],
  error,
})

/**
 * Treats an exact zero as not reported.
 *
 * For capital and reserve coverage a true zero does not describe a going
 * concern — an institution with no capital is closed, not flagged — so a zero
 * here is a gap in the call report. Reading it as fact produces a dramatic and
 * entirely fictional collapse, which is worse than reporting nothing.
 */
function reported(value: number | null | undefined): number | null {
  return value ? value : null
}

function toObservation(bank: {
  reportDate?: string
  totalAssets: number
  creLoans?: number
  constructionLoans?: number
  multifamilyLoans?: number
  leverageRatio: number
  tier1RbcRatio: number
  totalRbcRatio: number
  cet1Ratio: number
  totalEquityDollars?: number | null
  tier1Dollars?: number | null
  tier2Dollars?: number | null
  riskWeightedAssets?: number | null
  noncurrent_to_loans_ratio?: number
  loanLossReserve?: number
}): QuarterObservation {
  const ratios = computeCapitalRatios({
    totalAssets: bank.totalAssets,
    creLoans: bank.creLoans ?? 0,
    constructionLoans: bank.constructionLoans ?? 0,
    multifamilyLoans: bank.multifamilyLoans ?? 0,
    leverageRatio: bank.leverageRatio,
    tier1RbcRatio: bank.tier1RbcRatio,
    totalRbcRatio: bank.totalRbcRatio,
    cet1Ratio: bank.cet1Ratio,
    totalEquityDollars: bank.totalEquityDollars,
    tier1Dollars: bank.tier1Dollars,
    tier2Dollars: bank.tier2Dollars,
    riskWeightedAssets: bank.riskWeightedAssets,
  })

  return {
    quarter: String(bank.reportDate ?? ""),
    creToCapital: ratios?.creToTier1Tier2 ?? null,
    constructionToCapital: ratios?.constructionToTier1Tier2 ?? null,
    noncurrentRatio: bank.noncurrent_to_loans_ratio ?? null,
    reserveCoverage: reported(bank.loanLossReserve),
    // CET1 only, never falling back to the leverage ratio. Substituting a
    // different ratio for a quarter that did not report one compares two
    // different measures and invents a swing: it produced a "capital ratio fell
    // from 31.39% to 1.14%" finding for a healthy bank.
    capitalRatio: reported(bank.cet1Ratio),
  }
}

async function computeBrief(scope: string): Promise<ExecutiveBrief> {
  const state = scope === "National" || scope === "national" ? undefined : scope
  const { data, error } = await fetchFDICFinancials(state, ROW_CAP, false)
  if (error) return EMPTY(scope, error)
  if (!data.length) return EMPTY(scope)

  const byCert = new Map<string, { name: string; state?: string; rows: typeof data }>()
  for (const row of data) {
    const cert = String(row.id ?? "")
    if (!cert) continue
    const existing = byCert.get(cert)
    if (existing) existing.rows.push(row)
    else byCert.set(cert, { name: row.name, state: row.state, rows: [row] })
  }

  const events: BriefEvent[] = []
  let movedCount = 0
  let latestQuarter = ""

  for (const [cert, { name, state: bankState, rows }] of byCert) {
    for (const r of rows) {
      const q = String(r.reportDate ?? "")
      if (q > latestQuarter) latestQuarter = q
    }

    const changes = detectChanges(rows.map(toObservation))
    if (changes.length === 0) continue
    movedCount++
    for (const change of changes) {
      events.push({ ...change, cert, name, state: bankState })
    }
  }

  return {
    scope,
    asOfQuarter: latestQuarter || null,
    institutionCount: byCert.size,
    movedCount,
    capped: data.length >= ROW_CAP,
    ...groupForBrief(events, PER_SECTION),
  }
}

/**
 * Cached for six hours under a versioned key, matching the report data.
 * **Bump the version when change-detection thresholds move**, or the brief will
 * keep reporting events under the old rules until the window expires.
 */
export async function getExecutiveBrief(scope: string): Promise<ExecutiveBrief> {
  const cached = unstable_cache(
    () => computeBrief(scope),
    ["executive-brief-v2", scope],
    { revalidate: 60 * 60 * 6 }
  )
  return cached()
}
