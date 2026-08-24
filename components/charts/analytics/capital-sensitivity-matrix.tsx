"use client"

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChartTooltipRow, ChartTooltipShell } from "@/components/charts/chart-tooltip"
import { CHART_INK, axisLineProps, gridProps, numericTick } from "@/lib/chart-theme"
import { getVulnerabilityFillHex } from "@/lib/score-colors"
import { formatCapitalMultiple } from "@/lib/format/metrics"
import type { CapitalScatter, CapitalScatterPoint } from "@/lib/analytics-chart-data"

const VULNERABILITY_LEGEND = [
  { range: "0–30", fill: "#e2e8f0" },
  { range: "30–50", fill: "#fcd34d" },
  { range: "50–70", fill: "#fb923c" },
  { range: "70–85", fill: "#f87171" },
  { range: "85–100", fill: "#dc2626" },
]

function formatCurrency(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

/**
 * Balance-sheet concentration against capital sensitivity.
 *
 * The bubble colour stays on the red vulnerability scale rather than the brand
 * palette: it encodes severity, and teal would read as decorative.
 */
export function CapitalSensitivityMatrix({ data, height = 340 }: { data: CapitalScatter; height?: number }) {
  if (data.points.length === 0) {
    return <p className="text-sm text-slate-600">No institutions with CRE and capital data available.</p>
  }

  return (
    <div className="w-full">
      <div style={{ height, minHeight: height }} className="w-full">
        <ResponsiveContainer width="100%" height={height} debounce={0}>
          <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 16 }}>
            <CartesianGrid {...gridProps} />
            <XAxis
              type="number"
              dataKey="creToAssets"
              name="CRE / Assets (%)"
              tick={numericTick}
              axisLine={axisLineProps}
              tickLine={false}
              label={{ value: "CRE / Assets (%)", position: "bottom", fontSize: 10, fill: CHART_INK.axis }}
            />
            <YAxis
              type="number"
              dataKey="creToCap"
              name="CRE / (Tier1 + Tier2) (%)"
              tick={numericTick}
              axisLine={axisLineProps}
              tickLine={false}
              width={64}
              // Shortened from "CRE / (Tier1 + Tier2)": the full form is clipped
              // at panel heights on screen. The tooltip still spells it out.
              label={{
                value: "CRE / Capital (%)",
                angle: -90,
                position: "insideLeft",
                fontSize: 10,
                fill: CHART_INK.axis,
                style: { textAnchor: "middle" },
              }}
            />
            <ReferenceLine x={data.medianCreToAssets} stroke={CHART_INK.reference} strokeDasharray="4 4" />
            <ReferenceLine y={data.medianCreToCap} stroke={CHART_INK.reference} strokeDasharray="4 4" />
            <Scatter
              data={data.points}
              fillOpacity={0.75}
              shape={(props: any) => {
                const { cx, cy, payload } = props
                const r = payload.bubbleSize ?? 6
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={getVulnerabilityFillHex(payload.vulnerabilityScore ?? 0)}
                    fillOpacity={0.75}
                    stroke="#475569"
                    strokeWidth={1}
                  />
                )
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                const p = payload[0].payload as CapitalScatterPoint
                return (
                  <ChartTooltipShell title={p.name}>
                    <ChartTooltipRow label="CRE / Assets" value={`${p.creToAssets.toFixed(1)}%`} />
                    <ChartTooltipRow label="CRE / Capital" value={formatCapitalMultiple(p.creToCap / 100)} />
                    <ChartTooltipRow label="Vulnerability" value={p.vulnerabilityScore?.toFixed(1) ?? "—"} />
                    <ChartTooltipRow label="Assets" value={formatCurrency(p.totalAssets)} />
                  </ChartTooltipShell>
                )
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        {VULNERABILITY_LEGEND.map(({ range, fill }) => (
          <span key={range} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300"
              style={{ backgroundColor: fill }}
            />
            {range}
          </span>
        ))}
        <span>· Bubble size = Total assets · Dashed lines = Medians</span>
      </div>
    </div>
  )
}
