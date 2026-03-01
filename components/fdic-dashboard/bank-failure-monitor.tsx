"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useEffect, useState } from "react"
import { fetchFDICFailuresCached } from "@/lib/fdic-client-cache"
import { BankFailureData } from "@/lib/fdic-data-transformer"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

export function BankFailureMonitor() {
  const [loading, setLoading] = useState(true)
  const [failures, setFailures] = useState<BankFailureData[]>([])
  const [selectedState, setSelectedState] = useState<string>("all")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        // Get failures from last 12 months
        const endDate = new Date()
        const startDate = new Date()
        startDate.setFullYear(endDate.getFullYear() - 1)
        
        const startDateStr = startDate.toISOString().split('T')[0]
        const endDateStr = endDate.toISOString().split('T')[0]
        
        const result = await fetchFDICFailuresCached(
          startDateStr,
          endDateStr,
          selectedState === "all" ? undefined : selectedState
        )
        if (result.error) {
          setError(result.error)
        } else {
          setFailures(result.data)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [selectedState])

  const formatCurrency = (value: number) => {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
    return `$${value.toLocaleString()}`
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  const getResolutionBadgeVariant = (type: string) => {
    if (type?.toLowerCase().includes('purchase')) return 'default'
    if (type?.toLowerCase().includes('assumption')) return 'secondary'
    return 'outline'
  }

  const filteredFailures = selectedState === "all"
    ? failures
    : failures.filter(f => f.state === selectedState)

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            {error}
          </div>
        </CardContent>
      </Card>
    )
  }

  const totalCost = failures.reduce((sum, f) => sum + f.cost, 0)
  const totalAssets = failures.reduce((sum, f) => sum + f.assetsAtFailure, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Bank Failure Monitor
            </CardTitle>
            <CardDescription>
              Bank failures in the last 12 months
            </CardDescription>
          </div>
          <Select value={selectedState} onValueChange={setSelectedState}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              <SelectItem value="Florida">Florida</SelectItem>
              <SelectItem value="Georgia">Georgia</SelectItem>
              <SelectItem value="Texas">Texas</SelectItem>
              <SelectItem value="California">California</SelectItem>
              <SelectItem value="New York">New York</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg border bg-card">
            <div className="text-sm text-muted-foreground">Total Failures</div>
            <div className="text-2xl font-bold mt-1">{failures.length}</div>
          </div>
          <div className="p-4 rounded-lg border bg-card">
            <div className="text-sm text-muted-foreground">Total Cost</div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(totalCost)}</div>
          </div>
          <div className="p-4 rounded-lg border bg-card">
            <div className="text-sm text-muted-foreground">Total Assets</div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(totalAssets)}</div>
          </div>
        </div>

        {/* Failures Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Failure Date</TableHead>
                <TableHead>Assets at Failure</TableHead>
                <TableHead>Estimated Cost</TableHead>
                <TableHead>Resolution Type</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFailures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {selectedState === "all"
                      ? "No bank failures in the last 12 months"
                      : `No bank failures in ${selectedState} in the last 12 months`}
                  </TableCell>
                </TableRow>
              ) : (
                filteredFailures.map((failure) => (
                  <TableRow key={failure.cert}>
                    <TableCell className="font-medium">{failure.name}</TableCell>
                    <TableCell>
                      {failure.city}, {failure.state}
                    </TableCell>
                    <TableCell>{formatDate(failure.failDate)}</TableCell>
                    <TableCell>{formatCurrency(failure.assetsAtFailure)}</TableCell>
                    <TableCell>
                      <span className={failure.cost > 0 ? "text-red-500 font-medium" : ""}>
                        {formatCurrency(failure.cost)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getResolutionBadgeVariant(failure.resolutionType) as any}>
                        {failure.resolutionType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <a
                        href={`https://banks.data.fdic.gov/explore/failures/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        View
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {failures.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            <p>
              * Data sourced from FDIC BankFind Suite API. For official press releases and detailed information,
              visit{" "}
              <a
                href="https://www.fdic.gov/news/press-releases/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                FDIC Press Releases
              </a>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

