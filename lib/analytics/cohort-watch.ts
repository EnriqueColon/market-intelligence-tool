/**
 * Who is deteriorating, and who has left — the Market Analytics tab's answer
 * to "what changed", built from the quarters already fetched for the table.
 *
 * The screening table is a snapshot: it can say an institution is stressed
 * today, not that it is becoming stressed, and since it admits only banks that
 * filed for the headline quarter it has nothing to say about a bank that just
 * failed or merged. Both facts matter to someone looking for business. A bank
 * that is slipping is an opportunity before it is a headline; a bank that has
 * gone means its loan book and its branches now belong to somebody else, and
 * that somebody is the new counterparty.
 *
 * Two lists come out of this:
 *
 *  - **Deteriorating** — headline-quarter filers with a capital-category
 *    downgrade (Prompt Corrective Action, published thresholds), a threshold
 *    crossing or a multi-quarter adverse trend, from `institution-change.ts`.
 *    Ranked so a bank that just became undercapitalised outranks one whose
 *    reserves have thinned for three quarters.
 *  - **Exits** — institutions in the data whose newest filing predates the
 *    headline quarter by at most `EXIT_WINDOW_QUARTERS`. Older gaps are counted,
 *    not listed: a bank that stopped filing six quarters ago is history, not
 *    news. The FDIC structure records say why each one went; a bank with no
 *    record yet is reported as exactly that.
 *
 * This file is pure. Fetching and caching are in `app/services/cohort-watch.ts`.
 */

import { classifyCapital, describeCapitalDowngrade, CATEGORY_RANK, type CapitalClassification } from "@/lib/scoring/capital-category"
import { detectChanges, type InstitutionChange, type QuarterObservation } from "@/lib/scoring/institution-change"
import { headlineQuarter, normalizeReportDate } from "@/lib/analytics/headline-filing"
import { describeExit, type FailureRecord, type StructureEvent } from "@/lib/fdic-structure-events"

/** The subset of `BankFinancialData` this needs; kept narrow so tests can build rows by hand. */
export type WatchInputRow = {
  id: string
  name: string
  city?: string
  state?: string
  reportDate?: string
  totalAssets: number
  creLoans?: number
  constructionLoans?: number
  multifamilyLoans?: number
  noncurrent_to_loans_ratio?: number
  loanLossReserve?: number
  cet1Ratio: number | null
  leverageRatio: number | null
  tier1RbcRatio: number | null
  totalRbcRatio: number | null
  totalEquityDollars?: number | null
  /** CRE ÷ (Tier 1 + Tier 2), as a multiple, already computed. */
  creToTier1Tier2?: number | null
  constructionToTier1Tier2?: number | null
}

export type WatchSignal = {
  kind: "capital" | "crossing" | "trajectory"
  /** Sentence, display as-is. */
  description: string
  supervisory?: boolean
}

export type WatchItem = {
  cert: string
  name: string
  city?: string
  state?: string
  totalAssets: number
  /** Latest-quarter PCA category, when a capital ratio was reported. */
  capital: { category: CapitalClassification["category"]; label: string; binding: string } | null
  signals: WatchSignal[]
  /** Unitless ranking score; higher is more urgent. */
  severity: number
}

export type CohortExit = {
  cert: string
  name: string
  city?: string
  state?: string
  /** Assets on its final filing. */
  totalAssets: number
  /** Final filing, `YYYYMMDD`. */
  lastQuarter: string
  quartersStale: number
  kind: "failure" | "merger" | "closing" | "other" | "unknown"
  /** ISO date of the structure event, when recorded. */
  date?: string
  acquirer?: string
  description: string
  /** Dollars; failures only. */
  estimatedCost?: number | null
}

export type CohortWatch = {
  scope: string
  asOfQuarter: string | null
  /** Headline-quarter filers examined. */
  institutionCount: number
  /** True when the FDIC row cap bound the query, so this is the largest institutions only. */
  capped: boolean
  deteriorating: WatchItem[]
  /** Institutions with at least one signal, before the cap. */
  deterioratingCount: number
  exits: CohortExit[]
  /** Exits inside the window, before the cap. */
  exitsCount: number
  /** Non-filers older than the window: counted so the reader knows they exist. */
  exitsOlder: number
  error?: string
}

/** Quarters of staleness up to which a non-filer is listed as an exit. */
export const EXIT_WINDOW_QUARTERS = 2
export const MAX_DETERIORATING = 12
export const MAX_EXITS = 25

/** Zero capital or reserves is a reporting gap, not a figure; see executive-brief.ts. */
const reported = (v: number | null | undefined) => (v ? v : null)

export function toObservation(row: WatchInputRow): QuarterObservation {
  return {
    quarter: normalizeReportDate(row.reportDate),
    creToCapital: row.creToTier1Tier2 ?? null,
    constructionToCapital: row.constructionToTier1Tier2 ?? null,
    noncurrentRatio: row.noncurrent_to_loans_ratio ?? null,
    reserveCoverage: reported(row.loanLossReserve),
    // CET1 only, never the leverage fallback: mixing the two invents a swing.
    capitalRatio: reported(row.cet1Ratio),
  }
}

export function classifyRow(row: WatchInputRow): CapitalClassification | null {
  const equityPct =
    row.totalEquityDollars != null && row.totalAssets > 0 ? (row.totalEquityDollars / row.totalAssets) * 100 : null
  return classifyCapital({
    leverageRatio: row.leverageRatio,
    tier1RbcRatio: row.tier1RbcRatio,
    totalRbcRatio: row.totalRbcRatio,
    cet1Ratio: row.cet1Ratio,
    equityToAssetsPct: equityPct,
  })
}

function severityOf(signals: WatchSignal[], capital: CapitalClassification | null): number {
  let score = 0
  for (const s of signals) {
    if (s.kind === "capital") score += 100 + (capital ? CATEGORY_RANK[capital.category] * 25 : 0)
    else if (s.kind === "crossing") score += s.supervisory ? 50 : 30
    else score += 10
  }
  // A bank already below well-capitalised is more urgent at equal signals.
  if (capital && capital.category !== "well") score += CATEGORY_RANK[capital.category] * 5
  return score
}

function toSignal(change: InstitutionChange): WatchSignal {
  return change.kind === "crossing"
    ? { kind: "crossing", description: change.description, supervisory: change.supervisory }
    : { kind: "trajectory", description: change.description }
}

/**
 * Signals for one institution from its quarters, oldest or newest first — the
 * order does not matter. Returns `null` when nothing adverse was found.
 */
export function watchInstitution(rows: WatchInputRow[]): WatchItem | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => normalizeReportDate(b.reportDate).localeCompare(normalizeReportDate(a.reportDate)))
  const latest = sorted[0]
  const previous = sorted[1]

  const signals: WatchSignal[] = []
  const latestCapital = classifyRow(latest)
  if (previous) {
    const downgrade = describeCapitalDowngrade(classifyRow(previous), latestCapital)
    if (downgrade) signals.push({ kind: "capital", description: downgrade })
  }
  for (const change of detectChanges(rows.map(toObservation))) signals.push(toSignal(change))
  if (signals.length === 0) return null

  return {
    cert: latest.id,
    name: latest.name,
    city: latest.city,
    state: latest.state,
    totalAssets: latest.totalAssets,
    capital: latestCapital
      ? { category: latestCapital.category, label: latestCapital.label, binding: latestCapital.binding }
      : null,
    signals: signals.slice(0, 3),
    severity: severityOf(signals, latestCapital),
  }
}

/** Whole quarters from `earlier` to `later`, both `YYYYMMDD`. */
export function quartersBetween(earlier: string, later: string): number {
  if (!/^\d{8}$/.test(earlier) || !/^\d{8}$/.test(later)) return 0
  const index = (q: string) => Number(q.slice(0, 4)) * 4 + Math.ceil(Number(q.slice(4, 6)) / 3)
  return index(later) - index(earlier)
}

export type ExitCandidate = Omit<CohortExit, "kind" | "description" | "date" | "acquirer" | "estimatedCost">

/**
 * Split the cohort: headline-quarter filers go to the watch, non-filers inside
 * the window become exit candidates awaiting their structure record.
 */
export function partitionCohort(rows: WatchInputRow[]): {
  asOfQuarter: string
  watched: WatchItem[]
  deterioratingCount: number
  institutionCount: number
  exitCandidates: ExitCandidate[]
  exitsOlder: number
} {
  const headline = headlineQuarter(rows)
  const byCert = new Map<string, WatchInputRow[]>()
  for (const row of rows) {
    if (!row.id) continue
    const list = byCert.get(row.id)
    if (list) list.push(row)
    else byCert.set(row.id, [row])
  }

  const watched: WatchItem[] = []
  const exitCandidates: ExitCandidate[] = []
  let institutionCount = 0
  let exitsOlder = 0

  for (const [cert, group] of byCert) {
    const quarters = group.map((r) => normalizeReportDate(r.reportDate))
    if (!quarters.includes(headline)) {
      const lastQuarter = quarters.reduce((max, q) => (q > max ? q : max), "")
      const stale = quartersBetween(lastQuarter, headline)
      if (stale > EXIT_WINDOW_QUARTERS) {
        exitsOlder++
        continue
      }
      const final = group.find((r) => normalizeReportDate(r.reportDate) === lastQuarter) ?? group[0]
      exitCandidates.push({
        cert,
        name: final.name,
        city: final.city,
        state: final.state,
        totalAssets: final.totalAssets,
        lastQuarter,
        quartersStale: stale,
      })
      continue
    }
    institutionCount++
    const item = watchInstitution(group)
    if (item) watched.push(item)
  }

  watched.sort((a, b) => b.severity - a.severity || b.totalAssets - a.totalAssets)
  return {
    asOfQuarter: headline,
    watched: watched.slice(0, MAX_DETERIORATING),
    deterioratingCount: watched.length,
    institutionCount,
    exitCandidates,
    exitsOlder,
  }
}

/** Attach the structure record to each exit candidate and rank the list. */
export function resolveExits(
  candidates: ExitCandidate[],
  records: Map<string, { event: StructureEvent | null; failure: FailureRecord | null }>
): CohortExit[] {
  const exits = candidates.map((c): CohortExit => {
    const record = records.get(c.cert) ?? { event: null, failure: null }
    const kind: CohortExit["kind"] = record.failure
      ? "failure"
      : record.event
        ? record.event.kind === "merger" || record.event.kind === "failure" || record.event.kind === "closing"
          ? record.event.kind
          : "other"
        : "unknown"
    return {
      ...c,
      kind,
      date: record.failure?.failDate || record.event?.date || undefined,
      acquirer: record.failure?.acquirer?.name || record.event?.acquirer?.name,
      description: describeExit(record.event, record.failure),
      estimatedCost: record.failure?.estimatedCost ?? undefined,
    }
  })
  const order: Record<CohortExit["kind"], number> = { failure: 0, closing: 1, merger: 2, other: 3, unknown: 4 }
  exits.sort((a, b) => order[a.kind] - order[b.kind] || b.totalAssets - a.totalAssets)
  return exits
}
