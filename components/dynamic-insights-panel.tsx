"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Sparkles, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchMarketInsights } from "@/app/actions/fetch-insights"

interface DynamicInsightsPanelProps {
  level: "national" | "florida" | "miami"
  kpiData?: {
    priceChange?: string
    delinquencyRate?: string
    transactionVolume?: string
    foreclosures?: string
  }
}

interface MarketInsight {
  summary: string
  keyPoints: string[]
  outlook: "positive" | "neutral" | "negative"
  generatedAt: string
}

export function DynamicInsightsPanel({ level, kpiData }: DynamicInsightsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [insight, setInsight] = useState<MarketInsight | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const levelLabels = {
    national: "National",
    florida: "Florida",
    miami: "Miami Metro",
  }

  async function loadInsights() {
    setLoading(true)
    try {
      const data = await fetchMarketInsights(level, kpiData)
      setInsight(data)
    } catch (error) {
      console.error("Failed to load insights:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const data = await fetchMarketInsights(level, kpiData)
      setInsight(data)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadInsights()
  }, [level])

  const getOutlookIcon = () => {
    if (!insight) return null
    switch (insight.outlook) {
      case "positive":
        return <TrendingUp className="h-4 w-4 text-green-500" />
      case "negative":
        return <TrendingDown className="h-4 w-4 text-red-500" />
      default:
        return <Minus className="h-4 w-4 text-yellow-500" />
    }
  }

  const getOutlookColor = () => {
    if (!insight) return "bg-primary/20 text-primary"
    switch (insight.outlook) {
      case "positive":
        return "bg-green-500/20 text-green-600"
      case "negative":
        return "bg-red-500/20 text-red-600"
      default:
        return "bg-yellow-500/20 text-yellow-600"
    }
  }

  if (loading) {
    return (
      <Card className="border-primary/20 bg-primary/5 p-6">
        <div className="flex gap-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
      </Card>
    )
  }

  if (!insight) {
    return null
  }

  return (
    <Card className="border-primary/20 bg-primary/5 p-6">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">AI Market Insights</h3>
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                {levelLabels[level]}
              </span>
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getOutlookColor()}`}>
                {getOutlookIcon()}
                {insight.outlook.charAt(0).toUpperCase() + insight.outlook.slice(1)} Outlook
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">{insight.summary}</p>

          {insight.keyPoints.length > 0 && (
            <div className="grid grid-cols-1 gap-2 pt-2 md:grid-cols-2">
              {insight.keyPoints.map((point, index) => (
                <div key={index} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                  <span>{point}</span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 text-xs text-muted-foreground/60">
            Generated: {new Date(insight.generatedAt).toLocaleString()}
          </div>
        </div>
      </div>
    </Card>
  )
}
