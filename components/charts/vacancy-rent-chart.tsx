"use client"

import { Card } from "@/components/ui/card"
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts"
import { useEffect, useState } from "react"

interface VacancyRentChartProps {
  timeRange: string
  level: "florida" | "miami"
}

interface ChartDataPoint {
  month: string
  vacancy: number
  rent: number
}

export function VacancyRentChart({ timeRange, level }: VacancyRentChartProps) {
  const [data, setData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate loading and set data
    setLoading(true)
    const chartData = generateVacancyRentData(level)
    setData(chartData)
    setLoading(false)
  }, [level, timeRange])

  if (loading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Vacancy Rate vs Average Rent</h3>
            <p className="text-sm text-muted-foreground">Market dynamics across property types</p>
            <p className="text-xs text-muted-foreground">Illustrative (static demo)</p>
            <p className="text-xs text-muted-foreground">Not sourced. Use for layout only.</p>
          </div>
          <div className="h-[300px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading data...</div>
          </div>
        </div>
      </Card>
    )
  }

  if (!data || data.length === 0) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Vacancy Rate vs Average Rent</h3>
            <p className="text-sm text-muted-foreground">Market dynamics across property types</p>
            <p className="text-xs text-muted-foreground">Illustrative (static demo)</p>
            <p className="text-xs text-muted-foreground">Not sourced. Use for layout only.</p>
          </div>
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-muted-foreground">No data available</div>
          </div>
        </div>
      </Card>
    )
  }

  // Calculate domains for Y-axes
  const vacancyValues = data.map(d => d.vacancy).filter(v => typeof v === 'number')
  const rentValues = data.map(d => d.rent).filter(v => typeof v === 'number')
  const vacancyMin = Math.max(0, Math.min(...vacancyValues) * 0.9)
  const vacancyMax = Math.max(...vacancyValues) * 1.1
  const rentMin = Math.max(0, Math.min(...rentValues) * 0.9)
  const rentMax = Math.max(...rentValues) * 1.1

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Vacancy Rate vs Average Rent</h3>
          <p className="text-sm text-muted-foreground">Market dynamics across property types</p>
          <p className="text-xs text-muted-foreground">Illustrative (static demo)</p>
          <p className="text-xs text-muted-foreground">Not sourced. Use for layout only.</p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis 
              dataKey="month" 
              stroke="hsl(var(--muted-foreground))" 
              fontSize={12}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis 
              yAxisId="left" 
              stroke="hsl(var(--chart-1))" 
              fontSize={12}
              domain={[vacancyMin, vacancyMax]}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
              label={{ value: 'Vacancy %', angle: -90, position: 'insideLeft', style: { fill: "hsl(var(--muted-foreground))" } }}
              tickFormatter={(value) => `${Math.round(value)}`}
            />
            <YAxis 
              yAxisId="right" 
              orientation="right" 
              stroke="hsl(var(--chart-2))" 
              fontSize={12}
              domain={[rentMin, rentMax]}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
              label={{ value: 'Rent $/sqft', angle: 90, position: 'insideRight', style: { fill: "hsl(var(--muted-foreground))" } }}
              tickFormatter={(value) => `$${Math.round(value)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number, name: string) => {
                if (name === "Vacancy Rate (%)") {
                  return [`${value.toFixed(2)}%`, name]
                }
                return [`$${value.toFixed(2)}`, name]
              }}
            />
            <Legend />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="vacancy"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              dot={{ r: 4, fill: "hsl(var(--chart-1))" }}
              name="Vacancy Rate (%)"
              connectNulls
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="rent"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              dot={{ r: 4, fill: "hsl(var(--chart-2))" }}
              name="Avg Rent ($/sqft)"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function generateVacancyRentData(level: string) {
  const rentBase = level === "miami" ? 32 : 28

  return [
    { month: "Jan", vacancy: 9.2, rent: rentBase - 2 },
    { month: "Feb", vacancy: 9.0, rent: rentBase - 1.5 },
    { month: "Mar", vacancy: 8.8, rent: rentBase - 1 },
    { month: "Apr", vacancy: 8.6, rent: rentBase - 0.5 },
    { month: "May", vacancy: 8.5, rent: rentBase },
    { month: "Jun", vacancy: 8.3, rent: rentBase + 0.5 },
    { month: "Jul", vacancy: 8.2, rent: rentBase + 1 },
    { month: "Aug", vacancy: 8.0, rent: rentBase + 1.5 },
    { month: "Sep", vacancy: 7.9, rent: rentBase + 2 },
    { month: "Oct", vacancy: 7.8, rent: rentBase + 2.5 },
    { month: "Nov", vacancy: 7.6, rent: rentBase + 3 },
    { month: "Dec", vacancy: 7.4, rent: rentBase + 3.5 },
  ]
}
