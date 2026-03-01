"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useEffect, useState } from "react"
import {
  fetchFDICDemographicsCached,
  fetchFDICFinancialsCached,
  fetchFDICInstitutionsCached,
} from "@/lib/fdic-client-cache"
import { DemographicsData, BankFinancialData } from "@/lib/fdic-data-transformer"
import { TrendingUp, Building2, DollarSign, Users } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

export function MiamiMarketFocus() {
  const [loading, setLoading] = useState(true)
  const [demographics, setDemographics] = useState<DemographicsData[]>([])
  const [bankStats, setBankStats] = useState<{
    totalBanks: number
    totalDeposits: number
    totalAssets: number
    creConcentration: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        // Fetch demographics for Miami metro
        const demoResult = await fetchFDICDemographicsCached(
          "Miami-Fort Lauderdale-West Palm Beach",
          "Florida"
        )
        
        // Fetch bank data for Miami-Dade County
        const banksResult = await fetchFDICInstitutionsCached("Florida", 200)
        const financialsResult = await fetchFDICFinancialsCached("Florida", 200)
        
        if (demoResult.error || banksResult.error || financialsResult.error) {
          setError(demoResult.error || banksResult.error || financialsResult.error || "Failed to load data")
        } else {
          setDemographics(demoResult.data.filter(d => 
            d.metroName.toLowerCase().includes('miami') || 
            d.county.toLowerCase().includes('dade')
          ))
          
          // Calculate bank statistics for Miami area
          const miamiBanks = banksResult.data.filter(b => 
            b.city.toLowerCase().includes('miami') || 
            b.city.toLowerCase().includes('fort lauderdale') ||
            b.city.toLowerCase().includes('west palm')
          )
          
          const miamiFinancials = financialsResult.data.filter(b =>
            b.city?.toLowerCase().includes('miami') ||
            b.city?.toLowerCase().includes('fort lauderdale') ||
            b.city?.toLowerCase().includes('west palm')
          )
          
          const totalDeposits = miamiBanks.reduce((sum, b) => sum + b.totalDeposits, 0)
          const totalAssets = miamiBanks.reduce((sum, b) => sum + b.totalAssets, 0)
          const avgCREConcentration = miamiFinancials.length > 0
            ? miamiFinancials.reduce((sum, b) => sum + b.creConcentration, 0) / miamiFinancials.length
            : 0
          
          setBankStats({
            totalBanks: miamiBanks.length,
            totalDeposits,
            totalAssets,
            creConcentration: avgCREConcentration,
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const formatCurrency = (value: number) => {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
    return `$${value.toLocaleString()}`
  }

  if (loading) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
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

  const miamiDemo = demographics[0] || null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Miami-Dade Market Focus</h2>
        <p className="text-sm text-muted-foreground">
          Regional analysis for Miami-Fort Lauderdale-West Palm Beach metro area
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Population Trends */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Population</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {miamiDemo ? (
              <>
                <div className="text-2xl font-bold">
                  {miamiDemo.currentPopulation?.toLocaleString() || 'N/A'}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                  {miamiDemo.populationGrowth > 0 ? (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  ) : null}
                  <span>
                    {miamiDemo.populationGrowth > 0 ? '+' : ''}
                    {miamiDemo.populationGrowth?.toFixed(2) || '0.00'}% YoY
                  </span>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Data not available</div>
            )}
          </CardContent>
        </Card>

        {/* Median Household Income */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Median Income</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {miamiDemo ? (
              <div className="text-2xl font-bold">
                {miamiDemo.medianHouseholdIncome
                  ? formatCurrency(miamiDemo.medianHouseholdIncome)
                  : 'N/A'}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Data not available</div>
            )}
          </CardContent>
        </Card>

        {/* Number of Banks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">FDIC Banks</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {bankStats?.totalBanks || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              In metro area
            </p>
          </CardContent>
        </Card>

        {/* Total Deposits */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Deposits</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {bankStats ? formatCurrency(bankStats.totalDeposits) : '$0'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Market deposits
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Additional Market Metrics */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>CRE Loan Concentration</CardTitle>
            <CardDescription>Average CRE concentration in Miami metro banks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {bankStats ? bankStats.creConcentration.toFixed(2) : '0.00'}%
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {bankStats && bankStats.creConcentration > 300
                ? "⚠️ High concentration risk"
                : bankStats && bankStats.creConcentration > 200
                ? "⚡ Elevated concentration"
                : "✓ Within normal range"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Market Summary</CardTitle>
            <CardDescription>Key market indicators</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Assets:</span>
              <span className="text-sm font-medium">
                {bankStats ? formatCurrency(bankStats.totalAssets) : '$0'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Metro Area:</span>
              <span className="text-sm font-medium">
                {miamiDemo?.metroName || 'Miami-Fort Lauderdale-West Palm Beach'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Primary County:</span>
              <span className="text-sm font-medium">
                {miamiDemo?.county || 'Miami-Dade'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

