"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  computeDispersionStats,
  getHistogramData,
} from "@/lib/opportunity-score-dispersion"
import type { ReportData } from "@/app/actions/build-report-data"
import { DefTerm } from "@/components/def-term"
import { ReportInterpretationBlock } from "@/components/report-interpretation-block"
import { getScoreColor, getCreCapitalColor, getVulnerabilityFillHex } from "@/lib/score-colors"
import { formatCapitalMultiple, formatMultiple as formatMultipleMetric } from "@/lib/format/metrics"

const REPORT_FONT = { fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "11pt" }
const SECTION_CLASS = "break-inside-avoid mb-10"

function formatCurrency(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}
function formatPercent(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100)
}
function formatNumber(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US").format(value)
}
function formatRatio(value: number | null | undefined) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return formatMultipleMetric(value)
}

export function MarketAnalyticsReportView({ data }: { data: ReportData }) {
  const { scope, asOfQuarter, kpis, dispersionStats, dispersionNarrative, capitalKpis, rows, topByCreToCapital, topByOpportunityScore, summaryByState } = data
  const scores = useMemo(() => rows.map((r) => r.opportunityScore), [rows])
  const histogramData = useMemo(() => getHistogramData(scores), [scores])

  const creToCapitalRanking = useMemo(() => {
    return rows
      .map((r) => {
        const creToCap = r.capitalRatios?.creToTier1Tier2
        const hasCap = r.capitalRatios?.coverage.hasTier1Tier2
        const value = hasCap && creToCap != null && creToCap > 0 ? creToCap * 100 : (r.creConcentration ?? 0)
        return { id: r.id, name: r.name, value }
      })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 20)
      .map((r, i) => ({ ...r, rank: i + 1 }))
  }, [rows])

  const exposureMixData = useMemo(() => {
    const ranked = rows
      .filter((r) => r.capitalRatios?.creToTier1Tier2 != null && r.capitalRatios!.creToTier1Tier2! > 0)
      .sort((a, b) => (b.capitalRatios!.creToTier1Tier2 ?? 0) - (a.capitalRatios!.creToTier1Tier2 ?? 0))
      .slice(0, 15)
    return ranked.map((r) => {
      const cre = r.creLoans ?? 0
      const construction = cre > 0 ? ((r.constructionLoans ?? 0) / cre) * 100 : 0
      const multifamily = cre > 0 ? ((r.multifamilyLoans ?? 0) / cre) * 100 : 0
      const nonResidential = cre > 0 ? ((r.nonResidentialLoans ?? 0) / cre) * 100 : 0
      const other = cre > 0 ? ((r.otherRealEstateLoans ?? 0) / cre) * 100 : 0
      return { name: r.name, construction, multifamily, nonResidential, otherCre: other }
    })
  }, [rows])

  const scatterData = useMemo(() => {
    const withBoth = rows.filter((r) => {
      const creToAssets = r.creConcentration ?? 0
      const creToCap = r.capitalRatios?.creToTier1Tier2
      const hasCap = r.capitalRatios?.coverage.hasTier1Tier2
      return creToAssets > 0 && hasCap && creToCap != null && creToCap > 0
    })
    const creToAssetsArr = withBoth.map((r) => r.creConcentration ?? 0)
    const creToCapArr = withBoth.map((r) => (r.capitalRatios!.creToTier1Tier2 ?? 0) * 100)
    const medianCreToAssets = creToAssetsArr.length > 0
      ? [...creToAssetsArr].sort((a, b) => a - b)[Math.floor(creToAssetsArr.length / 2)]
      : 0
    const medianCreToCap = creToCapArr.length > 0
      ? [...creToCapArr].sort((a, b) => a - b)[Math.floor(creToCapArr.length / 2)]
      : 0
    const assetsArr = withBoth.map((r) => r.totalAssets).filter((a) => a > 0)
    const minAssets = assetsArr.length > 0 ? Math.min(...assetsArr) : 1
    const maxAssets = withBoth.length > 0 ? Math.max(...withBoth.map((r) => r.totalAssets), 1) : 1
    const logMin = Math.log10(Math.max(1, minAssets))
    const logMax = Math.log10(Math.max(1, maxAssets))
    return {
      points: withBoth.map((r) => ({
        name: r.name,
        creToAssets: r.creConcentration ?? 0,
        creToCap: (r.capitalRatios?.creToTier1Tier2 ?? 0) * 100,
        totalAssets: r.totalAssets,
        bubbleSize: (Math.log10(Math.max(1, r.totalAssets)) - logMin) / (logMax - logMin || 1) * 12 + 4,
        vulnerabilityScore: r.vulnerabilityScore ?? 0,
      })),
      medianCreToAssets,
      medianCreToCap,
    }
  }, [rows])

  return (
    <div className="space-y-10 text-slate-800" style={REPORT_FONT}>
      {/* Executive Summary */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Executive Summary</h2>
        <p className="text-slate-700 mb-4 leading-relaxed">
          {dispersionNarrative.headerBlurb}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="border-b border-slate-200 pb-2">
              <p className="text-xs font-medium text-slate-600 uppercase">{kpi.label}</p>
              <p className="text-base font-semibold text-slate-900">{kpi.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Opportunity Score Distribution */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Opportunity Score Distribution</h2>
        <p className="text-slate-700 mb-2 leading-relaxed">{dispersionNarrative.headerBlurb}</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> The histogram reveals where institutions cluster by structural CRE exposure and credit stress. Institutions in the upper score bands (70+) represent the primary screening cohort with elevated concentration and asset-quality sensitivity.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div><p className="text-xs text-slate-600">Median</p><p className="font-semibold">{dispersionStats.p50.toFixed(1)}</p></div>
          <div><p className="text-xs text-slate-600">P90</p><p className="font-semibold">{dispersionStats.p90.toFixed(1)}</p></div>
          <div><p className="text-xs text-slate-600">IQR</p><p className="font-semibold">{dispersionStats.p25.toFixed(1)}–{dispersionStats.p75.toFixed(1)}</p></div>
          <div><p className="text-xs text-slate-600">≥80</p><p className="font-semibold">{Math.round(dispersionStats.share_ge_80)}%</p></div>
        </div>
        <div className="h-[200px] min-h-[200px] w-full mb-4">
          <ResponsiveContainer width="100%" height={200} debounce={0}>
            <BarChart data={histogramData} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0].payload
                  const count = item.count ?? 0
                  return (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm text-sm">
                      <p className="font-medium text-slate-800">Score range {item.bin}</p>
                      <p className="text-slate-600">{count} {count === 1 ? "institution" : "institutions"}</p>
                    </div>
                  )
                }}
              />
              <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#94a3b8" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Bar dataKey="count" fill="#334155" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-slate-700 leading-relaxed">{dispersionNarrative.interpretation}</p>
        <ReportInterpretationBlock vizType="Opportunity Score Distribution" scope={scope} asOfQuarter={asOfQuarter} stats={{ n: dispersionStats.n, median: dispersionStats.p50, p90: dispersionStats.p90, iqr: dispersionStats.iqr, share_ge_80: dispersionStats.share_ge_80, dominant_bin: dispersionStats.dominant_bin }} enabled />
      </section>

      {/* Capital Concentration */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Capital Concentration (FDIC)</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><p className="text-xs text-slate-600">Avg CRE / (T1+T2)</p><p className="font-semibold">{capitalKpis.avgCreToTier1Tier2 != null ? formatRatio(capitalKpis.avgCreToTier1Tier2) : "—"}</p></div>
          <div><p className="text-xs text-slate-600">Avg CRE / Equity</p><p className="font-semibold">{capitalKpis.avgCreToEquity != null ? formatRatio(capitalKpis.avgCreToEquity) : "—"}</p></div>
          <div><p className="text-xs text-slate-600">Coverage %</p><p className="font-semibold">{capitalKpis.coveragePct.toFixed(1)}%</p></div>
        </div>
      </section>

      {/* CRE-to-Capital Ranking */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">CRE-to-Capital Exposure Ranking</h2>
        <p className="text-slate-600 text-sm mb-2">Top 20 institutions by capital-adjusted CRE concentration</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> Institutions at the top of this ladder have CRE exposure materially in excess of regulatory capital buffers, indicating elevated sensitivity to asset quality deterioration and potential capital stress under adverse scenarios.
        </p>
        {creToCapitalRanking.length > 0 ? (
          <div className="h-[320px] min-h-[320px] w-full mb-4">
            <ResponsiveContainer width="100%" height={320} debounce={0}>
              <BarChart data={creToCapitalRanking} layout="vertical" margin={{ top: 8, right: 48, bottom: 24, left: 140 }} barCategoryGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#94a3b8" }} tickLine={false} />
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
                        <p className="text-slate-600">CRE / (T1+T2): {p.value.toFixed(1)}%</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="value" fill="#334155" radius={[0, 2, 2, 0]} maxBarSize={14}>
                  <LabelList dataKey="value" position="right" formatter={(v: number) => `${v.toFixed(1)}%`} style={{ fontSize: 9, fill: "#475569" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-slate-600 mb-4">No institutions with CRE or capital data available.</p>
        )}
        <ReportInterpretationBlock vizType="CRE-to-Capital Ranking" scope={scope} asOfQuarter={asOfQuarter} stats={{ institutionCount: rows.length, avgCreToT1T2: capitalKpis.avgCreToTier1Tier2, avgCreToEquity: capitalKpis.avgCreToEquity }} enabled />
      </section>

      {/* Capital Sensitivity Matrix */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Capital Sensitivity Matrix</h2>
        <p className="text-slate-600 text-sm mb-2">CRE exposure relative to assets and regulatory capital. Bubble color = Composite Vulnerability Score; size = total assets.</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> Institutions in the upper-right quadrant (above median CRE/Assets and CRE/Capital) with red/orange bubbles represent the highest-priority screening cohort—elevated balance sheet concentration combined with capital sensitivity and structural vulnerability.
        </p>
        {scatterData.points.length > 0 ? (
          <div className="h-[320px] min-h-[320px] w-full mb-4">
            <ResponsiveContainer width="100%" height={320} debounce={0}>
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
                        <p>Vulnerability: {p.vulnerabilityScore?.toFixed(1) ?? "—"}</p>
                        <p>Assets: {formatCurrency(p.totalAssets)}</p>
                      </div>
                    )
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-slate-600 mb-4">No institutions with CRE and capital data available.</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500 mt-2">
          {[
            { range: "0–30", fill: "#e2e8f0" },
            { range: "30–50", fill: "#fcd34d" },
            { range: "50–70", fill: "#fb923c" },
            { range: "70–85", fill: "#f87171" },
            { range: "85–100", fill: "#dc2626" },
          ].map(({ range, fill }) => (
            <span key={range} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300" style={{ backgroundColor: fill }} />
              {range}
            </span>
          ))}
          <span>· Bubble size = Total assets · Dashed lines = Medians</span>
        </div>
        <ReportInterpretationBlock vizType="Capital Sensitivity Matrix" scope={scope} asOfQuarter={asOfQuarter} stats={{ institutionCount: scatterData.points.length, medianCreToAssets: scatterData.medianCreToAssets, medianCreToCap: scatterData.medianCreToCap }} enabled />
      </section>

      {/* CRE Portfolio Composition */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">CRE Portfolio Composition</h2>
        <p className="text-slate-600 text-sm mb-2">Top 15 capital-exposed institutions by asset type</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> Construction and multifamily exposures are the primary concentration drivers within the highest capital-sensitive institutions. A heavy construction mix indicates greater development-cycle risk; multifamily offers more stable cash flows.
        </p>
        {exposureMixData.length > 0 ? (
          <div className="h-[320px] min-h-[320px] w-full mb-4">
            <ResponsiveContainer width="100%" height={320} debounce={0}>
              <ComposedChart data={exposureMixData} layout="vertical" margin={{ top: 8, right: 24, bottom: 24, left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#94a3b8" }} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                <Bar dataKey="construction" stackId="a" fill="#64748b" />
                <Bar dataKey="multifamily" stackId="a" fill="#475569" />
                <Bar dataKey="nonResidential" stackId="a" fill="#334155" />
                <Bar dataKey="otherCre" stackId="a" fill="#94a3b8" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <ReportInterpretationBlock vizType="CRE Portfolio Composition" scope={scope} asOfQuarter={asOfQuarter} stats={{ institutionCount: exposureMixData.length }} enabled />
      </section>

      {/* State Overview (National only) */}
      {scope === "National" && summaryByState.length > 0 && (
        <section className={SECTION_CLASS}>
          <h2 className="text-lg font-bold text-slate-900 mb-4">State-Level Capital Sensitivity Overview</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-300">
                  <th className="text-left py-2 font-semibold"><DefTerm term="State">State</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Total Assets">Total Assets</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Total CRE Loans">CRE Loans</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Weighted Avg CRE / Assets">CRE/Assets</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Weighted Avg CRE / Capital">CRE/Capital</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Weighted Avg NPL">NPL</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Bank Count">Banks</DefTerm></th>
                </tr>
              </thead>
              <tbody>
                {summaryByState.slice(0, 25).map((row) => (
                  <tr key={row.state} className="border-b border-slate-200">
                    <td className="py-2 font-medium">{row.state}</td>
                    <td className="text-right py-2">{formatCurrency(row.totalAssets)}</td>
                    <td className="text-right py-2">{formatCurrency(row.creLoans)}</td>
                    <td className="text-right py-2">{row.weightedAvgCreToAssets != null ? formatPercent(row.weightedAvgCreToAssets) : "—"}</td>
                    <td className={`text-right py-2 ${getCreCapitalColor(row.weightedAvgCreToCap ?? undefined)}`}>{row.weightedAvgCreToCap != null ? formatRatio(row.weightedAvgCreToCap) : "—"}</td>
                    <td className="text-right py-2">{row.weightedAvgNpl != null ? formatPercent(row.weightedAvgNpl) : "—"}</td>
                    <td className="text-right py-2">{formatNumber(row.bankCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Top 25 Tables */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Top 25 by Composite Vulnerability Score</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="text-left py-2 font-semibold"><DefTerm term="Institution">Institution</DefTerm></th>
                <th className="text-left py-2 font-semibold"><DefTerm term="State">State</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Total Assets">Assets</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Total CRE Loans">CRE</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="CRE / (T1+T2)">CRE/(T1+T2)</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Structural Opportunity Score">Structural</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Earnings Resilience Score">Earnings</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Composite Vulnerability Score">Vulnerability</DefTerm></th>
              </tr>
            </thead>
            <tbody>
              {topByOpportunityScore.map((row) => (
                <tr key={row.id} className="border-b border-slate-200">
                  <td className="py-2 font-medium">{row.name}</td>
                  <td className="py-2">{row.state ?? "—"}</td>
                  <td className="text-right py-2">{formatCurrency(row.totalAssets)}</td>
                  <td className="text-right py-2">{formatCurrency(row.creLoans)}</td>
                  <td className={`text-right py-2 ${getCreCapitalColor(row.capitalRatios?.creToTier1Tier2 ?? undefined)}`}>{formatRatio(row.capitalRatios?.creToTier1Tier2)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.opportunityScore, "structural")}`}>{row.opportunityScore.toFixed(1)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.earningsScore, "earnings")}`}>{row.earningsScore.toFixed(1)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.vulnerabilityScore, "vulnerability")}`}>{row.vulnerabilityScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-3 text-slate-700 leading-relaxed text-sm">
          <p>
            <strong>Table explanation:</strong> This table presents the 25 institutions with the highest Composite Vulnerability Score in the selected scope. <strong>Institution</strong> and <strong>State</strong> identify each bank. <strong>Assets</strong> is total balance sheet size. <strong>CRE</strong> is total commercial real estate loans (construction + multifamily + non-residential + other). <strong>CRE/(T1+T2)</strong> shows how many times CRE exposure exceeds Tier 1 + Tier 2 capital—higher multiples indicate greater capital sensitivity. <strong>Structural</strong> (0–100) measures CRE concentration and credit stress; <strong>Earnings</strong> (0–100) measures income strength as a cushion; <strong>Vulnerability</strong> (0–100) combines both, with higher scores indicating elevated structural risk not offset by earnings. Institutions at the top of this table warrant the closest scrutiny for potential acquisition or partnership opportunities.
          </p>
        </div>
      </section>

      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Top 25 by CRE / (Tier1 + Tier2)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="text-left py-2 font-semibold"><DefTerm term="Institution">Institution</DefTerm></th>
                <th className="text-left py-2 font-semibold"><DefTerm term="State">State</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Total Assets">Assets</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="CRE / (T1+T2)">CRE/(T1+T2)</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="NPL Ratio">NPL</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Composite Vulnerability Score">Vulnerability</DefTerm></th>
              </tr>
            </thead>
            <tbody>
              {topByCreToCapital.map((row) => (
                <tr key={row.id} className="border-b border-slate-200">
                  <td className="py-2 font-medium">{row.name}</td>
                  <td className="py-2">{row.state ?? "—"}</td>
                  <td className="text-right py-2">{formatCurrency(row.totalAssets)}</td>
                  <td className={`text-right py-2 ${getCreCapitalColor(row.capitalRatios?.creToTier1Tier2 ?? undefined)}`}>{formatRatio(row.capitalRatios?.creToTier1Tier2)}</td>
                  <td className="text-right py-2">{formatPercent((row.nplRatio ?? 0) * 100)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.vulnerabilityScore, "vulnerability")}`}>{row.vulnerabilityScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-3 text-slate-700 leading-relaxed text-sm">
          <p>
            <strong>Table explanation:</strong> This table ranks the 25 institutions with the highest CRE-to-capital ratio—those whose commercial real estate exposure most exceeds regulatory capital buffers. <strong>Institution</strong> and <strong>State</strong> identify each bank. <strong>Assets</strong> is total balance sheet size. <strong>CRE/(T1+T2)</strong> expresses CRE loans as a multiple of Tier 1 + Tier 2 capital (e.g., 5.50x means CRE is 5.5 times capital); ratios above 3x–4x typically warrant heightened attention. <strong>NPL</strong> is the nonperforming loan ratio (nonaccrual loans as a share of total loans). <strong>Vulnerability</strong> (0–100) is the Composite Vulnerability Score, combining structural CRE exposure with earnings resilience. Institutions appearing in both this table and the Top 25 by Vulnerability represent the highest-priority screening cohort—elevated capital sensitivity combined with structural and earnings risk.
          </p>
        </div>
      </section>

      {/* Target Screening List — narrative with institution-level detail */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Target Screening List</h2>
        <div className="space-y-4 text-slate-700 leading-relaxed">
          <p>
            The target screening list ranks all FDIC-insured institutions in the selected scope by Composite Vulnerability Score, which combines structural CRE exposure (concentration, NPL from noncurrent-to-loans, reserves, capital) with earnings resilience (ROA, earnings buffer, income trends). Each institution receives three scores: <strong>Structural Opportunity Score</strong> (0–100), <strong>Earnings Resilience Score</strong> (0–100), and <strong>Composite Vulnerability Score</strong> (0–100). Scores are min-max normalized within the cohort, so values are relative to peers in the same region rather than absolute thresholds.
          </p>
          <p>
            <strong>Most important institutions:</strong> The highest-priority screening cohort comprises institutions ranked at the top of both the Composite Vulnerability and CRE-to-Capital tables. {topByOpportunityScore.length > 0 ? (
              <>Among the top five by vulnerability—{topByOpportunityScore.slice(0, 5).map((r) => `${r.name}${r.state ? ` (${r.state})` : ""}`).join(", ")}—key data points to monitor include CRE concentration (share of assets in CRE loans), CRE/(T1+T2) (capital sensitivity), NPL ratio (current credit stress), and the earnings buffer (net income as a share of CRE).</>
            ) : (
              "Key data points to monitor include CRE concentration (share of assets in CRE loans), CRE/(T1+T2) (capital sensitivity), NPL ratio (current credit stress), and the earnings buffer (net income as a share of CRE)."
            )} Institutions with high vulnerability scores (e.g., 70+) and CRE-to-capital ratios above 4x represent the highest concentration of structural risk and capital sensitivity.
          </p>
          <p>
            <strong>Data points explained:</strong> <strong>Structural</strong> reflects CRE concentration (35%), NPL from noncurrent-to-loans (35%), reserves (15%), and capital (15%)—higher scores indicate elevated CRE exposure and credit stress. <strong>Earnings</strong> reflects ROA, earnings buffer, and income trends—higher scores indicate stronger income as a cushion against CRE losses. <strong>Vulnerability</strong> adjusts structural risk by earnings; high structural + low earnings yields high vulnerability. The full interactive table with 4-quarter CRE and NPL trends, capital ratios, and earnings KPIs is available in the Market Analytics view. Primary filings and loan-level data should be consulted for deal-specific verification.
          </p>
        </div>
      </section>
    </div>
  )
}
