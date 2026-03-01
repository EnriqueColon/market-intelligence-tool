"use client"

import { Card } from "@/components/ui/card"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts"

interface SalesBySectorChartProps {
  timeRange: string
  level: "florida" | "miami"
}

export function SalesBySectorChart({ timeRange, level }: SalesBySectorChartProps) {
  const data = [
    { name: "Multifamily", value: 42, color: "hsl(var(--chart-1))" },
    { name: "Industrial", value: 28, color: "hsl(var(--chart-2))" },
    { name: "Office", value: 15, color: "hsl(var(--chart-3))" },
    { name: "Retail", value: 12, color: "hsl(var(--chart-4))" },
    { name: "Other", value: 3, color: "hsl(var(--chart-5))" },
  ]

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Sales by Property Sector</h3>
          <p className="text-sm text-muted-foreground">Distribution of transaction volume</p>
          <p className="text-xs text-muted-foreground">Illustrative (static demo)</p>
          <p className="text-xs text-muted-foreground">Not sourced. Use for layout only.</p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={(props: any) => {
                const name = props.name as string
                const percent = props.percent as number
                return `${name} ${(percent * 100).toFixed(0)}%`
              }}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
