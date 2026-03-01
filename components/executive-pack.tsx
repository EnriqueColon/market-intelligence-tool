"use client"

import { useMemo } from "react"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DefTerm } from "@/components/def-term"
import { getScoreColor, getCreCapitalColor } from "@/lib/score-colors"

type RegionKey = string

type ScreeningRow = {
  id: string
  name: string
  city?: string
  state?: string
  totalAssets: number
  creLoans?: number
  constructionLoans?: number
  multifamilyLoans?: number
  nonResidentialLoans?: number
  otherRealEstateLoans?: number
  totalUnusedCommitments?: number
  creUnusedCommitments?: number
  creConcentration?: number
  nplRatio?: number
  opportunityScore: number
  vulnerabilityScore?: number
  capitalRatios?: {
    creToTier1Tier2: number | null
    creToEquity: number | null
    tier1PlusTier2Capital: number | null
    constructionToTier1Tier2?: number | null
    multifamilyToTier1Tier2?: number | null
    coverage: { hasTier1Tier2: boolean }
  }
}

type ExecutivePackProps = {
  screeningTable: ScreeningRow[]
  filtersRegion: RegionKey
  formatCurrency: (n?: number) => string
  formatPercent: (n?: number) => string
  formatNumber: (n?: number) => string
  formatRatio: (n?: number | null) => string
  /** When provided, rows in Top 25 tables become clickable to open institution profile drawer */
  onRowClick?: (row: ScreeningRow) => void
}

export function ExecutivePack({
  screeningTable,
  filtersRegion,
  formatCurrency,
  formatPercent,
  formatNumber,
  formatRatio,
  onRowClick,
}: ExecutivePackProps) {
  const summaryByState = useMemo(() => {
    if (filtersRegion !== "national") return []
    const byState = new Map<
      string,
      { totalAssets: number; creLoans: number; constructionLoans: number; multifamilyLoans: number; nonResidentialLoans: number; otherRealEstateLoans: number; totalUnusedCommitments: number; creUnusedCommitments: number; nplSum: number; nplWeight: number; creToCapSum: number; creToCapWeight: number; count: number }
    >()
    screeningTable.forEach((row) => {
      const state = row.state || "Unknown"
      const existing = byState.get(state) ?? {
        totalAssets: 0,
        creLoans: 0,
        constructionLoans: 0,
        multifamilyLoans: 0,
        nonResidentialLoans: 0,
        otherRealEstateLoans: 0,
        totalUnusedCommitments: 0,
        creUnusedCommitments: 0,
        nplSum: 0,
        nplWeight: 0,
        creToCapSum: 0,
        creToCapWeight: 0,
        count: 0,
      }
      existing.totalAssets += row.totalAssets
      existing.creLoans += row.creLoans ?? 0
      existing.constructionLoans += row.constructionLoans ?? 0
      existing.multifamilyLoans += row.multifamilyLoans ?? 0
      existing.nonResidentialLoans += row.nonResidentialLoans ?? 0
      existing.otherRealEstateLoans += row.otherRealEstateLoans ?? 0
      existing.totalUnusedCommitments += row.totalUnusedCommitments ?? 0
      existing.creUnusedCommitments += row.creUnusedCommitments ?? 0
      existing.count += 1
      const cre = row.creLoans ?? 0
      const npl = row.nplRatio ?? 0
      existing.nplSum += npl * row.totalAssets
      existing.nplWeight += row.totalAssets
      const cr = row.capitalRatios?.creToTier1Tier2
      if (cr != null && row.capitalRatios?.coverage.hasTier1Tier2) {
        existing.creToCapSum += cr * row.totalAssets
        existing.creToCapWeight += row.totalAssets
      }
      byState.set(state, existing)
    })
    return Array.from(byState.entries())
      .map(([state, data]) => ({
        state,
        totalAssets: data.totalAssets,
        creLoans: data.creLoans,
        constructionLoans: data.constructionLoans,
        multifamilyLoans: data.multifamilyLoans,
        nonResidentialLoans: data.nonResidentialLoans,
        otherRealEstateLoans: data.otherRealEstateLoans,
        totalUnusedCommitments: data.totalUnusedCommitments,
        creUnusedCommitments: data.creUnusedCommitments,
        bankCount: data.count,
        weightedAvgCreToAssets: data.totalAssets > 0 ? (data.creLoans / data.totalAssets) * 100 : null,
        weightedAvgCreToCap: data.creToCapWeight > 0 ? data.creToCapSum / data.creToCapWeight : null,
        weightedAvgNpl: data.nplWeight > 0 ? data.nplSum / data.nplWeight : null,
      }))
      .sort((a, b) => a.state.localeCompare(b.state))
  }, [screeningTable, filtersRegion])

  const coveragePct = useMemo(() => {
    const withCap = screeningTable.filter((r) => r.capitalRatios?.coverage.hasTier1Tier2).length
    return screeningTable.length > 0 ? Math.round((withCap / screeningTable.length) * 100) : 0
  }, [screeningTable])

  const topByCreToCapital = useMemo(() => {
    return screeningTable
      .filter((r) => r.capitalRatios?.creToTier1Tier2 != null && r.capitalRatios!.creToTier1Tier2! > 0)
      .sort((a, b) => (b.capitalRatios!.creToTier1Tier2 ?? 0) - (a.capitalRatios!.creToTier1Tier2 ?? 0))
      .slice(0, 25)
  }, [screeningTable])

  const topByOpportunityScore = useMemo(() => {
    return [...screeningTable].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 25)
  }, [screeningTable])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <h3 className="text-base font-semibold text-slate-800 mb-1">Executive Pack</h3>
      <p className="text-xs text-slate-600 mb-2">
        Tier1+Tier2 capital available for {coveragePct}% of institutions in this view.
      </p>
      <p className="text-sm text-slate-600 leading-relaxed mb-6">
        The Executive Pack consolidates state-level aggregates and top-ranked institutions by opportunity score and CRE-to-capital ratio. Use these tables to prioritize screening and understand regional exposure patterns.
      </p>

      {filtersRegion === "national" && summaryByState.length > 0 && (
        <div className="mb-8">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Summary by State</h4>
          <p className="text-xs text-slate-600 mb-3">
            Aggregated CRE exposure and credit metrics by state. Use this table to compare regional concentration and identify states with elevated CRE-to-capital ratios or higher NPL levels.
          </p>
          <Table stickyHeaders>
            <TableHeader>
              <TableRow>
                <TableHead><DefTerm term="State">State</DefTerm></TableHead>
                <TableHead><DefTerm term="Bank Count">Bank Count</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Assets">Total Assets</DefTerm></TableHead>
                <TableHead><DefTerm term="Total CRE Loans">Total CRE Loans</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Construction">Total Construction</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Multifamily">Total Multifamily</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Non-Residential">Total Non-Residential</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Other Real Estate">Total Other Real Estate</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Unused Commitments">Total UC</DefTerm></TableHead>
                <TableHead><DefTerm term="Unused Commitments (CRE)">CRE UC</DefTerm></TableHead>
                <TableHead><DefTerm term="Weighted Avg CRE / Assets">Weighted Avg CRE / Assets</DefTerm></TableHead>
                <TableHead><DefTerm term="Weighted Avg CRE / (T1+T2)">Weighted Avg CRE / (T1+T2)</DefTerm></TableHead>
                <TableHead><DefTerm term="Weighted Avg NPL">Weighted Avg NPL</DefTerm></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryByState.map((row) => (
                <TableRow key={row.state}>
                  <TableCell>{row.state}</TableCell>
                  <TableCell>{formatNumber(row.bankCount)}</TableCell>
                  <TableCell>{formatCurrency(row.totalAssets)}</TableCell>
                  <TableCell>{formatCurrency(row.creLoans)}</TableCell>
                  <TableCell>{formatCurrency(row.constructionLoans)}</TableCell>
                  <TableCell>{formatCurrency(row.multifamilyLoans)}</TableCell>
                  <TableCell>{formatCurrency(row.nonResidentialLoans)}</TableCell>
                  <TableCell>{formatCurrency(row.otherRealEstateLoans)}</TableCell>
                  <TableCell>{formatCurrency(row.totalUnusedCommitments)}</TableCell>
                  <TableCell>{formatCurrency(row.creUnusedCommitments)}</TableCell>
                  <TableCell>{row.weightedAvgCreToAssets != null ? formatPercent(row.weightedAvgCreToAssets) : "—"}</TableCell>
                  <TableCell>{row.weightedAvgCreToCap != null ? formatRatio(row.weightedAvgCreToCap) : "—"}</TableCell>
                  <TableCell>{row.weightedAvgNpl != null ? formatPercent((row.weightedAvgNpl as number) * 100) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-slate-600 leading-relaxed mt-4">
            Weighted averages give larger institutions proportionally more influence, reflecting market concentration. States with high CRE/(T1+T2) and rising NPL warrant closer monitoring for distressed debt opportunities.
          </p>
        </div>
      )}

      <div className="space-y-8">
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Top 25 by Opportunity Score</h4>
          <p className="text-xs text-slate-600 mb-3">
            Institutions ranked by Structural Opportunity Score—a weighted combination of CRE concentration (35%), NPL from noncurrent-to-loans (35%), reserve coverage (15%), and capital strength (15%).
          </p>
          <Table stickyHeaders>
            <TableHeader>
              <TableRow>
                <TableHead><DefTerm term="Bank">Bank</DefTerm></TableHead>
                <TableHead><DefTerm term="City">City</DefTerm></TableHead>
                <TableHead><DefTerm term="State">State</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Assets">Total Assets</DefTerm></TableHead>
                <TableHead><DefTerm term="Total CRE Loans">CRE Loans</DefTerm></TableHead>
                <TableHead><DefTerm term="CRE/(T1+T2)">CRE/(T1+T2)</DefTerm></TableHead>
                <TableHead><DefTerm term="CRE / Assets">CRE/Assets</DefTerm></TableHead>
                <TableHead><DefTerm term="NPL">NPL</DefTerm></TableHead>
                <TableHead><DefTerm term="Score">Score</DefTerm></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topByOpportunityScore.map((row) => (
                <TableRow
                  key={row.id}
                  data-clickable-row={onRowClick ? "" : undefined}
                  className={onRowClick ? "cursor-pointer hover:bg-slate-100/80" : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.city ?? "—"}</TableCell>
                  <TableCell>{row.state ?? "—"}</TableCell>
                  <TableCell>{formatCurrency(row.totalAssets)}</TableCell>
                  <TableCell>{formatCurrency(row.creLoans)}</TableCell>
                  <TableCell className={getCreCapitalColor(row.capitalRatios?.creToTier1Tier2 ?? undefined)}>{formatRatio(row.capitalRatios?.creToTier1Tier2)}</TableCell>
                  <TableCell>{formatPercent(row.creConcentration)}</TableCell>
                  <TableCell>{formatPercent((row.nplRatio ?? 0) * 100)}</TableCell>
                  <TableCell className={getScoreColor(row.opportunityScore, "structural")}>{formatNumber(row.opportunityScore)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-slate-600 leading-relaxed mt-4">
            Higher scores indicate elevated CRE exposure combined with credit stress. These institutions are prime candidates for distressed debt screening—verify deal relevance from primary filings and loan-level data.
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Top 25 by CRE / (Tier1 + Tier2)</h4>
          <p className="text-xs text-slate-600 mb-3">
            Banks whose commercial real estate loans most exceed regulatory capital buffers. Ratios above 3x–4x typically warrant heightened attention; those above 5x–6x indicate material capital sensitivity to CRE losses.
          </p>
          <Table stickyHeaders>
            <TableHeader>
              <TableRow>
                <TableHead><DefTerm term="Bank">Bank</DefTerm></TableHead>
                <TableHead><DefTerm term="City">City</DefTerm></TableHead>
                <TableHead><DefTerm term="State">State</DefTerm></TableHead>
                <TableHead><DefTerm term="Total Assets">Total Assets</DefTerm></TableHead>
                <TableHead><DefTerm term="Total CRE Loans">CRE Loans</DefTerm></TableHead>
                <TableHead><DefTerm term="T1+T2">T1+T2</DefTerm></TableHead>
                <TableHead><DefTerm term="CRE / (T1+T2)">CRE/(T1+T2)</DefTerm></TableHead>
                <TableHead><DefTerm term="CRE / Assets">CRE/Assets</DefTerm></TableHead>
                <TableHead><DefTerm term="NPL Ratio">NPL</DefTerm></TableHead>
                <TableHead><DefTerm term="Score">Score</DefTerm></TableHead>
                <TableHead><DefTerm term="Composite Vulnerability Score">Composite Vulnerability</DefTerm></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topByCreToCapital.map((row) => (
                <TableRow
                  key={row.id}
                  data-clickable-row={onRowClick ? "" : undefined}
                  className={onRowClick ? "cursor-pointer hover:bg-slate-100/80" : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.city ?? "—"}</TableCell>
                  <TableCell>{row.state ?? "—"}</TableCell>
                  <TableCell>{formatCurrency(row.totalAssets)}</TableCell>
                  <TableCell>{formatCurrency(row.creLoans)}</TableCell>
                  <TableCell>{formatCurrency(row.capitalRatios?.tier1PlusTier2Capital ?? undefined)}</TableCell>
                  <TableCell className={getCreCapitalColor(row.capitalRatios?.creToTier1Tier2 ?? undefined)}>{formatRatio(row.capitalRatios?.creToTier1Tier2)}</TableCell>
                  <TableCell>{formatPercent(row.creConcentration)}</TableCell>
                  <TableCell>{formatPercent((row.nplRatio ?? 0) * 100)}</TableCell>
                  <TableCell className={getScoreColor(row.opportunityScore, "structural")}>{formatNumber(row.opportunityScore)}</TableCell>
                  <TableCell className={row.vulnerabilityScore != null ? getScoreColor(row.vulnerabilityScore, "vulnerability") : ""}>{row.vulnerabilityScore != null ? row.vulnerabilityScore.toFixed(1) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {topByCreToCapital.length === 0 && (
            <p className="text-sm text-slate-600 py-4">No banks with capital data available.</p>
          )}
          <p className="text-sm text-slate-600 leading-relaxed mt-4">
            Institutions appearing in both this table and Top 25 by Opportunity Score represent the highest-priority screening cohort—elevated capital sensitivity combined with structural and earnings risk.
          </p>
        </div>
      </div>
    </Card>
  )
}
