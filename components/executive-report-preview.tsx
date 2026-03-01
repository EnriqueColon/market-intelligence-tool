"use client"

import { useMemo, useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import {
  computeDispersionStats,
  buildDispersionNarrative,
  getHistogramData,
} from "@/lib/opportunity-score-dispersion"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { fetchAnalystNarrative } from "@/app/actions/generate-analyst-narrative"
import type { AnalystNarrative } from "@/lib/report/narrative/generate-analyst-narrative"
import { DefTerm } from "@/components/def-term"

type ExecutiveReportPreviewProps = {
  screeningTable: { opportunityScore: number }[]
  formatNumber: (n?: number) => string
  /** Scope for narrative (e.g. "National" or state name) */
  scope?: string
}

export function ExecutiveReportPreview({
  screeningTable,
  formatNumber,
  scope = "National",
}: ExecutiveReportPreviewProps) {
  const scores = useMemo(() => screeningTable.map((r) => r.opportunityScore), [screeningTable])
  const stats = useMemo(() => computeDispersionStats(scores), [scores])
  const histogramData = useMemo(() => getHistogramData(scores), [scores])
  const narrative = useMemo(() => buildDispersionNarrative(stats), [stats])

  const [analystNarrative, setAnalystNarrative] = useState<AnalystNarrative | null>(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)

  useEffect(() => {
    if (scores.length === 0) return
    setNarrativeLoading(true)
    fetchAnalystNarrative(scope)
      .then(({ narrative: n, error }) => {
        if (n) setAnalystNarrative(n)
        if (error) console.warn("Analyst narrative:", error)
      })
      .finally(() => setNarrativeLoading(false))
  }, [scope, scores.length])

  if (scores.length === 0) return null

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <h3 className="text-base font-semibold text-slate-800 mb-1">Executive Report Preview</h3>
      <p className="text-xs text-slate-600 mb-6">
        Investment-committee grade summary. Download full report for PDF + Excel.
      </p>

      <section className="space-y-4 mb-6">
        <h4 className="text-sm font-semibold text-slate-700">
          <DefTerm term="Opportunity Score Distribution">Opportunity Score Distribution</DefTerm>
        </h4>
        <p className="text-sm text-slate-600 leading-relaxed">{narrative.headerBlurb}</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card className="p-3 bg-white border-slate-200">
          <p className="text-xs font-medium text-slate-600"><DefTerm term="Median Opportunity Score">Median Opportunity Score</DefTerm></p>
          <p className="text-lg font-semibold text-slate-800">{stats.p50.toFixed(1)}</p>
          <p className="text-[10px] text-slate-500">IQR: {stats.p25.toFixed(1)}–{stats.p75.toFixed(1)}</p>
        </Card>
        <Card className="p-3 bg-white border-slate-200">
          <p className="text-xs font-medium text-slate-600"><DefTerm term="Upper-Tail Threshold (P90)">Upper-Tail Threshold (P90)</DefTerm></p>
          <p className="text-lg font-semibold text-slate-800">{stats.p90.toFixed(1)}</p>
          <p className="text-[10px] text-slate-500">Top decile avg: {stats.top_decile_mean.toFixed(1)}</p>
        </Card>
        <Card className="p-3 bg-white border-slate-200">
          <p className="text-xs font-medium text-slate-600"><DefTerm term="Score Range">Score Range</DefTerm></p>
          <p className="text-lg font-semibold text-slate-800">{stats.min.toFixed(0)}–{stats.max.toFixed(0)}</p>
          <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
            <p>{stats.n} institutions</p>
            <p><DefTerm term="IQR">IQR</DefTerm>: {stats.iqr.toFixed(1)} (P25–P75: {stats.p25.toFixed(1)}–{stats.p75.toFixed(1)})</p>
            <p>P10–P90: {stats.p10.toFixed(1)}–{stats.p90.toFixed(1)}</p>
            <p>Dispersion: {stats.dispersion_level} · Dominant: {stats.dominant_bin} ({stats.dominant_bin_share}%)</p>
          </div>
        </Card>
        <Card className="p-3 bg-white border-slate-200">
          <p className="text-xs font-medium text-slate-600"><DefTerm term="High-Score Share (≥80)">High-Score Share (≥80)</DefTerm></p>
          <p className="text-lg font-semibold text-slate-800">{Math.round(stats.share_ge_80)}%</p>
          <p className="text-[10px] text-slate-500">≥70: {Math.round(stats.share_ge_70)}%</p>
        </Card>
      </div>

      <div className="mb-6">
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
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
              <XAxis
                dataKey="bin"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={{ stroke: "#94a3b8" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                label={{ value: "Number of Institutions", angle: -90, position: "insideLeft", fontSize: 10, fill: "#64748b" }}
              />
              <Bar dataKey="count" fill="#334155" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 mt-2">
          <span><DefTerm term="Median Opportunity Score">Median (P50)</DefTerm>: {stats.p50.toFixed(1)}</span>
          <span><DefTerm term="IQR">P25–P75</DefTerm>: {stats.p25.toFixed(1)}–{stats.p75.toFixed(1)}</span>
          <span><DefTerm term="Upper-Tail Threshold (P90)">P90</DefTerm>: {stats.p90.toFixed(1)}</span>
          <span>Top Decile Avg: {stats.top_decile_mean.toFixed(1)}</span>
          <span><DefTerm term="Dominant Band">Dominant Band</DefTerm>: {stats.dominant_bin} ({stats.dominant_bin_share}%)</span>
        </div>
      </div>

      <p className="text-sm text-slate-600 leading-relaxed mb-4">{narrative.histogramLine}</p>
      <p className="text-sm text-slate-600 leading-relaxed mb-4">{narrative.interpretation}</p>
      <p className="text-sm text-slate-600 leading-relaxed font-medium">{narrative.actionLine}</p>

      {analystNarrative && (
        <section className="mt-8 pt-6 border-t border-slate-200">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Analyst Narrative (Auto-Generated)</h4>
          <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
            <div>
              <p className="font-medium text-slate-700 mb-1">CRE Exposure</p>
              <p>{analystNarrative.executiveSummary.creExposureOverview}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700 mb-1">Capital Buffer</p>
              <p>{analystNarrative.executiveSummary.capitalBufferOverview}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700 mb-1">Credit Signals</p>
              <p>{analystNarrative.executiveSummary.creditDeteriorationSignals}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700 mb-1">Risk Dispersion</p>
              <p>{analystNarrative.executiveSummary.riskDispersionScreening}</p>
            </div>
            <div>
              <p className="font-medium text-slate-700 mb-1">Implications</p>
              <p>{analystNarrative.executiveSummary.implications}</p>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-4 italic">
            Generated from FDIC-derived metrics; narrative is descriptive and non-forward-looking.
          </p>
        </section>
      )}
      {narrativeLoading && !analystNarrative && (
        <section className="mt-8 pt-6 border-t border-slate-200">
          <p className="text-sm text-slate-500">Generating analyst narrative…</p>
        </section>
      )}
    </Card>
  )
}
