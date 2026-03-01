"use client"

import { Card } from "@/components/ui/card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

interface ForeclosureChartProps {
  timeRange: string
}

export function ForeclosureChart({ timeRange }: ForeclosureChartProps) {
  const data = [
    { month: "Jan", filings: 98 },
    { month: "Feb", filings: 102 },
    { month: "Mar", filings: 108 },
    { month: "Apr", filings: 115 },
    { month: "May", filings: 122 },
    { month: "Jun", filings: 128 },
    { month: "Jul", filings: 135 },
    { month: "Aug", filings: 138 },
    { month: "Sep", filings: 142 },
    { month: "Oct", filings: 148 },
    { month: "Nov", filings: 152 },
    { month: "Dec", filings: 158 },
  ]

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Foreclosure Filings</h3>
          <p className="text-sm text-muted-foreground">Monthly foreclosure activity</p>
          <p className="text-xs text-muted-foreground">Illustrative (static demo)</p>
          <p className="text-xs text-muted-foreground">Not sourced. Use for layout only.</p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="foreclosureGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Area
              type="monotone"
              dataKey="filings"
              stroke="hsl(var(--destructive))"
              strokeWidth={2}
              fill="url(#foreclosureGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
