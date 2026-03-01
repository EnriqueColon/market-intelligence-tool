"use client"

import { Card } from "@/components/ui/card"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts"

interface LenderMixChartProps {
  timeRange: string
}

export function LenderMixChart({ timeRange }: LenderMixChartProps) {
  const data = [
    { quarter: "Q1", banks: 285, cmbs: 142, insurance: 98, gse: 156 },
    { quarter: "Q2", banks: 278, cmbs: 138, insurance: 102, gse: 162 },
    { quarter: "Q3", banks: 265, cmbs: 135, insurance: 108, gse: 168 },
    { quarter: "Q4", banks: 252, cmbs: 128, insurance: 115, gse: 175 },
  ]

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Lending Activity by Source</h3>
          <p className="text-sm text-muted-foreground">Loan originations by lender type ($B)</p>
          <p className="text-xs text-muted-foreground">Illustrative (static demo)</p>
          <p className="text-xs text-muted-foreground">Not sourced. Use for layout only.</p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="quarter" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Legend />
            <Bar dataKey="banks" fill="hsl(var(--chart-1))" name="Banks" />
            <Bar dataKey="cmbs" fill="hsl(var(--chart-2))" name="CMBS" />
            <Bar dataKey="insurance" fill="hsl(var(--chart-3))" name="Life Insurance" />
            <Bar dataKey="gse" fill="hsl(var(--chart-4))" name="GSE" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
