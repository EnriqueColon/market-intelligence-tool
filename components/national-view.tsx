"use client"

import { KpiGrid } from "@/components/kpi-grid"
import { PriceIndexChart } from "@/components/charts/price-index-chart"
import { DelinquencyChart } from "@/components/charts/delinquency-chart"
import { TransactionVolumeChart } from "@/components/charts/transaction-volume-chart"
import { DynamicInsightsPanel } from "@/components/dynamic-insights-panel"
import { NewsHeadlines } from "@/components/news-headlines"
import { FDICDashboard } from "@/components/fdic-dashboard/fdic-dashboard"
import { FredDataViewer } from "@/components/fred-data-viewer"
import { useEffect, useState, useMemo } from "react"
import { fetchKpiData } from "@/app/actions/fetch-kpi-data"

interface NationalViewProps {
  timeRange: string
}

export function NationalView({ timeRange }: NationalViewProps) {
  const [kpis, setKpis] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadKpis() {
      setLoading(true)
      const data = await fetchKpiData("national")
      setKpis(data)
      setLoading(false)
    }
    loadKpis()
  }, [timeRange])

  // Extract KPI values for insights generation
  const kpiData = useMemo(() => {
    if (kpis.length === 0) return undefined
    const findKpi = (label: string) => kpis.find(k => k.label.toLowerCase().includes(label.toLowerCase()))
    return {
      priceChange: findKpi("price")?.value,
      delinquencyRate: findKpi("delinquency")?.value,
      transactionVolume: findKpi("transaction")?.value,
      foreclosures: findKpi("foreclosure")?.value,
    }
  }, [kpis])

  return (
    <div className="space-y-6">
      <NewsHeadlines level="national" />

      <FDICDashboard />

      <KpiGrid kpis={kpis} loading={loading} />

      <DynamicInsightsPanel level="national" kpiData={kpiData} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PriceIndexChart timeRange={timeRange} />
        <DelinquencyChart timeRange={timeRange} level="national" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TransactionVolumeChart timeRange={timeRange} level="national" />
      </div>

      <FredDataViewer />
    </div>
  )
}
