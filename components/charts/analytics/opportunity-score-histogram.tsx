"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartTooltipShell } from "@/components/charts/chart-tooltip"
import { CHART_SERIES, axisLineProps, gridProps, numericTick } from "@/lib/chart-theme"

type Bin = { bin: string; count: number }

/** How many institutions fall in each 10-point band of the structural opportunity score. */
export function OpportunityScoreHistogram({ data, height = 220 }: { data: Bin[]; height?: number }) {
  return (
    <div style={{ height, minHeight: height }} className="w-full">
      <ResponsiveContainer width="100%" height={height} debounce={0}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <Tooltip
            cursor={{ fill: "rgba(0,109,149,0.06)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const item = payload[0].payload as Bin
              const count = item.count ?? 0
              return (
                <ChartTooltipShell title={`Score ${item.bin}`}>
                  <p>
                    {count} {count === 1 ? "institution" : "institutions"}
                  </p>
                </ChartTooltipShell>
              )
            }}
          />
          <XAxis dataKey="bin" tick={numericTick} axisLine={axisLineProps} tickLine={false} />
          <YAxis tick={numericTick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Bar dataKey="count" fill={CHART_SERIES[0]} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
