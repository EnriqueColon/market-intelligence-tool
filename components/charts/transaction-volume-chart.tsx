"use client"

import { Card } from "@/components/ui/card"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useEffect, useState } from "react"
import { fetchTransactionVolumeData } from "@/app/actions/fetch-cre-data"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TransactionVolumeChartProps {
  timeRange: string
  level: "national" | "florida" | "miami"
}

// Data sources for Transaction Volume
// Note: FRED doesn't have direct transaction volume data
// This would typically come from CoStar, RCA, or MSCI
const DATA_SOURCES = {
  national: "https://www.msci.com/real-capital-analytics",
  florida: "https://www.msci.com/real-capital-analytics",
  miami: "https://www.msci.com/real-capital-analytics"
}

export function TransactionVolumeChart({ timeRange, level }: TransactionVolumeChartProps) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<"fred" | "perplexity" | "fallback" | "unavailable">("unavailable")

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const result = await fetchTransactionVolumeData(level)
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
            <h3 className="text-lg font-semibold text-foreground">Transaction Volume</h3>
            <p className="text-sm text-muted-foreground">Quarterly sales volume ($B)</p>
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
            <h3 className="text-lg font-semibold text-foreground">Transaction Volume</h3>
            <p className="text-sm text-muted-foreground">Quarterly sales volume ($B)</p>
            <p className="text-xs text-muted-foreground">
              Not a direct filings-based metric. Use as directional context only.
            </p>
            <p className="text-xs text-muted-foreground">
              {source === "perplexity" ? "AI-assisted fallback." : "No primary public source yet."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(DATA_SOURCES[level], "_blank", "noopener,noreferrer")}
            className="gap-2 text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-4 w-4" />
            View Source
          </Button>
        </div>
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-muted-foreground">No data available</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <defs>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                </linearGradient>
              </defs>
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
              <Bar dataKey="volume" fill="url(#volumeGradient)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
