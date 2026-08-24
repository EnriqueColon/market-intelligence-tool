"use client"

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartTooltipRow, ChartTooltipShell } from "@/components/charts/chart-tooltip"
import { CHART_SERIES, axisLineProps, gridProps, numericTick, singleLineTick, truncateLabel } from "@/lib/chart-theme"
import type { CreToCapitalBar } from "@/lib/analytics-chart-data"

/** Institutions ranked by CRE exposure as a share of Tier 1 + Tier 2 capital. */
export function CreToCapitalRanking({ data, height = 340 }: { data: CreToCapitalBar[]; height?: number }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-600">No institutions with CRE or capital data available.</p>
  }

  return (
    <div style={{ height, minHeight: height }} className="w-full">
      <ResponsiveContainer width="100%" height={height} debounce={0}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 52, bottom: 24, left: 8 }} barCategoryGap={4}>
          <CartesianGrid {...gridProps} horizontal />
          <XAxis type="number" tick={numericTick} axisLine={axisLineProps} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            // interval 0 forces a label on every bar; Recharts otherwise drops
            // alternate ticks when they are tight, which mislabels the ranking.
            interval={0}
            tick={singleLineTick((name, index) => `${index + 1}. ${truncateLabel(name, 18)}`)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,109,149,0.06)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const p = payload[0].payload as CreToCapitalBar
              return (
                <ChartTooltipShell title={p.name}>
                  <ChartTooltipRow label="Rank" value={`#${p.rank}`} />
                  <ChartTooltipRow label="CRE / (T1+T2)" value={`${p.value.toFixed(1)}%`} />
                </ChartTooltipShell>
              )
            }}
          />
          <Bar dataKey="value" fill={CHART_SERIES[0]} radius={[0, 3, 3, 0]} maxBarSize={14}>
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
              style={{ fontSize: 9, fill: "#475569", fontVariantNumeric: "tabular-nums" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
