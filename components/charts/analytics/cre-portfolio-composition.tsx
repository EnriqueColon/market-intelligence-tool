"use client"

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartTooltipRow, ChartTooltipShell } from "@/components/charts/chart-tooltip"
import { CHART_SERIES, axisLineProps, gridProps, numericTick, singleLineTick, truncateLabel } from "@/lib/chart-theme"
import type { ExposureMixBar } from "@/lib/analytics-chart-data"

const BANDS = [
  { key: "construction", label: "Construction", fill: CHART_SERIES[0] },
  { key: "multifamily", label: "Multifamily", fill: CHART_SERIES[1] },
  { key: "nonResidential", label: "Non-owner-occupied", fill: CHART_SERIES[2] },
] as const

/**
 * What each institution's CRE book is actually made of.
 *
 * Previously drawn in four shades of slate with no key, which made the bands
 * indistinguishable; the brand ramp plus a legend is what makes it readable.
 *
 * Three bands, not four. The fourth was LNREOTH under the label "Other CRE",
 * which is 1-4 family residential and not part of the CRE denominator; with it
 * the stack ran to a median 255% against an axis that stops at 100.
 */
export function CrePortfolioComposition({ data, height = 340 }: { data: ExposureMixBar[]; height?: number }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-600">No institutions with a reported CRE breakdown.</p>
  }

  return (
    <div style={{ height, minHeight: height }} className="w-full">
      <ResponsiveContainer width="100%" height={height} debounce={0}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
          <CartesianGrid {...gridProps} horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={numericTick}
            axisLine={axisLineProps}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            interval={0}
            tick={singleLineTick((name) => truncateLabel(name, 16))}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,109,149,0.06)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as ExposureMixBar
              return (
                <ChartTooltipShell title={row.name}>
                  {BANDS.map(({ key, label }) => (
                    <ChartTooltipRow key={key} label={label} value={`${row[key].toFixed(1)}%`} />
                  ))}
                </ChartTooltipShell>
              )
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={24}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 10, color: "#475569" }}
          />
          {BANDS.map(({ key, label, fill }) => (
            <Bar key={key} dataKey={key} name={label} stackId="cre" fill={fill} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
