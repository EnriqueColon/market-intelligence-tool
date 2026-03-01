"use client"

import { Card } from "@/components/ui/card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useEffect, useState } from "react"
import { fetchDelinquencyData } from "@/app/actions/fetch-cre-data"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DelinquencyChartProps {
  timeRange: string
  level: "national" | "florida" | "miami"
}

// FRED data sources for CRE Delinquency Rates
const FRED_SOURCES = {
  national: "https://fred.stlouisfed.org/series/DRCRELEXFACBS",
  florida: "https://fred.stlouisfed.org/series/DRCRELEXFACBS",
  miami: "https://fred.stlouisfed.org/series/DRCRELEXFACBS",
}

export function DelinquencyChart({ timeRange, level }: DelinquencyChartProps) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        const chartData = await fetchDelinquencyData(level)
        console.log(`Delinquency data for ${level}:`, chartData)
        if (chartData && chartData.length > 0) {
          setData(chartData)
        } else {
          console.warn(`No delinquency data returned for ${level}`)
          setData([])
        }
      } catch (error) {
        console.error(`Error loading delinquency data for ${level}:`, error)
        setData([])
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [level, timeRange])

  if (loading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Aggregate CRE Delinquency (Proxy)</h3>
            <p className="text-sm text-muted-foreground">Proxy indicator; not property-type delinquency</p>
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
            <h3 className="text-lg font-semibold text-foreground">Aggregate CRE Delinquency (Proxy)</h3>
            <p className="text-sm text-muted-foreground">Proxy indicator; not property-type delinquency</p>
          </div>
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-muted-foreground">No data available</div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Aggregate CRE Delinquency (Proxy)</h3>
            <p className="text-sm text-muted-foreground">Proxy indicator; not property-type delinquency</p>
            <p className="text-xs text-muted-foreground">
              Derived indicator (scaled from a broader series). Use for trend direction only.
            </p>
            <p className="text-xs text-muted-foreground">
              {level === "national"
                ? "National series."
                : level === "florida"
                  ? "National proxy for Florida."
                  : "US proxy for Miami-Dade."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(FRED_SOURCES[level], "_blank", "noopener,noreferrer")}
            className="gap-2 text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-4 w-4" />
            View on FRED
          </Button>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="delinquencyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
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
              formatter={(value: number) => [`${value.toFixed(2)}%`, "Delinquency"]}
            />
            <Area
              type="monotone"
              dataKey="rate"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              fill="url(#delinquencyGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
