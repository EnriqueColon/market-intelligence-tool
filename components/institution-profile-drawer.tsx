"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Copy, X } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { fetchNoncurrentDebugSnapshot } from "@/app/actions/fetch-fdic-data"
import {
  getInstitutionHistory,
  getInstitutionTrend,
  type InstitutionHistory,
  type InstitutionTrendResult,
} from "@/app/actions/market-analytics-watch"
import { InstitutionTrendPanels, InstitutionTrendSkeleton } from "@/components/institution-trend-panels"
import type { NoncurrentDebugSnapshot } from "@/lib/noncurrent-debug"
import { formatEventDate } from "@/lib/fdic-structure-events"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"
import {
  formatMoney,
  formatCapitalMultiple,
  formatPercent as formatPercentMetric,
  formatDeltaPercentPoints,
  formatMultiple as formatMultipleMetric,
} from "@/lib/format/metrics"
import { getCreCapitalColor } from "@/lib/score-colors"
import { computeCreMix } from "@/lib/fdic-cre"
import {
  MIN_COHORT,
  percentileIn,
  selectPeers,
  type PeerCandidate,
  type PeerCohort,
} from "@/lib/scoring/peer-cohort"
import { DefTerm } from "@/components/def-term"
import { ChartTooltipRow, ChartTooltipShell } from "@/components/charts/chart-tooltip"
import { CHART_SERIES, categoryTick, gridProps, numericTick } from "@/lib/chart-theme"

function capitalCategoryTone(category?: "well" | "adequate" | "under" | "significant" | "critical"): string {
  switch (category) {
    case "well":
      return "text-emerald-700"
    case "adequate":
      return "text-amber-700"
    case "under":
      return "text-orange-700"
    case "significant":
    case "critical":
      return "text-red-700"
    default:
      return "text-slate-700"
  }
}

function formatDeltaPp(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const sign = value >= 0 ? "+" : ""
  return `${sign}${value.toFixed(decimals)} pp`
}

function formatAssets(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

function formatQuarter(dateString?: string) {
  if (!dateString) return "—"
  if (/^\d{8}$/.test(dateString)) {
    const year = dateString.slice(0, 4)
    const month = Number(dateString.slice(4, 6))
    const quarter = Math.ceil(month / 3)
    return `Q${quarter} ${year}`
  }
  const parsed = new Date(dateString)
  if (Number.isNaN(parsed.getTime())) return dateString
  const quarter = Math.floor(parsed.getMonth() / 3) + 1
  return `Q${quarter} ${parsed.getFullYear()}`
}

function formatDecimalPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—"
  return (value * 100).toFixed(1) + "%"
}

function formatRatio(value: number | null | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—"
  return formatMultipleMetric(value)
}

export type InstitutionProfileRow = {
  id: string
  name: string
  city?: string
  state?: string
  totalAssets: number
  reportDate?: string
  creConcentration?: number
  nplRatio?: number
  noncurrent_to_loans_ratio?: number
  noncurrent_to_assets_ratio?: number
  loanLossReserve?: number
  loansToDeposits?: number
  cet1Ratio?: number | null
  leverageRatio?: number | null
  capitalRatios?: {
    creToTier1Tier2: number | null
    creToEquity: number | null
    constructionToTier1Tier2: number | null
    multifamilyToTier1Tier2: number | null
  }
  /** Prompt Corrective Action band for the latest quarter; see `lib/scoring/capital-category.ts`. */
  capitalCategory?: {
    category: "well" | "adequate" | "under" | "significant" | "critical"
    label: string
    binding: string
    basis: "risk-based" | "leverage-only"
  }
  totalUnusedCommitments?: number
  creUnusedCommitments?: number
  opportunityScore: number
  earningsScore: number
  vulnerabilityScore: number
  roaLatest?: number | null
  roaDelta4Q?: number | null
  netIncomeTTM?: number | null
  netIncomeYoYPct?: number | null
  nimLatest?: number | null
  nimDelta4Q?: number | null
  earningsBufferPct?: number | null
  /** Screening list fields */
  totalLoans?: number
  creLoans?: number
  nonaccrualLoans?: number
  pastDue3090?: number
  pastDue90Plus?: number
  constructionLoans?: number
  multifamilyLoans?: number
  nonResidentialLoans?: number
  ownerOccupiedLoans?: number
  nonOwnerOccupiedLoans?: number
  /** Only the two series the drawer charts; see `lib/analytics/screening.ts`. */
  trend?: Array<{
    reportDate: string
    creConcentration?: number
    nplRatio?: number
  }>
}

/**
 * Peer positioning is measured against a **matched cohort**, not the whole scope.
 *
 * Until 2026-09-30 every percentile in this drawer ranked the institution against every row in the
 * selected scope. Such a number reads as meaningful while saying very little: a $180m
 * single-branch bank ranked against a set that includes Truist is mostly being told about its own
 * size. `lib/scoring/peer-cohort` narrows to the same asset band, state and lending mix, relaxing
 * one axis at a time when the cohort is too thin.
 *
 * Two consequences this component carries rather than smooths over:
 *
 *  - **The cohort is stated wherever a percentile appears.** A percentile without its cohort is not
 *    a fact, and the basis now differs per institution, so it cannot be left implicit in a caption.
 *  - **A thin cohort renders as "—".** `percentileIn` returns null below `MIN_COHORT` peers instead
 *    of a number resting on four institutions. Fewer figures, each of which means something.
 */
type PeerRow = PeerCandidate & { row: InstitutionProfileRow }

function toPeerRow(row: InstitutionProfileRow): PeerRow {
  return {
    cert: row.id,
    name: row.name,
    state: row.state,
    totalAssets: row.totalAssets,
    // Absent loan figures pass through as NaN rather than being coerced to 0, so `mixIsKnown`
    // reads them as unknown and drops the lending-mix criterion. A zero would instead have
    // claimed a match on "little CRE" for an institution whose mix was never reported.
    creLoans: row.creLoans ?? Number.NaN,
    totalLoans: row.totalLoans ?? Number.NaN,
    row,
  }
}

function resolvePeers(
  subject: InstitutionProfileRow,
  universe: InstitutionProfileRow[]
): { peers: InstitutionProfileRow[]; cohort: PeerCohort<PeerRow> } {
  const cohort = selectPeers(toPeerRow(subject), universe.map(toPeerRow))
  return { peers: cohort.peers.map((p) => p.row), cohort }
}

/**
 * Where `value` sits among `peers` on one metric, 0–100, or null when too few peers report it.
 *
 * Peers missing the metric are filtered before the cohort-size test on purpose: eight peers of
 * whom three report the figure is not an eight-peer ranking.
 */
function percentileAmong(
  peers: InstitutionProfileRow[],
  value: number | null | undefined,
  metric: (r: InstitutionProfileRow) => number | null | undefined
): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const values = peers.map(metric).filter((v): v is number => v != null && Number.isFinite(v))
  const ranked = percentileIn(values, value)
  return ranked == null ? null : Math.round(ranked * 100)
}

/** Declared once so the four places that render percentiles cannot drift apart. */
const PEER_METRICS: {
  label: string
  get: (r: InstitutionProfileRow) => number | null | undefined
}[] = [
  { label: "CRE / Assets", get: (r) => r.creConcentration },
  { label: "NPL Ratio", get: (r) => r.nplRatio },
  { label: "Net Income", get: (r) => r.netIncomeTTM },
  { label: "NIM", get: (r) => r.nimLatest },
]

/**
 * English ordinal suffix. The previous code appended a bare "th", which rendered "2th percentile"
 * and "23th percentile" — caught by reading the drawer rather than by any test. These figures get
 * pasted into credit memos, so they are worth getting right.
 */
function ordinal(n: number): string {
  const mod100 = Math.abs(n) % 100
  // 11th, 12th, 13th are the exceptions that a bare last-digit rule gets wrong.
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (Math.abs(n) % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function formatPercentile(value: number | null): string {
  return value == null ? "—" : `${ordinal(value)} percentile`
}

/**
 * Why a percentile is missing, so "—" is never just a shrug.
 *
 * The suggestion is the actionable half. This fires most often for the *largest* institutions in a
 * single-state scope, where there are simply not eight in-state banks of comparable size — and
 * switching the scope selector to United States does give them a cohort. Verified with
 * `npm run verify:peer-cohort`: in Georgia every institution over $1bn falls into this case.
 */
function tooFewPeersNote(peerCount: number): string {
  const shortfall =
    peerCount === 0
      ? "No institutions of comparable size in this scope"
      : `Only ${peerCount} comparable institution${peerCount === 1 ? "" : "s"} in this scope — fewer than the ${MIN_COHORT} a percentile should rest on`
  return `${shortfall}. Switch the scope to United States for a national cohort.`
}

type InstitutionProfileDrawerProps = {
  row: InstitutionProfileRow | null
  cohort: InstitutionProfileRow[]
  asOfQuarter: string
  onClose: () => void
  /** Institutions to compare side-by-side */
  compareRows?: InstitutionProfileRow[]
  onAddToCompare?: (row: InstitutionProfileRow) => void
  onRemoveFromCompare?: (id: string, reportDate?: string) => void
  onClearCompare?: () => void
}

const NONCURRENT_DEBUG_ENABLED =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_NONCURRENT_DEBUG === "true"

/** Parse "Q4 2024" to "2024-12-31" for FDIC API. */
function parseAsOfQuarterToDate(asOfQuarter: string): string {
  const m = asOfQuarter.match(/Q([1-4])\s+(\d{4})/)
  if (!m) return ""
  const q = Number(m[1])
  const year = m[2]
  const month = q * 3
  const day = [31, 30, 30, 31][q - 1]
  return `${year}-${String(month).padStart(2, "0")}-${day}`
}

export function InstitutionProfileDrawer({
  row,
  cohort,
  asOfQuarter,
  onClose,
  compareRows = [],
  onAddToCompare,
  onRemoveFromCompare,
  onClearCompare,
}: InstitutionProfileDrawerProps) {
  const lastLoggedRef = useRef<string | null>(null)
  const [fdicSnapshot, setFdicSnapshot] = useState<NoncurrentDebugSnapshot | null>(null)
  const [history, setHistory] = useState<InstitutionHistory | null>(null)
  const [trend, setTrend] = useState<InstitutionTrendResult | null>(null)

  const primaryRow = row ?? compareRows[0]

  // Eight-quarter trend: one cached FDIC call per institution, same lifecycle
  // as the corporate history below. `null` while loading.
  useEffect(() => {
    setTrend(null)
    if (!primaryRow) return
    let active = true
    getInstitutionTrend(primaryRow.id)
      .then((result) => {
        if (!active) return
        if (!result.ok || result.trend.cert === primaryRow.id) setTrend(result)
      })
      .catch((error: unknown) => {
        if (active) setTrend({ ok: false, error: error instanceof Error ? error.message : "Unable to load the trend." })
      })
    return () => {
      active = false
    }
  }, [primaryRow?.id])

  // Corporate history is one small cached FDIC call per institution, fetched
  // when the drawer opens on a single bank. Cleared on change so a previous
  // bank's acquisitions can never show under the next one's name.
  useEffect(() => {
    setHistory(null)
    if (!primaryRow) return
    let active = true
    getInstitutionHistory(primaryRow.id)
      .then((result) => {
        if (active && result.cert === primaryRow.id) setHistory(result)
      })
      .catch(() => {
        if (active) setHistory({ cert: primaryRow.id, acquisitions: [] })
      })
    return () => {
      active = false
    }
  }, [primaryRow?.id])
  useEffect(() => {
    if (!primaryRow) {
      setFdicSnapshot(null)
      return
    }
    const reportDate = primaryRow.reportDate ?? (asOfQuarter ? parseAsOfQuarterToDate(asOfQuarter) : "")
    if (!reportDate) {
      setFdicSnapshot(null)
      return
    }
    fetchNoncurrentDebugSnapshot(primaryRow.id, reportDate).then((result) => {
      const { snapshot, error } = result ?? {}
      if (error || !snapshot) {
        setFdicSnapshot(null)
        return
      }
      setFdicSnapshot(snapshot)
      if (process.env.NODE_ENV === "development") {
        const rowNtl = primaryRow.noncurrent_to_loans_ratio ?? 0
        const snapNtl = snapshot.internal.noncurrent_to_loans_ratio.value
        if (Math.abs(rowNtl - snapNtl) > 0.02) {
          console.warn(
            "[Noncurrent] Row/snapshot mismatch:",
            { cert: primaryRow.id, quarter: reportDate, row_nontl: rowNtl, snapshot_nontl: snapNtl, raw_NCLNLSR: snapshot.raw.NCLNLSR }
          )
        }
      }
    }).catch(() => {
      setFdicSnapshot(null)
    })
  }, [primaryRow, asOfQuarter])

  useEffect(() => {
    if (!NONCURRENT_DEBUG_ENABLED || !primaryRow) return
    const key = `${primaryRow.id}:${primaryRow.reportDate ?? asOfQuarter}`
    if (lastLoggedRef.current === key) return
    lastLoggedRef.current = key

    const reportDate = primaryRow.reportDate ?? (asOfQuarter ? parseAsOfQuarterToDate(asOfQuarter) : "")
    if (!reportDate) return

    const rowDisplay = {
      npl_ratio_pct: primaryRow.nplRatio != null ? (primaryRow.nplRatio * 100).toFixed(1) + "%" : "—",
      noncurrent_to_loans_pct:
        primaryRow.noncurrent_to_loans_ratio != null ? (primaryRow.noncurrent_to_loans_ratio * 100).toFixed(1) + "%" : "—",
      noncurrent_to_assets_pct:
        primaryRow.noncurrent_to_assets_ratio != null ? (primaryRow.noncurrent_to_assets_ratio * 100).toFixed(1) + "%" : "—",
      reserve_coverage_pct: primaryRow.loanLossReserve != null ? (primaryRow.loanLossReserve * 100).toFixed(1) + "%" : "—",
    }
    const internalFromRow = {
      npl_ratio: primaryRow.nplRatio,
      noncurrent_to_loans_ratio: primaryRow.noncurrent_to_loans_ratio,
      noncurrent_to_assets_ratio: primaryRow.noncurrent_to_assets_ratio,
      reserve_coverage: primaryRow.loanLossReserve,
    }

    fetchNoncurrentDebugSnapshot(primaryRow.id, reportDate).then(({ snapshot, error }) => {
      if (error) {
        console.warn("[Noncurrent Debug] Fetch error:", error)
        return
      }
      if (snapshot) {
        console.log(
          "[Noncurrent Debug Snapshot]",
          JSON.stringify(
            {
              bank: snapshot.bank,
              quarter: snapshot.quarter,
              fdic_endpoint: snapshot.fdic_endpoint,
              field_sources: snapshot.field_sources,
              raw: snapshot.raw,
              internal: snapshot.internal,
              internal_from_row: internalFromRow,
              display: snapshot.display,
              display_from_row: rowDisplay,
              unit_detection: snapshot.unit_detection,
            },
            null,
            2
          )
        )
      }
    })
  }, [primaryRow, asOfQuarter])

  const displayRows = compareRows.length >= 1 ? compareRows : (row ? [row] : [])
  const rowForCopy = row ?? displayRows[0]

  // One cohort per subject, computed once. Everything that renders a percentile for this
  // institution reads from here, so the figure and the stated basis cannot disagree.
  const peerGroup = useMemo(
    () => (rowForCopy ? resolvePeers(rowForCopy, cohort) : null),
    [rowForCopy, cohort]
  )
  const peers = peerGroup?.peers ?? []
  const buildSnapshot = useCallback((): string => {
    if (!rowForCopy) return ""
    const reportDateNorm = rowForCopy.reportDate ?? (asOfQuarter ? parseAsOfQuarterToDate(asOfQuarter) : "")
    const quarterMatch = fdicSnapshot && reportDateNorm && fdicSnapshot.quarter && reportDateNorm.slice(0, 10) === fdicSnapshot.quarter.slice(0, 10)
    const nplVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.npl_ratio.value : (rowForCopy.nplRatio ?? 0)
    const ntlVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.noncurrent_to_loans_ratio.value : (rowForCopy.noncurrent_to_loans_ratio ?? 0)
    const ntaVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.noncurrent_to_assets_ratio.value : (rowForCopy.noncurrent_to_assets_ratio ?? 0)
    const reserveVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.reserve_coverage.value : (rowForCopy.loanLossReserve ?? 0)

    const creAssets = rowForCopy.creConcentration != null ? rowForCopy.creConcentration.toFixed(1) : "—"
    const creCapital = rowForCopy.capitalRatios?.creToTier1Tier2 != null
      ? formatCapitalMultiple(rowForCopy.capitalRatios.creToTier1Tier2)
      : "—"
    const constructionCapital = rowForCopy.capitalRatios?.constructionToTier1Tier2 != null
      ? formatCapitalMultiple(rowForCopy.capitalRatios.constructionToTier1Tier2)
      : "—"
    const multifamilyCapital = rowForCopy.capitalRatios?.multifamilyToTier1Tier2 != null
      ? formatCapitalMultiple(rowForCopy.capitalRatios.multifamilyToTier1Tier2)
      : "—"
    const npl = Number.isFinite(nplVal) ? (nplVal * 100).toFixed(1) : "—"
    const noncurrentLoans = Number.isFinite(ntlVal) ? (ntlVal * 100).toFixed(1) : "—"
    const noncurrentAssets = Number.isFinite(ntaVal) ? (ntaVal * 100).toFixed(1) : "—"
    const reserveCoverage = Number.isFinite(reserveVal) ? (reserveVal * 100).toFixed(1) : "—"
    const capitalUsed = rowForCopy.cet1Ratio != null && rowForCopy.cet1Ratio !== 0 ? rowForCopy.cet1Ratio : rowForCopy.leverageRatio
    const capitalUsedVal = capitalUsed != null ? capitalUsed.toFixed(1) : "—"
    const capitalLabel = rowForCopy.cet1Ratio != null && rowForCopy.cet1Ratio !== 0 ? "CET1" : "Leverage"
    const roa = rowForCopy.roaLatest != null ? rowForCopy.roaLatest.toFixed(2) : "—"
    const roaDelta = rowForCopy.roaDelta4Q != null ? formatDeltaPp(rowForCopy.roaDelta4Q) : "—"
    const netIncomeTTM = rowForCopy.netIncomeTTM != null ? formatMoney(rowForCopy.netIncomeTTM) : "—"
    const netIncomeYoY = rowForCopy.netIncomeYoYPct != null ? `${rowForCopy.netIncomeYoYPct >= 0 ? "+" : ""}${rowForCopy.netIncomeYoYPct.toFixed(1)}%` : "—"
    const nim = rowForCopy.nimLatest != null ? rowForCopy.nimLatest.toFixed(2) : "—"
    const nimDelta = rowForCopy.nimDelta4Q != null ? formatDeltaPp(rowForCopy.nimDelta4Q) : "—"
    const earningsBuffer = rowForCopy.earningsBufferPct != null ? rowForCopy.earningsBufferPct.toFixed(1) : "—"

    const creAssetsPct = percentileAmong(peers, rowForCopy.creConcentration, (r) => r.creConcentration)
    const nplPct = percentileAmong(peers, rowForCopy.nplRatio, (r) => r.nplRatio)
    const netIncomePct = percentileAmong(peers, rowForCopy.netIncomeTTM, (r) => r.netIncomeTTM)
    const nimPct = percentileAmong(peers, rowForCopy.nimLatest, (r) => r.nimLatest)

    const lines = [
      `${rowForCopy.name} — Institution Snapshot (${asOfQuarter})`,
      `Location: ${rowForCopy.city ?? "—"}, ${rowForCopy.state ?? "—"}`,
      `Total Assets: ${formatAssets(rowForCopy.totalAssets)}`,
      "",
      "Scores:",
      "",
      `Structural Opportunity Score: ${rowForCopy.opportunityScore.toFixed(1)}`,
      "",
      `Earnings Resilience Score: ${rowForCopy.earningsScore.toFixed(1)}`,
      "",
      `Composite Vulnerability Score: ${rowForCopy.vulnerabilityScore.toFixed(1)}`,
      "",
      "Structural Exposure:",
      "",
      `CRE / Assets: ${creAssets}%`,
      `CRE / Capital: ${creCapital}`,
      `Construction / Capital: ${constructionCapital}`,
      `Multifamily / Capital: ${multifamilyCapital}`,
      `NPL Ratio: ${npl}%`,
      `Noncurrent / Loans: ${noncurrentLoans}%`,
      `Noncurrent / Assets: ${noncurrentAssets}%`,
      `Reserve Coverage: ${reserveCoverage}%`,
      `Total UC: ${rowForCopy.totalUnusedCommitments != null ? formatAssets(rowForCopy.totalUnusedCommitments) : "—"}`,
      `CRE UC: ${rowForCopy.creUnusedCommitments != null ? formatAssets(rowForCopy.creUnusedCommitments) : "—"}`,
      `Capital Ratio Used: ${capitalUsedVal}% (${capitalLabel})`,
      "",
      "Earnings:",
      "",
      `ROA: ${roa}% (Δ4Q: ${roaDelta})`,
      `Net Income (TTM): ${netIncomeTTM} (YoY: ${netIncomeYoY})`,
      `NIM: ${nim}% (Δ4Q: ${nimDelta})`,
      `Earnings Buffer: ${earningsBuffer}%`,
      "",
      "Peer Positioning:",
      "",
      // Copied text ends up in credit memos, so the cohort travels with the numbers. A percentile
      // pasted without it is the misreading this section was changed to prevent.
      `Cohort: ${peerGroup?.cohort.description ?? "—"} (${peers.length} institution${peers.length === 1 ? "" : "s"})`,
      ...(peerGroup?.cohort.relaxationNote ? [peerGroup.cohort.relaxationNote] : []),
      ...(peers.length < MIN_COHORT ? [tooFewPeersNote(peers.length)] : []),
      "",
      `CRE / Assets: ${formatPercentile(creAssetsPct)}`,
      `NPL Ratio: ${formatPercentile(nplPct)}`,
      `Net Income: ${formatPercentile(netIncomePct)}`,
      `NIM: ${formatPercentile(nimPct)}`,
    ]

    return lines.join("\n")
  }, [rowForCopy, peerGroup, peers, asOfQuarter, fdicSnapshot])

  const handleCopy = useCallback(async () => {
    const text = buildSnapshot()
    if (!text) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      toast({ title: "Snapshot copied.", variant: "default" })
    } catch {
      toast({ title: "Copy failed", variant: "destructive" })
    }
  }, [buildSnapshot])

  const isCompareMode = displayRows.length >= 1

  if (!row && compareRows.length === 0) return null

  const availableToAdd = cohort.filter(
    (c) => !displayRows.some((r) => r.id === c.id && (r.reportDate ?? "") === (c.reportDate ?? ""))
  )
  const sortedAvailable = [...availableToAdd].sort((a, b) => (a.name || "").localeCompare(b.name || ""))

  return (
    <Dialog open={!!row || compareRows.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] sm:max-w-6xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pr-8">
          <DialogTitle className="text-lg font-semibold text-slate-800">
            Compare institutions
          </DialogTitle>
          <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0 border-[#006D95]/30 text-[#006D95] hover:bg-[#006D95]/5">
            <Copy className="h-4 w-4 mr-2" />
            Copy Snapshot
          </Button>
        </DialogHeader>
        <div className="mt-6 space-y-6 pr-4">
          {isCompareMode ? (
            <>
              {onAddToCompare && sortedAvailable.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Add institution:</span>
                  <Select
                    value="__add__"
                    onValueChange={(value) => {
                      if (value === "__add__") return
                      const r = cohort.find((c) => `${c.id}-${c.reportDate ?? ""}` === value)
                      if (r) {
                        onAddToCompare(r)
                        toast({ title: "Added to compare", variant: "default" })
                      }
                    }}
                  >
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Add institution…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__add__">Add institution…</SelectItem>
                      {sortedAvailable.map((item) => (
                        <SelectItem key={`${item.id}-${item.reportDate ?? "na"}`} value={`${item.id}-${item.reportDate ?? ""}`}>
                          {item.name}
                          {item.state ? ` (${item.state})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <ComparisonTable
                rows={displayRows}
                cohort={cohort}
                asOfQuarter={asOfQuarter}
                formatAssets={formatAssets}
                formatQuarter={formatQuarter}
                formatDecimalPercent={formatDecimalPercent}
                formatMoney={formatMoney}
                formatPercentMetric={formatPercentMetric}
                formatDeltaPercentPoints={formatDeltaPercentPoints}
                formatRatio={formatRatio}
                getCreCapitalColor={getCreCapitalColor}
                onRemove={onRemoveFromCompare}
              />
              <PeerPositioningComparisonChart rows={displayRows} cohort={cohort} />
              {rowForCopy && displayRows.length === 1 && (
                <>
                  <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 px-4 py-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95] mb-2">Eight-Quarter Trend</h4>
                    {trend == null ? (
                      <InstitutionTrendSkeleton />
                    ) : trend.ok ? (
                      <InstitutionTrendPanels trend={trend.trend} />
                    ) : (
                      <p className="text-xs text-slate-500">Trend unavailable: {trend.error}</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 px-4 py-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">{rowForCopy.city ?? "—"}, {rowForCopy.state ?? "—"}</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      Total Assets: {formatAssets(rowForCopy.totalAssets)}
                    </p>
                  </div>
                  <ScreeningListSection row={rowForCopy} formatAssets={formatAssets} formatQuarter={formatQuarter} formatDecimalPercent={formatDecimalPercent} formatMoney={formatMoney} formatPercentMetric={formatPercentMetric} formatDeltaPercentPoints={formatDeltaPercentPoints} formatRatio={formatRatio} getCreCapitalColor={getCreCapitalColor} />
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95] mb-2">Structural Exposure</h4>
                    <div className="space-y-1.5 text-sm text-slate-700">
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="CRE / Assets">CRE / Assets</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.creConcentration != null ? rowForCopy.creConcentration.toFixed(1) + "%" : "—"}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="CRE / Capital">CRE / Capital</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.capitalRatios?.creToTier1Tier2 != null ? formatCapitalMultiple(rowForCopy.capitalRatios.creToTier1Tier2) : "—"}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Construction / Capital">Construction / Capital</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.capitalRatios?.constructionToTier1Tier2 != null ? formatCapitalMultiple(rowForCopy.capitalRatios.constructionToTier1Tier2) : "—"}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Multifamily / Capital">Multifamily / Capital</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.capitalRatios?.multifamilyToTier1Tier2 != null ? formatCapitalMultiple(rowForCopy.capitalRatios.multifamilyToTier1Tier2) : "—"}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="NPL Ratio">NPL Ratio</DefTerm></span><span className="font-medium tabular-nums">{(() => {
                        const reportDateNorm = rowForCopy.reportDate ?? (asOfQuarter ? parseAsOfQuarterToDate(asOfQuarter) : "")
                        const quarterMatch = fdicSnapshot && reportDateNorm && fdicSnapshot.quarter && reportDateNorm.slice(0, 10) === fdicSnapshot.quarter.slice(0, 10)
                        const nplVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.npl_ratio.value : (rowForCopy.nplRatio ?? 0)
                        return Number.isFinite(nplVal) ? (nplVal * 100).toFixed(1) + "%" : "—"
                      })()}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Noncurrent / Loans">Noncurrent / Loans</DefTerm></span><span className="font-medium tabular-nums">{(() => {
                        const reportDateNorm = rowForCopy.reportDate ?? (asOfQuarter ? parseAsOfQuarterToDate(asOfQuarter) : "")
                        const quarterMatch = fdicSnapshot && reportDateNorm && fdicSnapshot.quarter && reportDateNorm.slice(0, 10) === fdicSnapshot.quarter.slice(0, 10)
                        const ntlVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.noncurrent_to_loans_ratio.value : (rowForCopy.noncurrent_to_loans_ratio ?? 0)
                        return Number.isFinite(ntlVal) ? (ntlVal * 100).toFixed(1) + "%" : "—"
                      })()}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Noncurrent / Assets">Noncurrent / Assets</DefTerm></span><span className="font-medium tabular-nums">{(() => {
                        const reportDateNorm = rowForCopy.reportDate ?? (asOfQuarter ? parseAsOfQuarterToDate(asOfQuarter) : "")
                        const quarterMatch = fdicSnapshot && reportDateNorm && fdicSnapshot.quarter && reportDateNorm.slice(0, 10) === fdicSnapshot.quarter.slice(0, 10)
                        const ntaVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.noncurrent_to_assets_ratio.value : (rowForCopy.noncurrent_to_assets_ratio ?? 0)
                        return Number.isFinite(ntaVal) ? (ntaVal * 100).toFixed(1) + "%" : "—"
                      })()}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Reserve Coverage">Reserve Coverage</DefTerm></span><span className="font-medium tabular-nums">{(() => {
                        const reportDateNorm = rowForCopy.reportDate ?? (asOfQuarter ? parseAsOfQuarterToDate(asOfQuarter) : "")
                        const quarterMatch = fdicSnapshot && reportDateNorm && fdicSnapshot.quarter && reportDateNorm.slice(0, 10) === fdicSnapshot.quarter.slice(0, 10)
                        const reserveVal = quarterMatch && fdicSnapshot ? fdicSnapshot.internal.reserve_coverage.value : (rowForCopy.loanLossReserve ?? 0)
                        return Number.isFinite(reserveVal) ? (reserveVal * 100).toFixed(1) + "%" : "—"
                      })()}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Total UC">Total UC</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.totalUnusedCommitments != null ? formatAssets(rowForCopy.totalUnusedCommitments) : "—"}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="CRE UC">CRE UC</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.creUnusedCommitments != null ? formatAssets(rowForCopy.creUnusedCommitments) : "—"}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Capital">Capital</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.cet1Ratio != null && rowForCopy.cet1Ratio !== 0 ? rowForCopy.cet1Ratio.toFixed(1) + "% (CET1)" : rowForCopy.leverageRatio != null ? rowForCopy.leverageRatio.toFixed(1) + "% (Leverage)" : "—"}</span></p>
                      <p className="flex justify-between gap-4"><span className="text-slate-500"><DefTerm term="Capital Category">Capital Category</DefTerm></span><span className={`font-medium text-right ${capitalCategoryTone(rowForCopy.capitalCategory?.category)}`}>{rowForCopy.capitalCategory ? rowForCopy.capitalCategory.label : "—"}{rowForCopy.capitalCategory ? <span className="block text-[11px] font-normal text-slate-500">binding: {rowForCopy.capitalCategory.binding}{rowForCopy.capitalCategory.basis === "leverage-only" ? "; leverage only (CBLR filer)" : ""}</span> : null}</span></p>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95] mb-2">Corporate History</h4>
                    {history == null || history.cert !== rowForCopy.id ? (
                      <p className="text-xs text-slate-500">Loading FDIC structure records…</p>
                    ) : history.acquisitions.length === 0 ? (
                      <p className="text-xs text-slate-600">No acquisitions on record with the FDIC.</p>
                    ) : (
                      <ul className="space-y-1.5 text-sm text-slate-700">
                        {history.acquisitions.map((a, i) => (
                          <li key={`${a.absorbedCert ?? i}-${a.date}`} className="flex gap-3">
                            <span className="shrink-0 tabular-nums text-xs text-slate-500 pt-0.5 w-24">{formatEventDate(a.date)}</span>
                            <span className="text-xs leading-relaxed">{a.description}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95] mb-2">Earnings</h4>
                    <div className="space-y-1.5 text-sm text-slate-700">
                      <p className="flex justify-between gap-4"><span className="text-slate-500"><DefTerm term="ROA">ROA</DefTerm></span><span className="font-medium tabular-nums text-right">{rowForCopy.roaLatest != null ? rowForCopy.roaLatest.toFixed(2) + "%" : "—"}{rowForCopy.roaDelta4Q != null ? ` (Δ4Q: ${formatDeltaPp(rowForCopy.roaDelta4Q)})` : ""}</span></p>
                      <p className="flex justify-between gap-4"><span className="text-slate-500"><DefTerm term="Net Income (TTM)">Net Income (TTM)</DefTerm></span><span className="font-medium tabular-nums text-right">{rowForCopy.netIncomeTTM != null ? formatMoney(rowForCopy.netIncomeTTM) : "—"}{rowForCopy.netIncomeYoYPct != null ? ` (YoY: ${rowForCopy.netIncomeYoYPct >= 0 ? "+" : ""}${rowForCopy.netIncomeYoYPct.toFixed(1)}%)` : ""}</span></p>
                      <p className="flex justify-between gap-4"><span className="text-slate-500"><DefTerm term="NIM">NIM</DefTerm></span><span className="font-medium tabular-nums text-right">{rowForCopy.nimLatest != null ? rowForCopy.nimLatest.toFixed(2) + "%" : "—"}{rowForCopy.nimDelta4Q != null ? ` (Δ4Q: ${formatDeltaPp(rowForCopy.nimDelta4Q)})` : ""}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500"><DefTerm term="Earnings Buffer">Earnings Buffer</DefTerm></span><span className="font-medium tabular-nums">{rowForCopy.earningsBufferPct != null ? rowForCopy.earningsBufferPct.toFixed(1) + "%" : "—"}</span></p>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95] mb-2">Peer Positioning</h4>
                    <div className="space-y-1.5 text-sm text-slate-700">
                      {PEER_METRICS.map(({ label, get }) => (
                        <p key={label} className="flex justify-between">
                          <span className="text-slate-500"><DefTerm term={label}>{label}</DefTerm></span>
                          <span className="font-medium tabular-nums">
                            {formatPercentile(percentileAmong(peers, get(rowForCopy), get))}
                          </span>
                        </p>
                      ))}
                    </div>
                    {/*
                      The basis sits with the figures rather than in a tooltip. It changes per
                      institution — a bank in a thin asset band gets a different cohort from one in
                      a crowded band — so there is no single caption that could describe it.
                    */}
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Against {peers.length} comparable {peers.length === 1 ? "institution" : "institutions"}
                      {peerGroup ? `: ${peerGroup.cohort.description}` : ""}.
                      {peers.length < MIN_COHORT ? ` ${tooFewPeersNote(peers.length)}` : ""}
                      {peerGroup?.cohort.relaxationNote ? ` ${peerGroup.cohort.relaxationNote}` : ""}
                    </p>
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-600">Select an institution from the table or dropdown to compare.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PeerPositioningComparisonChart({
  rows,
  cohort,
}: {
  rows: InstitutionProfileRow[]
  cohort: InstitutionProfileRow[]
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const chartSeries = useMemo(() => {
    return rows.map((row, idx) => ({
      key: `inst_${idx}`,
      label: `${row.name}${row.state ? ` (${row.state})` : ""}`,
      color: CHART_SERIES[idx % CHART_SERIES.length],
      row,
    }))
  }, [rows])

  // Each institution is ranked against **its own** peers, so a $200m bank and a $20bn bank on the
  // same chart are each measured against banks like themselves. Ranking both against one cohort
  // would make the taller bar mean "larger" rather than "more exposed", which is the confusion
  // this whole change exists to remove. The consequence is that bars are not a shared scale of
  // institutions — hence the caption, and hence the per-series cohort in the tooltip.
  const peerGroups = useMemo(
    () => new Map(rows.map((row) => [row.id, resolvePeers(row, cohort)])),
    [rows, cohort]
  )

  const chartData = useMemo(() => {
    return PEER_METRICS.map(({ label, get }) => {
      const out: Record<string, string | number | null> = { metric: label }
      chartSeries.forEach((series) => {
        const group = peerGroups.get(series.row.id)
        out[series.key] = group
          ? percentileAmong(group.peers, get(series.row), get)
          : null
      })
      return out
    })
  }, [peerGroups, chartSeries])

  if (rows.length === 0) return null

  const renderChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height} debounce={0}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 24 }} barCategoryGap={18}>
        <CartesianGrid {...gridProps} />
        <XAxis type="number" domain={[0, 100]} tick={numericTick} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="metric" width={96} tick={{ ...categoryTick, fontSize: 11 }} tickLine={false} axisLine={false} />
        <Legend
          verticalAlign="top"
          align="left"
          wrapperStyle={{ fontSize: "12px", color: "#334155", paddingBottom: "8px" }}
          formatter={(value) => <span className="text-slate-700">{value}</span>}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,109,149,0.06)" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <ChartTooltipShell title={String(label)}>
                {payload.map((item) => (
                  <ChartTooltipRow
                    key={item.dataKey as string}
                    label={String(item.name)}
                    value={item.value == null ? "—" : `${item.value}th pct`}
                  />
                ))}
              </ChartTooltipShell>
            )
          }}
        />
        {chartSeries.map((series) => (
          <Bar
            key={series.key}
            name={series.label}
            dataKey={series.key}
            fill={series.color}
            radius={[2, 2, 2, 2]}
            maxBarSize={14}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )

  return (
    <>
      <div className="rounded-lg border border-slate-200/80 bg-white p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95] mb-1">Peer Positioning Comparison</h4>
        <p className="text-xs text-slate-500 mb-3">
          Percentile by metric, each institution against its own matched peers — same asset band,
          state and lending mix where available. Bars are therefore not on a shared scale of
          institutions: a higher bar means further from that bank&apos;s own peers, not larger.
          A metric is blank where there are fewer than {MIN_COHORT} comparable institutions.
        </p>
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-slate-200 p-1 text-left transition hover:border-[#006D95]/40 cursor-zoom-in"
          onClick={() => setIsExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setIsExpanded(true)
            }
          }}
          aria-label="Expand peer positioning chart"
          title="Click to enlarge chart"
        >
          <div className="h-[260px] min-h-[260px] w-full">{renderChart(260)}</div>
        </button>
        <p className="mt-2 text-[11px] text-slate-500">Click chart to expand</p>
      </div>
      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent className="w-[96vw] sm:max-w-[1200px] h-[90vh] p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Peer Positioning Comparison</DialogTitle>
          </DialogHeader>
          <div className="h-[calc(90vh-120px)] w-full">{renderChart(560)}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ScreeningListSection({
  row,
  formatAssets,
  formatQuarter,
  formatDecimalPercent,
  formatMoney,
  formatPercentMetric,
  formatDeltaPercentPoints,
  formatRatio,
  getCreCapitalColor,
}: {
  row: InstitutionProfileRow
  formatAssets: (v: number | undefined) => string
  formatQuarter: (d?: string) => string
  formatDecimalPercent: (v: number | undefined) => string
  formatMoney: (v: number | null | undefined) => string
  formatPercentMetric: (v: number | null | undefined, d?: number) => string
  formatDeltaPercentPoints: (v: number | null | undefined, d?: number) => string
  formatRatio: (v: number | null | undefined) => string
  getCreCapitalColor: (v: number | undefined) => string
}) {
  // The three components of creLoans, so the shares total 100%. A fourth line
  // divided LNREOTH by creLoans; LNREOTH is 1-4 family residential and is not
  // in that denominator, so the four together ran to a median of 255.8%.
  const creMix = computeCreMix({
    constructionLoans: row.constructionLoans ?? 0,
    multifamilyLoans: row.multifamilyLoans ?? 0,
    nonResidentialLoans: row.nonResidentialLoans ?? 0,
    ownerOccupiedLoans: row.ownerOccupiedLoans ?? 0,
    nonOwnerOccupiedLoans: row.nonOwnerOccupiedLoans ?? 0,
  })
  const metrics: Array<{ label: string; term?: string; value: string; className?: string }> = [
    { label: "Report", value: formatQuarter(row.reportDate) },
    { label: "Total Assets", value: formatAssets(row.totalAssets) },
    { label: "Total Loans", value: formatMoney(row.totalLoans) },
    { label: "CRE Loans", value: formatMoney(row.creLoans) },
    { label: "CRE Concentration", value: row.creConcentration != null ? formatDecimalPercent(row.creConcentration / 100) : "—" },
    { label: "NPL ($)", value: formatMoney(row.nonaccrualLoans) },
    { label: "NPL Ratio", value: formatDecimalPercent(row.nplRatio) },
    { label: "Noncurrent / Loans", value: formatDecimalPercent(row.noncurrent_to_loans_ratio) },
    { label: "Noncurrent ($)", value: formatMoney((row.noncurrent_to_loans_ratio ?? 0) * (row.totalLoans ?? 0)) },
    { label: "Past Due 30-89 / Assets", value: formatDecimalPercent(row.pastDue3090) },
    { label: "Past Due 90+ / Assets", value: formatDecimalPercent(row.pastDue90Plus) },
    { label: "Reserve Coverage", value: formatDecimalPercent(row.loanLossReserve) },
    { label: "Loans / Deposits", value: formatDecimalPercent(row.loansToDeposits) },
    { label: "CET1", value: row.cet1Ratio != null ? formatPercentMetric(row.cet1Ratio, 1) : "—" },
    { label: "Leverage", value: row.leverageRatio != null ? formatPercentMetric(row.leverageRatio, 1) : "—" },
    { label: "CRE / (T1+T2)", value: formatRatio(row.capitalRatios?.creToTier1Tier2 ?? undefined), className: getCreCapitalColor(row.capitalRatios?.creToTier1Tier2 ?? undefined) },
    { label: "CRE / Equity", value: formatRatio(row.capitalRatios?.creToEquity ?? undefined), className: getCreCapitalColor(row.capitalRatios?.creToEquity ?? undefined) },
    { label: "Const / (T1+T2)", value: formatRatio(row.capitalRatios?.constructionToTier1Tier2 ?? undefined), className: getCreCapitalColor(row.capitalRatios?.constructionToTier1Tier2 ?? undefined) },
    { label: "MF / (T1+T2)", value: formatRatio(row.capitalRatios?.multifamilyToTier1Tier2 ?? undefined), className: getCreCapitalColor(row.capitalRatios?.multifamilyToTier1Tier2 ?? undefined) },
    { label: "ROA (Latest)", value: row.roaLatest != null ? formatPercentMetric(row.roaLatest, 2) : "—" },
    { label: "ROA Δ (4Q)", value: row.roaDelta4Q != null ? formatDeltaPercentPoints(row.roaDelta4Q, 2) : "—" },
    { label: "Net Income (TTM)", value: row.netIncomeTTM != null ? formatMoney(row.netIncomeTTM) : "—" },
    { label: "NI YoY %", value: row.netIncomeYoYPct != null ? formatDeltaPercentPoints(row.netIncomeYoYPct, 1) : "—" },
    { label: "NIM (Latest)", value: row.nimLatest != null ? formatPercentMetric(row.nimLatest, 2) : "—" },
    { label: "NIM Δ (4Q)", value: row.nimDelta4Q != null ? formatDeltaPercentPoints(row.nimDelta4Q, 2) : "—" },
    { label: "Earnings Buffer %", value: row.earningsBufferPct != null ? formatPercentMetric(row.earningsBufferPct, 1) : "—" },
    { label: "Total UC", value: formatMoney(row.totalUnusedCommitments) },
    { label: "CRE UC", value: formatMoney(row.creUnusedCommitments) },
  ]
  if (creMix) {
    metrics.push(
      { label: "CRE Mix: Construction", term: "CRE Mix", value: creMix.construction.toFixed(1) + "%" },
      { label: "CRE Mix: Multifamily", term: "CRE Mix", value: creMix.multifamily.toFixed(1) + "%" },
      { label: "CRE Mix: Non-owner-occupied", term: "CRE Mix", value: creMix.nonResidential.toFixed(1) + "%" }
    )
  }
  if (row.trend?.length) {
    metrics.push(
      { label: "CRE Concentration (4Q)", value: row.trend.map((e) => `${formatQuarter(e.reportDate)}: ${e.creConcentration != null ? e.creConcentration.toFixed(1) + "%" : "—"}`).join("; ") },
      { label: "NPL Ratio (4Q)", value: row.trend.map((e) => `${formatQuarter(e.reportDate)}: ${e.nplRatio != null ? (e.nplRatio * 100).toFixed(1) + "%" : "—"}`).join("; ") }
    )
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95] mb-2">Target Screening List</h4>
      <div className="space-y-1.5 text-sm text-slate-700">
        {metrics.map((m) => (
          <p key={m.label} className={`flex justify-between ${m.className ?? ""}`}>
            <span className="text-slate-500"><DefTerm term={m.term ?? m.label}>{m.label}</DefTerm></span>
            <span className="font-medium tabular-nums text-right">{m.value}</span>
          </p>
        ))}
      </div>
    </div>
  )
}

function ComparisonTable({
  rows,
  cohort,
  asOfQuarter,
  formatAssets,
  formatQuarter,
  formatDecimalPercent,
  formatMoney,
  formatPercentMetric,
  formatDeltaPercentPoints,
  formatRatio,
  getCreCapitalColor,
  onRemove,
}: {
  rows: InstitutionProfileRow[]
  cohort: InstitutionProfileRow[]
  asOfQuarter: string
  formatAssets: (v: number | undefined) => string
  formatQuarter: (d?: string) => string
  formatDecimalPercent: (v: number | undefined) => string
  formatMoney: (v: number | null | undefined) => string
  formatPercentMetric: (v: number | null | undefined, d?: number) => string
  formatDeltaPercentPoints: (v: number | null | undefined, d?: number) => string
  formatRatio: (v: number | null | undefined) => string
  getCreCapitalColor: (v: number | undefined) => string
  onRemove?: (id: string, reportDate?: string) => void
}) {
  // Memoised per institution rather than per cell: the four percentile rows plus the cohort row
  // would otherwise each reselect peers from the whole scope for every column.
  const peerGroupCache = useMemo(
    () => new Map(rows.map((r) => [r.id, resolvePeers(r, cohort)])),
    [rows, cohort]
  )
  const peerGroupFor = (r: InstitutionProfileRow) =>
    peerGroupCache.get(r.id) ?? resolvePeers(r, cohort)

  const metricKeys: Array<{ key: string; fn: (r: InstitutionProfileRow) => string; section?: string }> = [
    { section: "Report", key: "Report", fn: (r) => formatQuarter(r.reportDate) },
    { section: "Location", key: "City, State", fn: (r) => `${r.city ?? "—"}, ${r.state ?? "—"}` },
    { key: "Total Assets", fn: (r) => formatAssets(r.totalAssets) },
    { section: "Target Screening List", key: "Total Loans", fn: (r) => formatMoney(r.totalLoans) },
    { key: "CRE Loans", fn: (r) => formatMoney(r.creLoans) },
    { key: "CRE Concentration", fn: (r) => r.creConcentration != null ? formatDecimalPercent(r.creConcentration / 100) : "—" },
    { key: "NPL ($)", fn: (r) => formatMoney(r.nonaccrualLoans) },
    { key: "NPL Ratio", fn: (r) => formatDecimalPercent(r.nplRatio) },
    { key: "Noncurrent / Loans", fn: (r) => formatDecimalPercent(r.noncurrent_to_loans_ratio) },
    { key: "Noncurrent ($)", fn: (r) => formatMoney((r.noncurrent_to_loans_ratio ?? 0) * (r.totalLoans ?? 0)) },
    { key: "Past Due 30-89 / Assets", fn: (r) => formatDecimalPercent(r.pastDue3090) },
    { key: "Past Due 90+ / Assets", fn: (r) => formatDecimalPercent(r.pastDue90Plus) },
    { key: "Reserve Coverage", fn: (r) => formatDecimalPercent(r.loanLossReserve) },
    { key: "Loans / Deposits", fn: (r) => formatDecimalPercent(r.loansToDeposits) },
    { key: "CET1", fn: (r) => r.cet1Ratio != null ? formatPercentMetric(r.cet1Ratio, 1) : "—" },
    { key: "Leverage", fn: (r) => r.leverageRatio != null ? formatPercentMetric(r.leverageRatio, 1) : "—" },
    { key: "Total UC", fn: (r) => formatMoney(r.totalUnusedCommitments) },
    { key: "CRE UC", fn: (r) => formatMoney(r.creUnusedCommitments) },
    { section: "Structural Exposure", key: "CRE / Assets", fn: (r) => r.creConcentration != null ? r.creConcentration.toFixed(1) + "%" : "—" },
    { key: "CRE / Capital", fn: (r) => r.capitalRatios?.creToTier1Tier2 != null ? formatRatio(r.capitalRatios.creToTier1Tier2) : "—" },
    { key: "Construction / Capital", fn: (r) => r.capitalRatios?.constructionToTier1Tier2 != null ? formatRatio(r.capitalRatios.constructionToTier1Tier2) : "—" },
    { key: "Multifamily / Capital", fn: (r) => r.capitalRatios?.multifamilyToTier1Tier2 != null ? formatRatio(r.capitalRatios.multifamilyToTier1Tier2) : "—" },
    { key: "Capital", fn: (r) => r.cet1Ratio != null && r.cet1Ratio !== 0 ? r.cet1Ratio.toFixed(1) + "% (CET1)" : r.leverageRatio != null ? r.leverageRatio.toFixed(1) + "% (Leverage)" : "—" },
    { section: "Earnings", key: "ROA", fn: (r) => r.roaLatest != null ? r.roaLatest.toFixed(2) + "%" + (r.roaDelta4Q != null ? ` (Δ4Q: ${r.roaDelta4Q >= 0 ? "+" : ""}${r.roaDelta4Q.toFixed(2)} pp)` : "") : "—" },
    { key: "Net Income (TTM)", fn: (r) => r.netIncomeTTM != null ? formatMoney(r.netIncomeTTM) + (r.netIncomeYoYPct != null ? ` (YoY: ${r.netIncomeYoYPct >= 0 ? "+" : ""}${r.netIncomeYoYPct.toFixed(1)}%)` : "") : "—" },
    { key: "NIM", fn: (r) => r.nimLatest != null ? r.nimLatest.toFixed(2) + "%" + (r.nimDelta4Q != null ? ` (Δ4Q: ${r.nimDelta4Q >= 0 ? "+" : ""}${r.nimDelta4Q.toFixed(2)} pp)` : "") : "—" },
    { key: "Earnings Buffer", fn: (r) => r.earningsBufferPct != null ? r.earningsBufferPct.toFixed(1) + "%" : "—" },
    // Each column is ranked against that institution's own peers, so two columns side by side are
    // answering "how does this bank sit among banks like it" rather than sharing one denominator.
    // `Cohort` states the basis per column, because without it the rows below cannot be compared.
    {
      section: "Peer Positioning",
      key: "Cohort",
      fn: (r) => {
        const group = peerGroupFor(r)
        return `${group.peers.length} peer${group.peers.length === 1 ? "" : "s"} — ${group.cohort.description}`
      },
    },
    ...PEER_METRICS.map(({ label, get }) => ({
      key: label,
      fn: (r: InstitutionProfileRow) =>
        formatPercentile(percentileAmong(peerGroupFor(r).peers, get(r), get)),
    })),
  ]
  let currentSection = ""
  return (
    <div className="overflow-auto max-h-[60vh]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="sticky top-0 z-20 bg-white text-left py-2 pr-4 font-medium text-slate-600">Metric</th>
            {rows.map((r) => (
              <th key={`${r.id}-${r.reportDate}`} className="sticky top-0 z-20 bg-white text-left py-2 px-2 font-medium text-slate-700 min-w-[140px]">
                {r.name}
                {r.state ? ` (${r.state})` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metricKeys.flatMap(({ key, fn, section }, idx) => {
            const out: React.ReactNode[] = []
            if (section && section !== currentSection) {
              currentSection = section
              out.push(
                <tr key={`section-${section}`} className="border-t border-slate-200">
                  <td colSpan={(rows.length ?? 0) + 1} className="py-2 pt-4 text-xs font-semibold uppercase tracking-wide text-[#006D95]">
                    {section}
                  </td>
                </tr>
              )
            }
            out.push(
              <tr key={`metric-${idx}-${section ?? ""}-${key}`} className="border-b border-slate-100">
                <td className="py-1.5 pr-4 text-slate-500"><DefTerm term={key}>{key}</DefTerm></td>
                {rows.map((r) => (
                  <td key={`${r.id}-${r.reportDate}`} className="py-1.5 px-2 tabular-nums">
                    {fn(r)}
                  </td>
                ))}
              </tr>
            )
            return out
          })}
        </tbody>
      </table>
      {onRemove && rows.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <p className="text-xs font-medium text-slate-600 mb-2">Remove from compare:</p>
          <div className="flex flex-wrap gap-2">
            {rows.map((r) => (
              <Button
                key={`${r.id}-${r.reportDate ?? "na"}`}
                variant="outline"
                size="sm"
                onClick={() => onRemove(r.id, r.reportDate)}
                className="text-slate-600 hover:text-red-600 hover:border-red-300"
              >
                <X className="h-4 w-4 mr-1.5" />
                {r.name}
                {r.state ? ` (${r.state})` : ""}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
