/**
 * The Underwriter Workbench's analysis of one institution.
 *
 * Pure, and separate from the server action that feeds it, so the same code
 * runs in the browser, in tests and in the verification script. The three
 * data-accuracy bugs found in this tool so far all survived a passing build,
 * and all three would have been caught by exercising the shipped function
 * against live figures — which is only possible if the function is reachable
 * without a Next.js runtime around it.
 *
 * Answers three questions the screening table does not:
 *
 *  1. **Compared to whom?** The table ranks against the whole scope. An
 *     underwriter needs a defensible peer set. See `peer-cohort.ts`.
 *  2. **What is already flagged?** Which supervisory and conventional levels
 *     this institution currently sits past, reusing the Executive Brief's
 *     thresholds so the two lenses cannot drift apart.
 *  3. **How much room is there?** How large a loss on the CRE book it absorbs
 *     before reaching its regulatory floor. See `cre-downside.ts`.
 */

import { computeCapitalRatios } from "@/lib/fdic-ratio-helpers"
import { METRIC_SPECS, type MetricKey } from "@/lib/scoring/institution-change"
import { computeDownside, type DownsideScenario } from "@/lib/scoring/cre-downside"
import {
  medianOf,
  percentileIn,
  selectPeers,
  type PeerCohort,
} from "@/lib/scoring/peer-cohort"

/** The shape the workbench needs. Structurally identical to `WorkbenchRow`. */
export type WorkbenchInput = {
  cert: string
  name: string
  city?: string
  state?: string
  totalAssets: number
  totalLoans: number
  creLoans: number
  constructionLoans: number
  multifamilyLoans: number
  tier1Dollars: number | null
  tier2Dollars: number | null
  riskWeightedAssets: number | null
  totalRbcRatio: number | null
  leverageRatio: number | null
  noncurrentRatio: number | null
  reserveCoverage: number | null
}

/** Metrics compared against peers. A subset of the change engine's, plus mix. */
export type ComparableKey =
  | "creToCapital"
  | "constructionToCapital"
  | "creShareOfLoans"
  | "noncurrentRatio"
  | "reserveCoverage"

export type PeerComparison = {
  key: ComparableKey
  label: string
  /** The subject's value, or null when it does not report the inputs. */
  value: number | null
  /** Middle of the peer cohort. */
  peerMedian: number | null
  /** 0–1, or null when the cohort is too small to support the claim. */
  percentile: number | null
  /** Which direction is worse, for colouring and for reading the percentile. */
  adverse: "rising" | "falling"
  format: (value: number) => string
}

export type ThresholdFlag = {
  metric: MetricKey
  metricLabel: string
  /** The level, e.g. 3 for the 300% screen. */
  threshold: number
  thresholdLabel: string
  supervisory: boolean
  value: number
  /** Past the level, or within a tenth of it on the adverse side. */
  status: "past" | "approaching"
  format: (value: number) => string
}

export type WorkbenchAnalysis = {
  subject: WorkbenchInput
  /** CRE over Tier 1 + Tier 2, as a multiple. Matches the drawer and the brief. */
  creToCapital: number | null
  constructionToCapital: number | null
  creShareOfLoans: number | null
  cohort: PeerCohort<WorkbenchInput>
  /** True when the cohort is large enough for percentiles to mean anything. */
  cohortIsRankable: boolean
  comparisons: PeerComparison[]
  flags: ThresholdFlag[]
  downside: DownsideScenario | null
}

/** How close to a level counts as approaching it. */
const APPROACHING = 0.9

/**
 * Zero means "not reported" for every capital field.
 *
 * CBLR filers return zero rather than null for RWAJ and RBCRWAJ, and a zero
 * reaching a denominator yields an infinite ratio rather than an error.
 * Normalising at the boundary leaves the rest of the pipeline one absent-value
 * case to handle instead of two.
 */
function reported(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value !== 0 ? value : null
}

/** Tier 2 of zero is a fact, not a gap, so it keeps its zero. */
function reportedAllowingZero(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

/** The subset of `BankFinancialData` the workbench reads. */
type TransformedRow = {
  id: string
  name: string
  city?: string
  state?: string
  reportDate?: string
  totalAssets: number
  totalLoans: number
  creLoans: number
  constructionLoans: number
  multifamilyLoans: number
  tier1Dollars?: number | null
  tier2Dollars?: number | null
  riskWeightedAssets?: number | null
  totalRbcRatio?: number
  leverageRatio?: number
  noncurrent_to_loans_ratio?: number
  loanLossReserve?: number
}

/**
 * Reduce transformed FDIC rows to one row per institution at `quarter`.
 *
 * Lives here rather than in the server action so the verification script can
 * run the shipped mapping over live data. Every bug this tool has shipped so
 * far passed its unit tests and failed on real figures.
 */
export function toWorkbenchRows(rows: TransformedRow[], quarter: string): WorkbenchInput[] {
  const seen = new Set<string>()
  const out: WorkbenchInput[] = []
  for (const row of rows) {
    if (String(row.reportDate ?? "").replace(/-/g, "") !== quarter) continue
    const cert = String(row.id ?? "")
    if (!cert || seen.has(cert)) continue
    seen.add(cert)
    out.push({
      cert,
      name: row.name,
      city: row.city,
      state: row.state,
      totalAssets: row.totalAssets,
      totalLoans: row.totalLoans,
      creLoans: row.creLoans,
      constructionLoans: row.constructionLoans,
      multifamilyLoans: row.multifamilyLoans,
      tier1Dollars: reported(row.tier1Dollars),
      tier2Dollars: reportedAllowingZero(row.tier2Dollars),
      riskWeightedAssets: reported(row.riskWeightedAssets),
      totalRbcRatio: reported(row.totalRbcRatio),
      leverageRatio: reported(row.leverageRatio),
      noncurrentRatio: reported(row.noncurrent_to_loans_ratio),
      reserveCoverage: reported(row.loanLossReserve),
    })
  }
  return out.sort((a, b) => b.totalAssets - a.totalAssets)
}

const asMultiple = (v: number) => `${(v * 100).toFixed(0)}%`
const asPercent = (v: number) => `${(v * 100).toFixed(2)}%`

/**
 * Capital ratios for one row, via the same helper the drawer and the brief use.
 *
 * Going through `computeCapitalRatios` rather than dividing here is the whole
 * point: an institution must not read at one CRE-to-capital in the workbench
 * and another in the profile drawer it links to.
 */
function ratiosFor(row: WorkbenchInput) {
  return computeCapitalRatios({
    totalAssets: row.totalAssets,
    creLoans: row.creLoans,
    constructionLoans: row.constructionLoans,
    multifamilyLoans: row.multifamilyLoans,
    leverageRatio: row.leverageRatio ?? undefined,
    totalRbcRatio: row.totalRbcRatio ?? undefined,
    totalEquityDollars: null,
    tier1Dollars: row.tier1Dollars,
    tier2Dollars: row.tier2Dollars,
    riskWeightedAssets: row.riskWeightedAssets,
  })
}

function creShare(row: WorkbenchInput): number | null {
  return row.totalLoans > 0 ? row.creLoans / row.totalLoans : null
}

function valueOf(row: WorkbenchInput, key: ComparableKey): number | null {
  switch (key) {
    case "creToCapital":
      return ratiosFor(row).creToTier1Tier2
    case "constructionToCapital":
      return ratiosFor(row).constructionToTier1Tier2
    case "creShareOfLoans":
      return creShare(row)
    case "noncurrentRatio":
      return row.noncurrentRatio
    case "reserveCoverage":
      return row.reserveCoverage
  }
}

const COMPARABLES: {
  key: ComparableKey
  label: string
  adverse: "rising" | "falling"
  format: (v: number) => string
}[] = [
  { key: "creToCapital", label: "CRE to capital", adverse: "rising", format: asMultiple },
  {
    key: "constructionToCapital",
    label: "Construction to capital",
    adverse: "rising",
    format: asMultiple,
  },
  { key: "creShareOfLoans", label: "CRE share of loans", adverse: "rising", format: asPercent },
  { key: "noncurrentRatio", label: "Noncurrent loans", adverse: "rising", format: asPercent },
  { key: "reserveCoverage", label: "Reserve coverage", adverse: "falling", format: asPercent },
]

/**
 * Which supervisory and conventional levels this institution currently sits at.
 *
 * Reads its levels from `METRIC_SPECS`, the same table the Executive Brief
 * crosses institutions against. A workbench that flagged 300% while the brief
 * flagged something else would make the two lenses disagree about the same
 * bank on the same screen.
 *
 * The brief reports *crossings* — a level passed this quarter. This reports
 * *state* — a level the institution is past now, whenever it got there. An
 * institution over 300% for two years generates no crossing and must still be
 * flagged to someone underwriting it today.
 */
export function thresholdFlags(row: WorkbenchInput): ThresholdFlag[] {
  const ratios = ratiosFor(row)
  const current: Partial<Record<MetricKey, number | null>> = {
    creToCapital: ratios.creToTier1Tier2,
    constructionToCapital: ratios.constructionToTier1Tier2,
    noncurrentRatio: row.noncurrentRatio,
    reserveCoverage: row.reserveCoverage,
    // Deliberately absent: `capitalRatio`. The change engine reads CET1, which
    // CBLR filers do not report, so a flag built on it would be silently blank
    // for a third of institutions. The downside scenario covers capital on each
    // regime's own terms instead.
  }

  const flags: ThresholdFlag[] = []
  for (const [key, value] of Object.entries(current) as [MetricKey, number | null][]) {
    if (value == null || !Number.isFinite(value)) continue
    const spec = METRIC_SPECS[key]
    for (const threshold of spec.thresholds) {
      const past =
        spec.adverse === "rising" ? value >= threshold.value : value <= threshold.value
      const approaching =
        spec.adverse === "rising"
          ? value >= threshold.value * APPROACHING
          : value <= threshold.value / APPROACHING
      if (!past && !approaching) continue
      flags.push({
        metric: key,
        metricLabel: spec.label,
        threshold: threshold.value,
        thresholdLabel: threshold.label,
        supervisory: threshold.supervisory,
        value,
        status: past ? "past" : "approaching",
        format: spec.format,
      })
    }
  }

  // Supervisory before conventional, breached before merely close.
  return flags.sort((a, b) => {
    if (a.status !== b.status) return a.status === "past" ? -1 : 1
    if (a.supervisory !== b.supervisory) return a.supervisory ? -1 : 1
    return 0
  })
}

export function analyseInstitution(
  subject: WorkbenchInput,
  universe: WorkbenchInput[]
): WorkbenchAnalysis {
  const cohort = selectPeers(subject, universe)
  const ratios = ratiosFor(subject)

  const comparisons: PeerComparison[] = COMPARABLES.map((c) => {
    const value = valueOf(subject, c.key)
    const peerValues = cohort.peers
      .map((p) => valueOf(p, c.key))
      .filter((v): v is number => v != null && Number.isFinite(v))
    return {
      key: c.key,
      label: c.label,
      value,
      peerMedian: medianOf(peerValues),
      percentile: value == null ? null : percentileIn(peerValues, value),
      adverse: c.adverse,
      format: c.format,
    }
  })

  return {
    subject,
    creToCapital: ratios.creToTier1Tier2,
    constructionToCapital: ratios.constructionToTier1Tier2,
    creShareOfLoans: creShare(subject),
    cohort,
    cohortIsRankable: comparisons.some((c) => c.percentile != null),
    comparisons,
    flags: thresholdFlags(subject),
    downside: computeDownside({
      creLoans: subject.creLoans,
      tier1Dollars: subject.tier1Dollars,
      tier2Dollars: subject.tier2Dollars,
      riskWeightedAssets: subject.riskWeightedAssets,
      totalRbcRatio: subject.totalRbcRatio,
      leverageRatio: subject.leverageRatio,
    }),
  }
}
