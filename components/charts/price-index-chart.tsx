"use client"

import { Card } from "@/components/ui/card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useEffect, useState } from "react"
import { fetchPriceIndexData } from "@/app/actions/fetch-cre-data"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PriceIndexChartProps {
  timeRange: string
  level?: "national" | "florida" | "miami"
}

// FRED data sources for CRE Price Index
const FRED_SOURCES = {
  national: "https://fred.stlouisfed.org/series/CPILFESL",
  florida: "https://fred.stlouisfed.org/series/CPILFESL", 
  miami: "https://fred.stlouisfed.org/series/CPILFESL"
}

export function PriceIndexChart({ timeRange, level = "national" }: PriceIndexChartProps) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<"fred" | "perplexity" | "fallback" | "unavailable">("unavailable")

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const result = await fetchPriceIndexData(level)
      setData(result.data)
      setSource(result.source)
      setLoading(false)
    }
    loadData()
  }, [level, timeRange])

  if (loading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Commercial Property Price Index</h3>
            <p className="text-sm text-muted-foreground">Year-over-year price changes</p>
          </div>
          <div className="h-[300px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading data...</div>
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
            <h3 className="text-lg font-semibold text-foreground">Commercial Property Price Index</h3>
            <p className="text-sm text-muted-foreground">Residential proxy (FHFA/FRED)</p>
            <p className="text-xs text-muted-foreground">
              Price index shown is a proxy indicator. Treat as directional trend, not a direct commercial asset valuation.
            </p>
            <p className="text-xs text-muted-foreground">Proxy type: Residential (FHFA/Case-Shiller).</p>
            <p className="text-xs text-muted-foreground">
              {level === "national"
                ? "National series."
                : level === "florida"
                  ? "National proxy for Florida."
                  : "US proxy for Miami-Dade."}
              {source === "perplexity" ? " AI-assisted fallback." : ""}
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
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-muted-foreground">No data available</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
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
                dataKey="index"
                stroke="hsl(var(--chart-2))"
                strokeWidth={2}
                fill="url(#priceGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
