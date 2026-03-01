"use client"

import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Download, Columns3 } from "lucide-react"
import { DefTerm } from "@/components/def-term"
import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { MarketResearch } from "@/components/market-research"
import { computeCapitalRatios, type CapitalRatios } from "@/lib/fdic-ratio-helpers"
import { toast } from "@/hooks/use-toast"
import { KPI_EXPLANATION_NARRATIVE } from "@/lib/report/kpi-explanation"
import {
  formatPercent as formatPercentMetric,
  formatDeltaPercentPoints,
  formatMoney,
  formatMultiple as formatMultipleMetric,
} from "@/lib/format/metrics"
import { getCreCapitalColor } from "@/lib/score-colors"
import { getErrorMessage } from "@/lib/error-utils"
import { InstitutionProfileDrawer } from "@/components/institution-profile-drawer"

const US_STATES_ALPHABETICAL = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
] as const

type RegionKey = "national" | (typeof US_STATES_ALPHABETICAL)[number]

type Filters = {
  region: RegionKey
  limit: number
}

type Financial = {
  id: string
  name: string
  city?: string
  state?: string
  totalAssets: number
  totalDeposits?: number
  netIncome?: number
  roa?: number
  roe?: number
  creConcentration?: number
  creLoans?: number
  totalLoans?: number
  nonaccrualLoans?: number
  constructionLoans?: number
  multifamilyLoans?: number
  nonResidentialLoans?: number
  otherRealEstateLoans?: number
  totalUnusedCommitments?: number
  creUnusedCommitments?: number
  nplRatio?: number
  noncurrent_to_loans_ratio?: number
  noncurrent_to_assets_ratio?: number
  pastDue3090?: number
  pastDue90Plus?: number
  loanLossReserve?: number
  netInterestMargin?: number
  cet1Ratio?: number
  leverageRatio?: number
  tier1RbcRatio?: number
  totalRbcRatio?: number
  reportDate?: string
  totalEquityDollars?: number | null
}

type ScreeningRow = Financial & {
  trend: Array<{
    reportDate: string
    creConcentration?: number
    nplRatio?: number
    roa?: number
    netIncome?: number
    netInterestMargin?: number
  }>
  /** Structural Opportunity Score (CRE concentration + credit stress) */
  opportunityScore: number
  /** Earnings Resilience Score (0–100) */
  earningsScore: number
  /** Composite Vulnerability Score (structural adjusted by earnings) */
  vulnerabilityScore: number
  capitalRatio: number
  capitalRatios?: CapitalRatios
  /** Income KPIs (null if data missing) */
  roaLatest?: number | null
  roaDelta4Q?: number | null
  netIncomeTTM?: number | null
  netIncomeYoYPct?: number | null
  nimLatest?: number | null
  nimDelta4Q?: number | null
  earningsBufferPct?: number | null
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function formatQuarter(dateString?: string) {
  if (!dateString) return "Unknown"
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

/** Normalize report date to YYYYMMDD for consistent comparison (FDIC may return YYYYMMDD or YYYY-MM-DD) */
function normalizeReportDate(dateStr: string | undefined): string {
  if (!dateStr) return ""
  if (/^\d{8}$/.test(dateStr)) return dateStr
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[1] + m[2] + m[3]
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}${mo}${day}`
}

function formatCurrency(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return currencyFormatter.format(value)
}

function formatPercent(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return percentFormatter.format(value / 100)
}

function formatNumber(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US").format(value)
}

function formatRatio(value: number | null | undefined) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return formatMultipleMetric(value)
}

const PAGE_LEVEL_TO_REGION: Record<string, RegionKey> = {
  national: "national",
  florida: "Florida",
  miami: "Florida",
}

export function MarketAnalytics({ level, reportMode, initialScope }: { level: "national" | "florida" | "miami"; reportMode?: boolean; initialScope?: string }) {
  const [filters, setFilters] = useState<Filters>(() => {
    if (reportMode && initialScope) {
      const s = initialScope.trim()
      if (s === "National" || s === "national") return { region: "national", limit: 5000 }
      return { region: s as RegionKey, limit: 5000 }
    }
    return { region: PAGE_LEVEL_TO_REGION[level] ?? "national", limit: 5000 }
  })
  const [showCapitalColumns, setShowCapitalColumns] = useState(false)
  const [showEarningsColumns, setShowEarningsColumns] = useState(false)
  const [tableSortColumn, setTableSortColumn] = useState<"npl" | "cre">("npl")
  const [tableSortDesc, setTableSortDesc] = useState(true)
  const [selectedInstitution, setSelectedInstitution] = useState<ScreeningRow | null>(null)
  const [compareRows, setCompareRows] = useState<ScreeningRow[]>([])
  const [loading, setLoading] = useState(true)
  const [financials, setFinancials] = useState<Financial[]>([])
  const [error, setError] = useState<string | undefined>()
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (reportMode && initialScope) return
    setFilters((prev) => ({ ...prev, region: PAGE_LEVEL_TO_REGION[level] ?? "national" }))
  }, [level, reportMode, initialScope])

  useEffect(() => {
    let mounted = true

    async function loadData() {
      setLoading(true)
      setError(undefined)

      try {
        const stateFilter = filters.region === "national" ? undefined : filters.region
        // Use fetchAll: false for faster load; full pagination (200k rows) can timeout or take minutes
        const fetchAll = false
        const limit = Math.min(filters.limit, 5000)
        const [financialsResult] = await Promise.all([fetchFDICFinancials(stateFilter, limit, fetchAll)])

        if (!mounted) return

        if (!financialsResult || typeof financialsResult !== "object") {
          setError("Failed to load FDIC data: empty response.")
          setFinancials([])
          return
        }

        if (financialsResult.error) {
          setError(financialsResult.error || "Failed to load FDIC data.")
          setFinancials([])
          return
        }

        setFinancials((financialsResult.data ?? []) as Financial[])
      } catch (err) {
        if (!mounted) return
        setError(`Failed to load FDIC data: ${getErrorMessage(err)}`)
        setFinancials([])
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadData()
    return () => {
      mounted = false
    }
  }, [filters])

  const regionFinancials = useMemo(() => {
    return financials.filter((item) => {
      if (filters.region === "national") return true
      return item.state && item.state.toUpperCase() === filters.region.toUpperCase()
    })
  }, [financials, filters.region])

  const lastQuarterDates = useMemo(() => {
    const dates = Array.from(
      new Set(regionFinancials.map((item) => item.reportDate).filter(Boolean))
    ) as string[]
    return dates
      .sort((a, b) => {
        const aNorm = normalizeReportDate(a)
        const bNorm = normalizeReportDate(b)
        return bNorm.localeCompare(aNorm)
      })
      .slice(0, 8)
  }, [regionFinancials])

  const lastQuarterDatesDisplay = useMemo(() => lastQuarterDates.slice(0, 4), [lastQuarterDates])

  const filteredFinancials = useMemo(() => {
    return regionFinancials.filter((item) => {
      if (lastQuarterDates.length > 0 && item.reportDate && !lastQuarterDates.includes(item.reportDate)) {
        return false
      }
      return true
    })
  }, [regionFinancials, lastQuarterDates])

  const nplLoansSummary = useMemo(() => {
    if (filteredFinancials.length === 0) return null
    const latestById = new Map<string, Financial>()
    filteredFinancials.forEach((item) => {
      const existing = latestById.get(item.id)
      const existingDate = existing?.reportDate ? Date.parse(existing.reportDate) : 0
      const nextDate = item.reportDate ? Date.parse(item.reportDate) : 0
      if (!existing || nextDate > existingDate) latestById.set(item.id, item)
    })
    const latest = Array.from(latestById.values())
    const totalLoans = latest.reduce((s, i) => s + (i.totalLoans ?? 0), 0)
    const totalNpl = latest.reduce((s, i) => s + (i.nonaccrualLoans ?? 0), 0)
    const totalCre = latest.reduce((s, i) => s + (i.creLoans ?? 0), 0)
    const totalAssets = latest.reduce((s, i) => s + i.totalAssets, 0)
    const avgNpl = latest.length > 0
      ? latest.reduce((s, i) => s + (i.nplRatio ?? 0) * 100, 0) / latest.length
      : 0
    const avgCreToAssets = totalAssets > 0 ? (totalCre / totalAssets) * 100 : 0
    return { totalLoans, totalNpl, totalCre, totalAssets, avgNpl, avgCreToAssets, count: latest.length }
  }, [filteredFinancials])

  const kpis = useMemo(() => {
    if (filteredFinancials.length === 0) {
      return [
        { label: "Institutions Screened", value: "0" },
        { label: "Avg NPL Ratio", value: "—" },
        { label: "Avg Noncurrent / Loans", value: "—" },
        { label: "Avg Reserve Coverage", value: "—" },
        { label: "Avg CRE Concentration", value: "—" },
      ]
    }

    const latestById = new Map<string, Financial>()
    filteredFinancials.forEach((item) => {
      const existing = latestById.get(item.id)
      const existingDate = existing?.reportDate ? Date.parse(existing.reportDate) : 0
      const nextDate = item.reportDate ? Date.parse(item.reportDate) : 0
      if (!existing || nextDate > existingDate) {
        latestById.set(item.id, item)
      }
    })

    const latest = Array.from(latestById.values())
    const average = (values: number[]) =>
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

    const avgNpl = average(latest.map((item) => item.nplRatio || 0))
    const avgNoncurrentLoans = average(latest.map((item) => (item.noncurrent_to_loans_ratio ?? 0) * 100))
    const avgReserve = average(latest.map((item) => item.loanLossReserve || 0))
    const avgCre = average(latest.map((item) => item.creConcentration || 0))

    return [
      { label: "Institutions Screened", value: formatNumber(latest.length) },
      { label: "Avg NPL Ratio", value: formatPercent(avgNpl * 100) },
      { label: "Avg Noncurrent / Loans", value: formatPercent(avgNoncurrentLoans) },
      { label: "Avg Reserve Coverage", value: formatPercent(avgReserve * 100) },
      { label: "Avg CRE Concentration", value: formatPercent(avgCre) },
    ]
  }, [filteredFinancials])

  const screeningTable = useMemo<ScreeningRow[]>(() => {
    const grouped = new Map<string, Financial[]>()
    filteredFinancials.forEach((item) => {
      if (!grouped.has(item.id)) grouped.set(item.id, [])
      grouped.get(item.id)!.push(item)
    })

    const mostRecentQuarter = lastQuarterDates[0]
    const mostRecentNorm = normalizeReportDate(mostRecentQuarter)
    const rows: ScreeningRow[] = []
    grouped.forEach((items) => {
      const sorted = [...items].sort((a, b) => {
        const aNorm = normalizeReportDate(a.reportDate)
        const bNorm = normalizeReportDate(b.reportDate)
        return bNorm.localeCompare(aNorm)
      })
      const byDateNorm = new Map(sorted.map((entry) => [normalizeReportDate(entry.reportDate), entry]))
      const latest = mostRecentNorm && byDateNorm.has(mostRecentNorm)
        ? byDateNorm.get(mostRecentNorm)!
        : sorted[0]
      if (mostRecentNorm && !byDateNorm.has(mostRecentNorm)) return
      const capitalRatio = latest.cet1Ratio ?? latest.leverageRatio ?? 0
      const trend = lastQuarterDatesDisplay
        .filter(Boolean)
        .map((date) => {
          const entry = byDateNorm.get(normalizeReportDate(date))
          return {
            reportDate: date,
            creConcentration: entry?.creConcentration,
            nplRatio: entry?.nplRatio,
            roa: entry?.roa,
            netIncome: entry?.netIncome,
            netInterestMargin: entry?.netInterestMargin,
          }
        })
      const capitalRatios = computeCapitalRatios({
        totalAssets: latest.totalAssets,
        creLoans: latest.creLoans ?? 0,
        constructionLoans: latest.constructionLoans ?? 0,
        multifamilyLoans: latest.multifamilyLoans ?? 0,
        leverageRatio: latest.leverageRatio,
        tier1RbcRatio: latest.tier1RbcRatio,
        totalRbcRatio: latest.totalRbcRatio,
        cet1Ratio: latest.cet1Ratio,
        totalEquityDollars: latest.totalEquityDollars,
      })

      const q0 = lastQuarterDates[0]
      const q3 = lastQuarterDates[3]
      const q7 = lastQuarterDates[7]
      const roaLatest = latest.roa != null ? latest.roa : null
      const roaDelta4Q =
        lastQuarterDates.length >= 4 && roaLatest != null && byDateNorm.get(normalizeReportDate(q3))?.roa != null
          ? roaLatest - (byDateNorm.get(normalizeReportDate(q3))!.roa ?? 0)
          : null
      const nimLatest = latest.netInterestMargin != null ? latest.netInterestMargin : null
      const nimDelta4Q =
        lastQuarterDates.length >= 4 && nimLatest != null && byDateNorm.get(normalizeReportDate(q3))?.netInterestMargin != null
          ? nimLatest - (byDateNorm.get(normalizeReportDate(q3))!.netInterestMargin ?? 0)
          : null

      const niCurrent4 = lastQuarterDates.slice(0, 4).map((d) => byDateNorm.get(normalizeReportDate(d))?.netIncome)
      const hasAll4 = niCurrent4.length === 4 && niCurrent4.every((v) => v != null && Number.isFinite(v))
      const netIncomeTTM = hasAll4 ? (niCurrent4.reduce((s, v) => s! + v!, 0) as number) : null

      const niPrior4 = lastQuarterDates.slice(4, 8).map((d) => byDateNorm.get(normalizeReportDate(d))?.netIncome)
      const hasAll8 = niPrior4.length === 4 && niPrior4.every((v) => v != null && Number.isFinite(v))
      const netIncomeTTMPrior = hasAll8 ? (niPrior4.reduce((s, v) => s! + v!, 0) as number) : null
      const netIncomeYoYPct =
        netIncomeTTM != null && netIncomeTTMPrior != null
          ? (() => {
              const denom = Math.abs(netIncomeTTMPrior)
              if (denom === 0) return null
              return ((netIncomeTTM - netIncomeTTMPrior) / denom) * 100
            })()
          : null

      const creLoansLatest = latest.creLoans ?? 0
      const earningsBufferPct =
        netIncomeTTM != null && creLoansLatest > 0 ? (netIncomeTTM / creLoansLatest) * 100 : null

      rows.push({
        ...latest,
        trend,
        opportunityScore: 0,
        earningsScore: 0,
        vulnerabilityScore: 0,
        capitalRatio,
        capitalRatios,
        roaLatest: roaLatest ?? undefined,
        roaDelta4Q: roaDelta4Q ?? undefined,
        netIncomeTTM: netIncomeTTM ?? undefined,
        netIncomeYoYPct: netIncomeYoYPct ?? undefined,
        nimLatest: nimLatest ?? undefined,
        nimDelta4Q: nimDelta4Q ?? undefined,
        earningsBufferPct: earningsBufferPct ?? undefined,
      })
    })

    return rows
  }, [filteredFinancials, lastQuarterDates])

  const sortedScreeningTable = useMemo(() => {
    return [...screeningTable].sort((a, b) => {
      if (tableSortColumn === "npl") {
        const va = a.nonaccrualLoans ?? 0
        const vb = b.nonaccrualLoans ?? 0
        return tableSortDesc ? vb - va : va - vb
      }
      const va = a.creConcentration ?? 0
      const vb = b.creConcentration ?? 0
      return tableSortDesc ? vb - va : va - vb
    })
  }, [screeningTable, tableSortColumn, tableSortDesc])

  const reportScope = filters.region === "national" ? "National" : filters.region
  const asOfQuarter = lastQuarterDates[0] ? formatQuarter(lastQuarterDates[0]) : "Latest"

  const regionLabels: Record<string, string> = {
    national: "United States",
    Florida: "Florida",
    florida: "Florida",
    miami: "Miami Metro (Miami-Dade proxy)",
  }

  const getRegionNote = (region: RegionKey) => {
    if (region === "national") return "National FDIC dataset (quarterly, lagged)."
    return `${region} chartered banks only (FDIC quarterly, lagged).`
  }

  const handleDownloadReport = async () => {
    setExporting(true)
    try {
      const scope = filters.region === "national" ? "National" : filters.region
      const res = await fetch(`/api/export/market-analytics?scope=${encodeURIComponent(scope)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = body?.detail ?? body?.error ?? "Export failed"
        throw new Error(detail)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `Executive_Report_${scope.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export error:", err)
      toast({
        title: "Export failed",
        description: getErrorMessage(err),
        variant: "destructive",
      })
    } finally {
      setExporting(false)
    }
  }

  const isMiamiLevel = level === "miami"

  const regionDisplay = regionLabels[filters.region] ?? filters.region

  return (
    <div className="space-y-6" data-report-ready={!loading && !error} data-report-mode={reportMode}>
      {loading && (
        <Card className="p-4 border-dashed border-slate-200/80 bg-slate-50/30">
          <p className="text-sm font-medium text-slate-800">
            Loading FDIC data for {regionDisplay}…
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Fetching bank financials from FDIC. This may take a few seconds.
          </p>
        </Card>
      )}

      {error && (
        <Card className="p-4 border-dashed border-slate-200/80 bg-slate-50/30">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      {isMiamiLevel && (
        <p className="text-xs text-slate-600 rounded-md border border-slate-200 px-3 py-2">
          FDIC analytics available at national/state level only. Florida data shown as Miami-Dade proxy.
        </p>
      )}

      {!reportMode && (
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-600 uppercase">Controls</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <select
                value={filters.region}
                onChange={(event) =>
                  setFilters({ ...filters, region: event.target.value as Filters["region"] })
                }
                className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="national">United States</option>
                {US_STATES_ALPHABETICAL.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Columns3 className="h-4 w-4 mr-2" />
                    Columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600">Capital ratio columns</p>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showCapitalColumns}
                        onChange={(e) => setShowCapitalColumns(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm">CRE / (Tier1+Tier2), CRE / Equity, Construction / Capital, Multifamily / Capital</span>
                    </label>
                    <p className="text-xs font-semibold text-slate-600 pt-2">Earnings columns</p>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showEarningsColumns}
                        onChange={(e) => setShowEarningsColumns(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm">ROA, ROA Δ, NI TTM, NI YoY %, NIM, NIM Δ, Earnings Buffer %</span>
                    </label>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </Card>
      )}

      {nplLoansSummary && (
      <Card className="p-6 border-slate-200/80 bg-white border-2 border-slate-300 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-1">NPL & Loans</h2>
          <p className="text-sm text-slate-600 mb-4">
            Nonperforming loan metrics and dollar value of loans for {regionDisplay}. NPL ratio is nonaccrual loans as a share of total loans; dollar values are from FDIC call reports (latest quarter).
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 min-w-0">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide"><DefTerm term="Total Loans">Total Loans</DefTerm></p>
              <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">{loading ? "…" : formatMoney(nplLoansSummary.totalLoans)}</p>
              <p className="text-xs text-slate-500 mt-0.5">Net loans & leases</p>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 min-w-0">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide"><DefTerm term="NPL Ratio">Avg NPL Ratio</DefTerm></p>
              <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">{loading ? "…" : formatPercent(nplLoansSummary.avgNpl)}</p>
              <p className="text-xs text-slate-500 mt-0.5">Nonaccrual ÷ total loans</p>
            </div>
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 min-w-0">
              <p className="text-xs font-medium text-amber-800 uppercase tracking-wide">NPL ($)</p>
              <p className="text-sm font-semibold text-amber-900 mt-1 tabular-nums">{loading ? "…" : formatMoney(nplLoansSummary.totalNpl)}</p>
              <p className="text-xs text-amber-700 mt-0.5">Total nonaccrual loans</p>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 min-w-0">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide"><DefTerm term="CRE Concentration">CRE Loans</DefTerm></p>
              <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">{loading ? "…" : formatMoney(nplLoansSummary.totalCre)}</p>
              <p className="text-xs text-slate-500 mt-0.5">Construction + multifamily + non-res + other</p>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 min-w-0">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">CRE / Assets</p>
              <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">{loading ? "…" : formatPercent(nplLoansSummary.avgCreToAssets)}</p>
              <p className="text-xs text-slate-500 mt-0.5">CRE loans as % of total assets</p>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 min-w-0">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide"><DefTerm term="Total Assets">Total Assets</DefTerm></p>
              <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">{loading ? "…" : formatMoney(nplLoansSummary.totalAssets)}</p>
              <p className="text-xs text-slate-500 mt-0.5">{nplLoansSummary.count} institutions</p>
            </div>
          </div>
        </div>
      </Card>
      )}

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800 mb-1">Cohort Summary</h3>
            <p className="text-xs text-slate-600 mb-6">
              Average metrics for {regionDisplay} based on the latest quarter. NPL and CRE concentration from FDIC call reports.
            </p>
            <p className="text-xs text-slate-600">{getRegionNote(filters.region)}</p>
            <p className="text-xs text-slate-500">Source: FDIC call reports (latest available quarter).</p>
          </div>
          <div className="flex items-center gap-3">
            {!reportMode && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleDownloadReport}
                  disabled={exporting || loading}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {exporting ? "Generating…" : "Download Report (ZIP)"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setExporting(true)
                    try {
                      const scope = filters.region === "national" ? "National" : filters.region
                      const res = await fetch(`/api/report/market-analytics-pdf?scope=${encodeURIComponent(scope)}`)
                      if (!res.ok) throw new Error("PDF generation failed")
                      const blob = await res.blob()
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `Executive_Report_${scope.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`
                      a.click()
                      URL.revokeObjectURL(url)
                    } catch (err) {
                      toast({ title: "PDF failed", description: getErrorMessage(err), variant: "destructive" })
                    } finally {
                      setExporting(false)
                    }
                  }}
                  disabled={exporting || loading}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF Report
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="p-3 bg-white border-slate-200">
              <p className="text-xs font-medium text-slate-600">
                <DefTerm term={kpi.label}>{kpi.label}</DefTerm>
              </p>
              <p className="text-lg font-semibold text-slate-800">{loading ? "…" : kpi.value}</p>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-600 leading-relaxed">
          {KPI_EXPLANATION_NARRATIVE}
        </p>
      </Card>

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800 mb-1">Target Screening List</h3>
            <p className="text-xs text-slate-600 mb-2">
              Bank-level screening table focused on NPL (nonaccrual loans in dollars), CRE loans, and CRE concentration (CRE as % of total loans). Sort by NPL ($) or CRE Concentration to prioritize. Use as a starting screen—verify exposures from primary filings and loan-level data.
            </p>
            <p className="text-xs text-slate-600">{getRegionNote(filters.region)}</p>
          </div>
          {!reportMode && screeningTable.length > 0 && (
            <Select
              value={
                selectedInstitution
                  ? `${selectedInstitution.id}-${selectedInstitution.reportDate ?? ""}`
                  : "__none__"
              }
              onValueChange={(value) => {
                if (value === "__none__") {
                  setSelectedInstitution(null)
                  return
                }
                const row = sortedScreeningTable.find(
                  (r) => `${r.id}-${r.reportDate ?? ""}` === value
                )
                if (row) {
                  setSelectedInstitution(row)
                  const key = `${row.id}-${row.reportDate ?? ""}`
                  setCompareRows((prev) =>
                    prev.some((r) => `${r.id}-${r.reportDate ?? ""}` === key)
                      ? prev
                      : [row, ...prev]
                  )
                }
              }}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Jump to institution…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select institution…</SelectItem>
                {[...sortedScreeningTable]
                  .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                  .map((item) => (
                  <SelectItem
                    key={`${item.id}-${item.reportDate ?? "na"}`}
                    value={`${item.id}-${item.reportDate ?? ""}`}
                  >
                    {item.name}
                    {item.state ? ` (${item.state})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Table stickyHeaders>
          <TableHeader>
            <TableRow>
              <TableHead><DefTerm term="Institution">Institution</DefTerm></TableHead>
              <TableHead><DefTerm term="State">State</DefTerm></TableHead>
              <TableHead><DefTerm term="Report">Report</DefTerm></TableHead>
              <TableHead><DefTerm term="Total Assets">Total Assets</DefTerm></TableHead>
              <TableHead><DefTerm term="Total Loans">Total Loans</DefTerm></TableHead>
              <TableHead><DefTerm term="Total CRE Loans">CRE Loans</DefTerm></TableHead>
              <TableHead>
                <button
                  type="button"
                  className="cursor-pointer border-b border-dashed border-muted-foreground/50 hover:opacity-80 text-left font-normal flex items-center gap-1"
                  onClick={() => {
                    setTableSortColumn("cre")
                    setTableSortDesc((prev) => (tableSortColumn === "cre" ? !prev : true))
                  }}
                >
                  <DefTerm term="CRE Concentration">CRE Concentration</DefTerm>
                  {tableSortColumn === "cre" ? (tableSortDesc ? " ↓" : " ↑") : ""}
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="cursor-pointer border-b border-dashed border-muted-foreground/50 hover:opacity-80 text-left font-normal flex items-center gap-1"
                  onClick={() => {
                    setTableSortColumn("npl")
                    setTableSortDesc((prev) => (tableSortColumn === "npl" ? !prev : true))
                  }}
                >
                  NPL ($)
                  {tableSortColumn === "npl" ? (tableSortDesc ? " ↓" : " ↑") : ""}
                </button>
              </TableHead>
              <TableHead><DefTerm term="NPL Ratio">NPL Ratio</DefTerm></TableHead>
              <TableHead><DefTerm term="Noncurrent / Loans">Noncurrent / Loans</DefTerm></TableHead>
              <TableHead><DefTerm term="Noncurrent ($)">Noncurrent ($)</DefTerm></TableHead>
              <TableHead><DefTerm term="Past Due 30-89 / Assets">Past Due 30-89 / Assets</DefTerm></TableHead>
              <TableHead><DefTerm term="Past Due 90+ / Assets">Past Due 90+ / Assets</DefTerm></TableHead>
              <TableHead><DefTerm term="Reserve Coverage">Reserve Coverage</DefTerm></TableHead>
              <TableHead><DefTerm term="CET1">CET1</DefTerm></TableHead>
              <TableHead><DefTerm term="Leverage">Leverage</DefTerm></TableHead>
              <TableHead><DefTerm term="Capital Used">Capital Used</DefTerm></TableHead>
              {showCapitalColumns && <TableHead><DefTerm term="CRE / (T1+T2)">CRE / (T1+T2)</DefTerm></TableHead>}
              {showCapitalColumns && <TableHead><DefTerm term="CRE / Equity">CRE / Equity</DefTerm></TableHead>}
              {showCapitalColumns && <TableHead><DefTerm term="Const / (T1+T2)">Const / (T1+T2)</DefTerm></TableHead>}
              {showCapitalColumns && <TableHead><DefTerm term="MF / (T1+T2)">MF / (T1+T2)</DefTerm></TableHead>}
              {showEarningsColumns && <TableHead><DefTerm term="ROA (Latest)">ROA (Latest)</DefTerm></TableHead>}
              {showEarningsColumns && <TableHead><DefTerm term="ROA Δ (4Q)">ROA Δ (4Q)</DefTerm></TableHead>}
              {showEarningsColumns && <TableHead><DefTerm term="Net Income (TTM)">Net Income (TTM)</DefTerm></TableHead>}
              {showEarningsColumns && <TableHead><DefTerm term="Net Income YoY %">NI YoY %</DefTerm></TableHead>}
              {showEarningsColumns && <TableHead><DefTerm term="NIM (Latest)">NIM (Latest)</DefTerm></TableHead>}
              {showEarningsColumns && <TableHead><DefTerm term="NIM Δ (4Q)">NIM Δ (4Q)</DefTerm></TableHead>}
              {showEarningsColumns && <TableHead><DefTerm term="Earnings Buffer %">Earnings Buffer %</DefTerm></TableHead>}
              <TableHead><DefTerm term="Total Unused Commitments">Total UC</DefTerm></TableHead>
              <TableHead><DefTerm term="Unused Commitments (CRE)">CRE UC</DefTerm></TableHead>
              <TableHead><DefTerm term="CRE Mix">CRE Mix</DefTerm></TableHead>
              <TableHead><DefTerm term="CRE Concentration (4Q)">CRE Concentration (4Q)</DefTerm></TableHead>
              <TableHead><DefTerm term="NPL Ratio (4Q)">NPL Ratio (4Q)</DefTerm></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedScreeningTable.map((item, index) => (
              <TableRow
                key={`${item.id}-${item.reportDate || "na"}-${index}`}
                data-clickable-row={!reportMode ? "" : undefined}
                className={!reportMode ? "cursor-pointer hover:bg-slate-100/80" : undefined}
                onClick={!reportMode ? () => {
                  setSelectedInstitution(item)
                  const key = `${item.id}-${item.reportDate ?? ""}`
                  setCompareRows((prev) =>
                    prev.some((r) => `${r.id}-${r.reportDate ?? ""}` === key)
                      ? prev
                      : [item, ...prev]
                  )
                } : undefined}
              >
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.state || "—"}</TableCell>
                <TableCell>{formatQuarter(item.reportDate)}</TableCell>
                <TableCell>{formatCurrency(item.totalAssets)}</TableCell>
                <TableCell>{formatCurrency(item.totalLoans)}</TableCell>
                <TableCell>{formatCurrency(item.creLoans)}</TableCell>
                <TableCell>{formatPercent(item.creConcentration)}</TableCell>
                <TableCell>{formatMoney(item.nonaccrualLoans)}</TableCell>
                <TableCell>{formatPercent((item.nplRatio ?? 0) * 100)}</TableCell>
                <TableCell>{formatPercent((item.noncurrent_to_loans_ratio ?? 0) * 100)}</TableCell>
                <TableCell>{formatMoney((item.noncurrent_to_loans_ratio ?? 0) * (item.totalLoans ?? 0))}</TableCell>
                <TableCell>{formatPercent((item.pastDue3090 ?? 0) * 100)}</TableCell>
                <TableCell>{formatPercent((item.pastDue90Plus ?? 0) * 100)}</TableCell>
                <TableCell>{formatPercent((item.loanLossReserve ?? 0) * 100)}</TableCell>
                <TableCell>{formatPercent(item.cet1Ratio)}</TableCell>
                <TableCell>{formatPercent(item.leverageRatio)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.cet1Ratio !== undefined && item.cet1Ratio !== 0 ? "CET1" : "Leverage"}
                </TableCell>
                {showCapitalColumns && (
                  <TableCell className={getCreCapitalColor(item.capitalRatios?.creToTier1Tier2 ?? undefined)}>{formatRatio(item.capitalRatios?.creToTier1Tier2)}</TableCell>
                )}
                {showCapitalColumns && (
                  <TableCell className={getCreCapitalColor(item.capitalRatios?.creToEquity ?? undefined)}>{formatRatio(item.capitalRatios?.creToEquity)}</TableCell>
                )}
                {showCapitalColumns && (
                  <TableCell className={getCreCapitalColor(item.capitalRatios?.constructionToTier1Tier2 ?? undefined)}>{formatRatio(item.capitalRatios?.constructionToTier1Tier2)}</TableCell>
                )}
                {showCapitalColumns && (
                  <TableCell className={getCreCapitalColor(item.capitalRatios?.multifamilyToTier1Tier2 ?? undefined)}>{formatRatio(item.capitalRatios?.multifamilyToTier1Tier2)}</TableCell>
                )}
                {showEarningsColumns && (
                  <TableCell>{item.roaLatest != null ? formatPercentMetric(item.roaLatest, 2) : "—"}</TableCell>
                )}
                {showEarningsColumns && (
                  <TableCell>{item.roaDelta4Q != null ? formatDeltaPercentPoints(item.roaDelta4Q, 2) : "—"}</TableCell>
                )}
                {showEarningsColumns && (
                  <TableCell>{item.netIncomeTTM != null ? formatMoney(item.netIncomeTTM) : "—"}</TableCell>
                )}
                {showEarningsColumns && (
                  <TableCell>
                    {item.netIncomeYoYPct != null ? formatDeltaPercentPoints(item.netIncomeYoYPct, 1) : "—"}
                  </TableCell>
                )}
                {showEarningsColumns && (
                  <TableCell>{item.nimLatest != null ? formatPercentMetric(item.nimLatest, 2) : "—"}</TableCell>
                )}
                {showEarningsColumns && (
                  <TableCell>{item.nimDelta4Q != null ? formatDeltaPercentPoints(item.nimDelta4Q, 2) : "—"}</TableCell>
                )}
                {showEarningsColumns && (
                  <TableCell>
                    {item.earningsBufferPct != null ? formatPercentMetric(item.earningsBufferPct, 1) : "—"}
                  </TableCell>
                )}
                <TableCell>{formatCurrency(item.totalUnusedCommitments)}</TableCell>
                <TableCell>{formatCurrency(item.creUnusedCommitments)}</TableCell>
                <TableCell>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      Construction:{" "}
                      {formatPercent(
                        item.creLoans ? ((item.constructionLoans || 0) / item.creLoans) * 100 : undefined
                      )}
                    </div>
                    <div>
                      Multifamily:{" "}
                      {formatPercent(
                        item.creLoans ? ((item.multifamilyLoans || 0) / item.creLoans) * 100 : undefined
                      )}
                    </div>
                    <div>
                      Non-Res:{" "}
                      {formatPercent(
                        item.creLoans ? ((item.nonResidentialLoans || 0) / item.creLoans) * 100 : undefined
                      )}
                    </div>
                    <div>
                      Other:{" "}
                      {formatPercent(
                        item.creLoans ? ((item.otherRealEstateLoans || 0) / item.creLoans) * 100 : undefined
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {item.trend.map((entry) => (
                      <div key={`cre-${item.id}-${entry.reportDate}`}>
                        {formatQuarter(entry.reportDate)}: {formatPercent(entry.creConcentration)}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {item.trend.map((entry) => (
                      <div key={`npl-${item.id}-${entry.reportDate}`}>
                        {formatQuarter(entry.reportDate)}: {formatPercent((entry.nplRatio ?? 0) * 100)}
                      </div>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-4 text-sm text-slate-600 leading-relaxed">
          This table focuses on NPL in dollar value and CRE loans relative to total loans. Click a row to view the institution profile. Use the 4-quarter CRE and NPL trend columns to spot deteriorating credit. Export via Download Report for offline analysis.
        </p>
      </Card>

      {!reportMode && (
        <InstitutionProfileDrawer
          row={selectedInstitution}
          cohort={screeningTable}
          asOfQuarter={asOfQuarter}
          onClose={() => {
            setSelectedInstitution(null)
            setCompareRows([])
          }}
          compareRows={compareRows}
          onAddToCompare={(row) => {
            const key = `${row.id}-${row.reportDate ?? ""}`
            if (compareRows.some((r) => `${r.id}-${r.reportDate ?? ""}` === key)) return
            setCompareRows((prev) => [...prev, row].slice(-10))
          }}
          onRemoveFromCompare={(id, reportDate) => {
            const next = compareRows.filter((r) => !(r.id === id && (r.reportDate ?? "") === (reportDate ?? "")))
            setCompareRows(next)
            if (next.length === 0) setSelectedInstitution(null)
          }}
          onClearCompare={() => setCompareRows([])}
        />
      )}
      {!reportMode && <MarketResearch level={level} />}

    </div>
  )
}
