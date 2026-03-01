"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { useEffect, useState } from "react"
import { fetchFDICFinancialsCached } from "@/lib/fdic-client-cache"
import { BankFinancialData, identifyDistressedBanks } from "@/lib/fdic-data-transformer"
import { AlertCircle, TrendingDown } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

export function DistressedOpportunityScanner() {
  const [loading, setLoading] = useState(true)
  const [distressedBanks, setDistressedBanks] = useState<BankFinancialData[]>([])
  const [selectedRegion, setSelectedRegion] = useState<string>("Southeast")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        // Fetch data for Southeast states
        const states = selectedRegion === "Southeast"
          ? ["Florida", "Georgia", "Alabama", "South Carolina", "North Carolina", "Tennessee"]
          : ["Florida"]

        const allBanks: BankFinancialData[] = []
        for (const state of states) {
          const result = await fetchFDICFinancialsCached(state, 100)
          if (!result.error && result.data.length > 0) {
            allBanks.push(...result.data)
          }
        }

        // Identify distressed banks
        const distressed = identifyDistressedBanks(allBanks, {
          minNPL: 3.0,
          minCREConcentration: 300,
          maxROA: 0.5,
          states: selectedRegion === "Southeast" ? states : undefined,
        })

        // Sort by risk level (highest NPL first)
        distressed.sort((a, b) => (b.nplRatio ?? 0) - (a.nplRatio ?? 0))
        
        setDistressedBanks(distressed.slice(0, 50)) // Top 50 most distressed
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [selectedRegion])

  const formatCurrency = (value: number) => {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
    return `$${value.toLocaleString()}`
  }

  const getRiskLevel = (bank: BankFinancialData): "high" | "medium" | "low" => {
    let riskScore = 0
    const nplPct = (bank.nplRatio ?? 0) * 100
    if (nplPct >= 5) riskScore += 3
    else if (nplPct >= 3) riskScore += 2
    else if (nplPct >= 1.5) riskScore += 1

    if (bank.creConcentration >= 400) riskScore += 3
    else if (bank.creConcentration >= 300) riskScore += 2
    else if (bank.creConcentration >= 200) riskScore += 1

    if (bank.roa < -0.5) riskScore += 2
    else if (bank.roa < 0) riskScore += 1

    if (riskScore >= 5) return "high"
    if (riskScore >= 3) return "medium"
    return "low"
  }

  const getRiskBadgeVariant = (risk: "high" | "medium" | "low") => {
    if (risk === "high") return "destructive"
    if (risk === "medium") return "secondary"
    return "outline"
  }

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              Distressed Opportunity Scanner
            </CardTitle>
            <CardDescription>
              Banks with elevated risk indicators: NPL &gt;= 3%, CRE Concentration &gt;= 300%, or ROA &lt;= 0.5%
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Criteria Explanation */}
        <div className="mb-6 p-4 rounded-lg border bg-yellow-500/10 border-yellow-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium mb-1">Risk Identification Criteria</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>Non-Performing Loan (NPL) Ratio &gt;= 3.0%</li>
                <li>CRE Concentration &gt;= 300% of Tier 1 Capital (approximated)</li>
                <li>Return on Assets (ROA) &lt;= 0.5%</li>
                <li>Declining profitability trends</li>
              </ul>
              <p className="text-xs text-muted-foreground mt-2">
                These banks may present distressed asset acquisition opportunities or indicate market stress.
              </p>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg border bg-card">
            <div className="text-sm text-muted-foreground">High Risk Banks</div>
            <div className="text-2xl font-bold text-red-500 mt-1">
              {distressedBanks.filter(b => getRiskLevel(b) === "high").length}
            </div>
          </div>
          <div className="p-4 rounded-lg border bg-card">
            <div className="text-sm text-muted-foreground">Medium Risk</div>
            <div className="text-2xl font-bold text-yellow-500 mt-1">
              {distressedBanks.filter(b => getRiskLevel(b) === "medium").length}
            </div>
          </div>
          <div className="p-4 rounded-lg border bg-card">
            <div className="text-sm text-muted-foreground">Total Identified</div>
            <div className="text-2xl font-bold mt-1">{distressedBanks.length}</div>
          </div>
        </div>

        {/* Distressed Banks Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Total Assets</TableHead>
                <TableHead>NPL Ratio</TableHead>
                <TableHead>CRE Concentration</TableHead>
                <TableHead>ROA</TableHead>
                <TableHead>Risk Level</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {distressedBanks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No distressed banks identified matching the criteria
                  </TableCell>
                </TableRow>
              ) : (
                distressedBanks.map((bank) => {
                  const riskLevel = getRiskLevel(bank)
                  const nplPct = (bank.nplRatio ?? 0) * 100
                  return (
                    <TableRow key={bank.id}>
                      <TableCell className="font-medium">{bank.name}</TableCell>
                      <TableCell>
                        {bank.city || 'N/A'}, {bank.state || 'N/A'}
                      </TableCell>
                      <TableCell>{formatCurrency(bank.totalAssets)}</TableCell>
                      <TableCell>
                        <span className={nplPct >= 5 ? "text-red-500 font-medium" : nplPct >= 3 ? "text-yellow-500" : ""}>
                          {((bank.nplRatio ?? 0) * 100).toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={bank.creConcentration >= 400 ? "text-red-500 font-medium" : bank.creConcentration >= 300 ? "text-yellow-500" : ""}>
                          {bank.creConcentration.toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell className={bank.roa < 0 ? "text-red-500" : bank.roa < 0.5 ? "text-yellow-500" : ""}>
                        {bank.roa.toFixed(2)}%
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRiskBadgeVariant(riskLevel) as any}>
                          {riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {distressedBanks.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            <p>
              * This scanner identifies banks with elevated risk indicators. Always conduct thorough due diligence
              before pursuing any distressed asset opportunities.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

