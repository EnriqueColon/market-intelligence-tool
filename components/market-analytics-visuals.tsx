"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { buildReportData, type ReportData } from "@/app/actions/build-report-data"
import { CapitalSensitivityMatrix } from "@/components/charts/analytics/capital-sensitivity-matrix"
import { CrePortfolioComposition } from "@/components/charts/analytics/cre-portfolio-composition"
import { CreToCapitalRanking } from "@/components/charts/analytics/cre-to-capital-ranking"
import { OpportunityScoreHistogram } from "@/components/charts/analytics/opportunity-score-histogram"
import { useAnalyticsChartData } from "@/components/charts/analytics/use-analytics-chart-data"
import { getErrorMessage } from "@/lib/error-utils"

function Panel({
  title,
  caption,
  children,
  className = "",
}: {
  title: string
  caption: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 shadow-xs ${className}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95]">{title}</h4>
      <p className="mt-0.5 mb-3 text-xs text-slate-500">{caption}</p>
      {children}
    </div>
  )
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-2 h-2.5 w-56" />
      <Skeleton className="mt-4 w-full rounded-md" style={{ height }} />
    </div>
  )
}

/**
 * The charts that previously existed only inside the downloadable PDF.
 *
 * Data comes from buildReportData, the same server action the PDF renders from,
 * rather than from the screening table already loaded on the client. The
 * screening table carries placeholder zeros for the three scores — they are
 * calculated cohort-wide in the export pipeline — so charting it would produce
 * an empty histogram and uniformly grey bubbles that still looked plausible.
 */
export function MarketAnalyticsVisuals({ scope, asOfQuarter }: { scope: string; asOfQuarter: string }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    buildReportData(scope)
      .then((result) => {
        if (!active) return
        setData(result)
      })
      .catch((err) => {
        if (!active) return
        setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [scope])

  return (
    <Card className="p-6 surface-primary">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-800">Visual Analysis</h3>
        <p className="mt-1 text-xs text-slate-600">
          Distribution, ranking and concentration views for {scope}, as of {asOfQuarter}. These are the same charts
          included in the downloadable report.
        </p>
      </div>

      {error && !loading ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-sm text-slate-700">Charts unavailable for this scope.</p>
          <p className="mt-1 text-xs text-slate-500">{error}</p>
        </div>
      ) : loading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartSkeleton height={220} />
          <ChartSkeleton height={220} />
          <ChartSkeleton height={420} />
          <ChartSkeleton height={420} />
        </div>
      ) : (
        <VisualGrid data={data} />
      )}
    </Card>
  )
}

function VisualGrid({ data }: { data: ReportData }) {
  const { histogram, creToCapitalRanking, exposureMix, scatter } = useAnalyticsChartData(data.rows)

  return (
    <div className="grid gap-4 lg:grid-cols-2 animate-in fade-in duration-500">
      <Panel
        title="Opportunity Score Distribution"
        caption={`How ${data.dispersionStats.n} institutions spread across the score bands`}
      >
        <OpportunityScoreHistogram data={histogram} height={220} />
      </Panel>

      <Panel title="Capital Sensitivity Matrix" caption="Concentration against capital; colour is vulnerability">
        <CapitalSensitivityMatrix data={scatter} height={220} />
      </Panel>

      {/* Twenty and fifteen rows respectively; taller than the pair above so the
          category labels have a line each. */}
      <Panel title="CRE-to-Capital Ranking" caption="Top 20 by CRE exposure relative to Tier 1 + Tier 2 capital">
        <CreToCapitalRanking data={creToCapitalRanking} height={420} />
      </Panel>

      <Panel title="CRE Portfolio Composition" caption="What the 15 most capital-exposed CRE books are made of">
        <CrePortfolioComposition data={exposureMix} height={420} />
      </Panel>
    </div>
  )
}
