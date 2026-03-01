"use client"

import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"
import { fetchRawFredData, type FredDataResponse } from "@/app/actions/fetch-cre-data"
import { FRED_SERIES } from "@/lib/fred-constants"
import { ExternalLink, RefreshCw, AlertCircle } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface FredDataViewerProps {
  defaultSeriesId?: string
}

export function FredDataViewer({ defaultSeriesId }: FredDataViewerProps) {
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(
    defaultSeriesId || FRED_SERIES.priceIndex
  )
  const [data, setData] = useState<FredDataResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = async (seriesId: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchRawFredData(seriesId, 100)
      setData(result)
      if (result.error) {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData(selectedSeriesId)
  }, [selectedSeriesId])

  const seriesOptions = [
    { id: FRED_SERIES.priceIndex, label: "Price Index (CPILFESL)", key: "priceIndex" },
    { id: FRED_SERIES.officeDelinquency, label: "Office Delinquency (DRSFRMACBS)", key: "officeDelinquency" },
    { id: FRED_SERIES.retailDelinquency, label: "Retail Delinquency (DRSFRMACBS)", key: "retailDelinquency" },
    { id: FRED_SERIES.multifamilyDelinquency, label: "Multifamily Delinquency (DRSFRMACBS)", key: "multifamilyDelinquency" },
  ]

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    } catch {
      return dateString
    }
  }

  const formatValue = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value)
  }

  const getStats = () => {
    if (!data || !data.data || data.data.length === 0) return null

    const values = data.data.map((d) => d.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const latest = values[values.length - 1]
    const previous = values.length > 1 ? values[values.length - 2] : null
    const change = previous !== null ? latest - previous : null
    const changePercent = previous !== null && previous !== 0 ? (change! / previous) * 100 : null

    return {
      min,
      max,
      avg,
      latest,
      change,
      changePercent,
      count: values.length,
    }
  }

  const stats = getStats()
  const fredUrl = `https://fred.stlouisfed.org/series/${selectedSeriesId}`

  return (
    <Card className="p-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">FRED Data Viewer</h3>
            <p className="text-sm text-muted-foreground">
              Inspect raw data from the Federal Reserve Economic Data (FRED) API
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadData(selectedSeriesId)}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(fredUrl, "_blank", "noopener,noreferrer")}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              View on FRED
            </Button>
          </div>
        </div>

        {/* Series Selector */}
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-foreground">Series:</label>
          <Select value={selectedSeriesId} onValueChange={setSelectedSeriesId}>
            <SelectTrigger className="w-[300px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {seriesOptions.map((option) => (
                <SelectItem key={option.key} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="font-mono text-xs">
            {selectedSeriesId}
          </Badge>
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Metadata */}
        {data && data.metadata && (
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {data.seriesName && (
              <div>
                <span className="font-medium">Series:</span> {data.seriesName}
              </div>
            )}
            {data.metadata.observationStart && (
              <div>
                <span className="font-medium">Start:</span> {formatDate(data.metadata.observationStart)}
              </div>
            )}
            {data.metadata.observationEnd && (
              <div>
                <span className="font-medium">End:</span> {formatDate(data.metadata.observationEnd)}
              </div>
            )}
            <div>
              <span className="font-medium">Observations:</span> {data.metadata.count}
            </div>
          </div>
        )}

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/50 p-4 md:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Latest Value</div>
              <div className="text-lg font-semibold">{formatValue(stats.latest)}</div>
              {stats.changePercent !== null && (
                <div
                  className={`text-xs ${
                    stats.changePercent >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {stats.changePercent >= 0 ? "+" : ""}
                  {stats.changePercent.toFixed(2)}%
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Average</div>
              <div className="text-lg font-semibold">{formatValue(stats.avg)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Minimum</div>
              <div className="text-lg font-semibold">{formatValue(stats.min)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Maximum</div>
              <div className="text-lg font-semibold">{formatValue(stats.max)}</div>
            </div>
          </div>
        )}

        {/* Data Table */}
        {loading ? (
          <div className="flex h-[400px] items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              <div className="text-sm text-muted-foreground">Loading data...</div>
            </div>
          </div>
        ) : data && data.data && data.data.length > 0 ? (
          <div className="rounded-lg border">
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">#</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">% Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((point, index) => {
                    const previousValue =
                      index > 0 ? data.data[index - 1].value : null
                    const change = previousValue !== null ? point.value - previousValue : null
                    const changePercent =
                      previousValue !== null && previousValue !== 0
                        ? (change! / previousValue) * 100
                        : null

                    return (
                      <TableRow key={`${point.date}-${index}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {index + 1}
                        </TableCell>
                        <TableCell className="font-medium">{formatDate(point.date)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatValue(point.value)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {change !== null ? (
                            <span
                              className={
                                change >= 0 ? "text-green-600" : "text-red-600"
                              }
                            >
                              {change >= 0 ? "+" : ""}
                              {formatValue(change)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {changePercent !== null ? (
                            <span
                              className={
                                changePercent >= 0 ? "text-green-600" : "text-red-600"
                              }
                            >
                              {changePercent >= 0 ? "+" : ""}
                              {changePercent.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : data && data.data && data.data.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center rounded-lg border">
            <div className="text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">No data available</p>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

