"use client"

import { useMemo } from "react"
import { Card } from "@/components/ui/card"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DefTerm } from "@/components/def-term"
import type { CapitalRatios } from "@/lib/fdic-ratio-helpers"
import { getVulnerabilityFillHex, getCreCapitalColor } from "@/lib/score-colors"
import { formatCapitalMultiple } from "@/lib/format/metrics"

type ScreeningRow = {
  id: string
  name: string
  state?: string
  totalAssets: number
  creLoans?: number
  constructionLoans?: number
  multifamilyLoans?: number
  nonResidentialLoans?: number
  otherRealEstateLoans?: number
  creConcentration?: number
  nplRatio?: number
  vulnerabilityScore?: number
  capitalRatios?: CapitalRatios
}

type CapitalAnalyticsVizProps = {
  screeningTable: ScreeningRow[]
  scope: "national" | string
  formatCurrency: (n?: number) => string
  formatPercent: (n?: number) => string
  formatRatio: (n?: number | null) => string
  formatNumber: (n?: number) => string
}

const CHART_COLORS = {
  barDefault: "#475569",
  barTop5: "#1e293b",
  construction: "#64748b",
  multifamily: "#475569",
  nonResidential: "#334155",
  otherCre: "#94a3b8",
}

function getCreToCapitalValue(row: ScreeningRow): { value: number; useFallback: boolean } {
  const creToCap = row.capitalRatios?.creToTier1Tier2
  const hasCapital = row.capitalRatios?.coverage.hasTier1Tier2
  if (hasCapital && creToCap != null && creToCap > 0) {
    return { value: creToCap * 100, useFallback: false }
  }
  const creToAssets = row.creConcentration ?? 0
  return { value: creToAssets, useFallback: true }
}

export function CapitalAnalyticsViz({
  screeningTable,
  scope,
  formatCurrency,
  formatPercent,
  formatRatio,
  formatNumber,
}: CapitalAnalyticsVizProps) {
  const creToCapitalRanking = useMemo(() => {
    return screeningTable
      .map((row) => {
        const { value, useFallback } = getCreToCapitalValue(row)
        return {
          id: row.id,
          name: row.name,
          value,
          useFallback,
        }
      })
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 20)
      .map((r, i) => ({ ...r, rank: i + 1 }))
  }, [screeningTable])

  const scatterData = useMemo(() => {
    const withBoth = screeningTable.filter((row) => {
      const creToAssets = row.creConcentration ?? 0
      const creToCap = row.capitalRatios?.creToTier1Tier2
      const hasCap = row.capitalRatios?.coverage.hasTier1Tier2
      return creToAssets > 0 && hasCap && creToCap != null && creToCap > 0
    })
    const creToAssets = withBoth.map((r) => r.creConcentration ?? 0)
    const creToCap = withBoth.map((r) => (r.capitalRatios!.creToTier1Tier2 ?? 0) * 100)
    const medianCreToAssets = creToAssets.length > 0
      ? [...creToAssets].sort((a, b) => a - b)[Math.floor(creToAssets.length / 2)]
      : 0
    const medianCreToCap = creToCap.length > 0
      ? [...creToCap].sort((a, b) => a - b)[Math.floor(creToCap.length / 2)]
      : 0
    const minAssets = Math.min(...withBoth.map((r) => r.totalAssets).filter((a) => a > 0))
    const maxAssets = Math.max(...withBoth.map((r) => r.totalAssets))
    const logMin = Math.log10(Math.max(1, minAssets))
    const logMax = Math.log10(Math.max(1, maxAssets))
    return {
      points: withBoth.map((row) => ({
        name: row.name,
        creToAssets: row.creConcentration ?? 0,
        creToCap: (row.capitalRatios?.creToTier1Tier2 ?? 0) * 100,
        totalAssets: row.totalAssets,
        bubbleSize: (Math.log10(Math.max(1, row.totalAssets)) - logMin) / (logMax - logMin || 1) * 20 + 5,
        vulnerabilityScore: row.vulnerabilityScore ?? 0,
      })),
      medianCreToAssets,
      medianCreToCap,
    }
  }, [screeningTable])

  const exposureMixData = useMemo(() => {
    const ranked = screeningTable
      .filter((r) => r.capitalRatios?.creToTier1Tier2 != null && r.capitalRatios!.creToTier1Tier2! > 0)
      .sort((a, b) => (b.capitalRatios!.creToTier1Tier2 ?? 0) - (a.capitalRatios!.creToTier1Tier2 ?? 0))
      .slice(0, 15)
    return ranked.map((row) => {
      const cre = row.creLoans ?? 0
      const construction = cre > 0 ? ((row.constructionLoans ?? 0) / cre) * 100 : 0
      const multifamily = cre > 0 ? ((row.multifamilyLoans ?? 0) / cre) * 100 : 0
      const nonResidential = cre > 0 ? ((row.nonResidentialLoans ?? 0) / cre) * 100 : 0
      const other = cre > 0 ? ((row.otherRealEstateLoans ?? 0) / cre) * 100 : 0
      return {
        name: row.name,
        construction,
        multifamily,
        nonResidential,
        otherCre: other,
      }
    })
  }, [screeningTable])

  const stateOverview = useMemo(() => {
    if (scope !== "national") return []
    const byState = new Map<
      string,
      { totalAssets: number; creLoans: number; nplSum: number; nplWeight: number; creToCapSum: number; creToCapWeight: number; count: number }
    >()
    screeningTable.forEach((row) => {
      const state = row.state || "Unknown"
      const existing = byState.get(state) ?? {
        totalAssets: 0, creLoans: 0, nplSum: 0, nplWeight: 0, creToCapSum: 0, creToCapWeight: 0, count: 0,
      }
      existing.totalAssets += row.totalAssets
      existing.creLoans += row.creLoans ?? 0
      existing.count += 1
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
        bankCount: data.count,
        weightedAvgCreToAssets: data.totalAssets > 0 ? (data.creLoans / data.totalAssets) * 100 : null,
        weightedAvgCreToCap: data.creToCapWeight > 0 ? data.creToCapSum / data.creToCapWeight : null,
        weightedAvgNpl: data.nplWeight > 0 ? data.nplSum / data.nplWeight : null,
      }))
      .sort((a, b) => (b.weightedAvgCreToCap ?? 0) - (a.weightedAvgCreToCap ?? 0))
  }, [screeningTable, scope])

  if (screeningTable.length === 0) return null

  const xAxisLabelCreRanking = creToCapitalRanking[0]?.useFallback ? "CRE / Assets (%)" : "CRE / (Tier1 + Tier2) (%)"

  return (
    <div className="space-y-8">
      {/* 1. CRE-to-Capital Ranking Ladder */}
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h4 className="font-serif text-base font-semibold text-slate-800">CRE-to-Capital Exposure Ranking</h4>
        <p className="text-xs text-slate-600 mt-1">Top 20 institutions by capital-adjusted CRE concentration</p>
        {creToCapitalRanking.length > 0 ? (
        <div className="mt-4 h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={creToCapitalRanking}
              layout="vertical"
              margin={{ top: 8, right: 48, bottom: 24, left: 140 }}
              barCategoryGap={4}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={{ stroke: "#94a3b8" }}
                tickLine={false}
                label={{ value: xAxisLabelCreRanking, position: "bottom", fontSize: 10, fill: "#64748b" }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fontSize: 10, fill: "#334155", fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(name, index) => {
                  const rank = index + 1
                  const n = String(name)
                  const truncated = n.length > 24 ? `${n.slice(0, 22)}…` : n
                  return `${rank}. ${truncated}`
                }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const p = payload[0].payload
                  return (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm text-sm">
                      <p className="font-medium text-slate-800">{p.name}</p>
                      <p className="text-slate-600">
                        {p.useFallback ? "CRE / Assets" : "CRE / (T1+T2)"}: {p.value.toFixed(1)}%
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="value" radius={[0, 2, 2, 0]} maxBarSize={14}>
                <LabelList dataKey="value" position="right" formatter={(v: number) => `${v.toFixed(1)}%`} style={{ fontSize: 9, fill: "#475569" }} />
                {creToCapitalRanking.map((_, index) => (
                  <Cell key={index} fill={index < 5 ? CHART_COLORS.barTop5 : CHART_COLORS.barDefault} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No institutions with CRE or capital data available.</p>
        )}
        <p className="text-xs text-slate-600 mt-4 leading-relaxed">
          The highest-ranked institutions exhibit CRE exposure materially in excess of regulatory capital buffers, indicating elevated sensitivity to asset quality deterioration.
        </p>
      </Card>

      {/* 2. Capital Sensitivity Matrix */}
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h4 className="font-serif text-base font-semibold text-slate-800">Capital Sensitivity Matrix</h4>
        <p className="text-xs text-slate-600 mt-1">CRE exposure relative to assets and regulatory capital</p>
        <div className="mt-4 h-[380px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                dataKey="creToAssets"
                name="CRE / Assets (%)"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={{ stroke: "#94a3b8" }}
                tickLine={false}
                label={{ value: "CRE / Assets (%)", position: "bottom", fontSize: 10, fill: "#64748b" }}
              />
              <YAxis
                type="number"
                dataKey="creToCap"
                name="CRE / (Tier1 + Tier2) (%)"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={{ stroke: "#94a3b8" }}
                tickLine={false}
                label={{ value: "CRE / (Tier1 + Tier2) (%)", angle: -90, position: "insideLeft", fontSize: 10, fill: "#64748b" }}
              />
              <ReferenceLine x={scatterData.medianCreToAssets} stroke="#94a3b8" strokeDasharray="4 4" />
              <ReferenceLine y={scatterData.medianCreToCap} stroke="#94a3b8" strokeDasharray="4 4" />
              <Scatter
                data={scatterData.points}
                fillOpacity={0.75}
                shape={(props) => {
                  const { cx, cy, payload } = props
                  const r = payload.bubbleSize ?? 6
                  const fill = getVulnerabilityFillHex(payload.vulnerabilityScore ?? 0)
                  return <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.75} stroke="#475569" strokeWidth={1} />
                }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const p = payload[0].payload
                  return (
                    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                      <p className="font-medium text-slate-800">{p.name}</p>
                      <p>CRE/Assets: {p.creToAssets.toFixed(1)}%</p>
                      <p>CRE/Capital: {formatCapitalMultiple(p.creToCap / 100)}</p>
                      <p className="text-[10px] text-slate-500">(= {p.creToCap.toFixed(0)}% of Tier 1 + Tier 2 capital)</p>
                      <p>Vulnerability: {p.vulnerabilityScore?.toFixed(1) ?? "—"}</p>
                      <p>Assets: {formatCurrency(p.totalAssets)}</p>
                    </div>
                  )
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] text-slate-600">
          <span className="font-medium text-slate-700">Composite Vulnerability Score:</span>
          {[
            { range: "0–30", label: "Low", fill: "#e2e8f0" },
            { range: "30–50", label: "Moderate", fill: "#fcd34d" },
            { range: "50–70", label: "Elevated", fill: "#fb923c" },
            { range: "70–85", label: "High", fill: "#f87171" },
            { range: "85–100", label: "Very High", fill: "#dc2626" },
          ].map(({ range, label, fill }) => (
            <span key={range} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full border border-slate-300"
                style={{ backgroundColor: fill }}
              />
              {range} ({label})
            </span>
          ))}
          <span className="text-slate-500">·</span>
          <span>Bubble size = Total assets</span>
          <span className="text-slate-500">·</span>
          <span>Dashed lines = Median CRE/Assets & CRE/Capital</span>
        </div>
        <p className="text-xs text-slate-600 mt-4 leading-relaxed">
          Institutions in the upper-right quadrant reflect elevated balance sheet concentration combined with capital sensitivity, representing the primary screening cohort.
        </p>
      </Card>

      {/* 3. Exposure Mix Stacked Bar */}
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h4 className="font-serif text-base font-semibold text-slate-800">CRE Portfolio Composition — Top Capital-Exposed Institutions</h4>
        <p className="text-xs text-slate-600 mt-1">Breakdown of CRE exposure by asset type</p>
        <div className="mt-4 h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={exposureMixData}
              layout="vertical"
              margin={{ top: 8, right: 24, bottom: 24, left: 120 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#94a3b8" }} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" width={115} tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
              <Bar dataKey="construction" stackId="a" fill={CHART_COLORS.construction} radius={[0, 0, 0, 0]} />
              <Bar dataKey="multifamily" stackId="a" fill={CHART_COLORS.multifamily} radius={[0, 0, 0, 0]} />
              <Bar dataKey="nonResidential" stackId="a" fill={CHART_COLORS.nonResidential} radius={[0, 0, 0, 0]} />
              <Bar dataKey="otherCre" stackId="a" fill={CHART_COLORS.otherCre} radius={[0, 2, 2, 0]} />
              <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v) => v === "otherCre" ? "Other CRE" : v.charAt(0).toUpperCase() + v.slice(1)} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-slate-600 mt-4 leading-relaxed">
          Construction and multifamily exposures represent the primary concentration drivers within the highest capital-sensitive institutions.
        </p>
      </Card>

      {/* 4. State-Level Capital Sensitivity Overview (National only) */}
      {scope === "national" && stateOverview.length > 0 && (
        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <h4 className="font-serif text-base font-semibold text-slate-800">State-Level Capital Sensitivity Overview</h4>
          <p className="text-xs text-slate-600 mt-1">Weighted averages by state (FDIC cohort)</p>
          <div className="mt-4 overflow-x-auto">
            <Table stickyHeaders>
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="font-medium text-slate-700"><DefTerm term="State">State</DefTerm></TableHead>
                  <TableHead className="text-right font-medium text-slate-700"><DefTerm term="Total Assets">Total Assets</DefTerm></TableHead>
                  <TableHead className="text-right font-medium text-slate-700"><DefTerm term="Total CRE Loans">Total CRE Loans</DefTerm></TableHead>
                  <TableHead className="text-right font-medium text-slate-700"><DefTerm term="Weighted Avg CRE / Assets">Weighted Avg CRE / Assets</DefTerm></TableHead>
                  <TableHead className="text-right font-medium text-slate-700"><DefTerm term="Weighted Avg CRE / Capital">Weighted Avg CRE / Capital</DefTerm></TableHead>
                  <TableHead className="text-right font-medium text-slate-700"><DefTerm term="Weighted Avg NPL">Weighted Avg NPL</DefTerm></TableHead>
                  <TableHead className="text-right font-medium text-slate-700"><DefTerm term="Bank Count">Bank Count</DefTerm></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stateOverview.map((row) => (
                    <TableRow key={row.state} className="border-slate-100">
                      <TableCell className="font-medium text-slate-800">{row.state}</TableCell>
                      <TableCell className="text-right text-slate-700">{formatCurrency(row.totalAssets)}</TableCell>
                      <TableCell className="text-right text-slate-700">{formatCurrency(row.creLoans)}</TableCell>
                      <TableCell className="text-right text-slate-700">{row.weightedAvgCreToAssets != null ? formatPercent(row.weightedAvgCreToAssets) : "—"}</TableCell>
                      <TableCell
                        className={`text-right font-medium text-slate-800 ${getCreCapitalColor(row.weightedAvgCreToCap ?? undefined)}`}
                      >
                        {row.weightedAvgCreToCap != null ? formatRatio(row.weightedAvgCreToCap) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-slate-700">{row.weightedAvgNpl != null ? formatPercent((row.weightedAvgNpl as number) * 100) : "—"}</TableCell>
                      <TableCell className="text-right text-slate-700">{formatNumber(row.bankCount)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-slate-600 mt-4 leading-relaxed">
            Capital-adjusted CRE concentration varies materially by state, indicating localized stress concentrations rather than uniform national exposure.
          </p>
        </Card>
      )}
    </div>
  )
}
