"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState } from "react"
import { fetchFDICFinancialsCached } from "@/lib/fdic-client-cache"
import { calculateAggregateStats } from "@/lib/fdic-data-transformer"
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

interface BankingSectorOverviewProps {
  state?: string
}

export function BankingSectorOverview({ state = "Florida" }: BankingSectorOverviewProps) {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<{
    totalCRELoans: number
    averageNPLRatio: number
    averageLoanLossReserve: number
    totalAssets: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchFDICFinancialsCached(state, 100)
        if (result.error) {
          setError(result.error)
        } else {
          const aggregateStats = calculateAggregateStats(result.data)
          setStats(aggregateStats)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [state])

  const formatCurrency = (value: number) => {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
    return `$${value.toLocaleString()}`
  }

  const getTrendIcon = (value: number, threshold: number, reverse: boolean = false) => {
    const isGood = reverse ? value < threshold : value > threshold
    if (isGood) return <TrendingUp className="h-4 w-4 text-green-500" />
    if (value < threshold * 0.9) return <TrendingDown className="h-4 w-4 text-red-500" />
    return <Minus className="h-4 w-4 text-yellow-500" />
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-3 w-20 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error || !stats) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            {error || "No data available"}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total CRE Loans</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(stats.totalCRELoans)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {state} banks
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg NPL Ratio</CardTitle>
          {getTrendIcon(stats.averageNPLRatio, 3.0, true)}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.averageNPLRatio.toFixed(2)}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.averageNPLRatio < 3.0 ? "Below risk threshold" : "Above risk threshold"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg Loan Loss Reserve</CardTitle>
          {getTrendIcon(stats.averageLoanLossReserve, 1.5)}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.averageLoanLossReserve.toFixed(2)}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            Reserve coverage ratio
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Assets</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(stats.totalAssets)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            Banking sector total
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

