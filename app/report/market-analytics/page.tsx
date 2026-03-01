import { Suspense } from "react"
import { buildReportData } from "@/app/actions/build-report-data"
import { MarketAnalyticsReportView } from "@/components/market-analytics-report-view"
import { ReportAppendix } from "@/components/report-appendix"

type PageProps = {
  searchParams: Promise<{ scope?: string; state?: string; limit?: string }>
}

export default async function ReportPage({ searchParams }: PageProps) {
  const params = await searchParams
  const scope = params.scope?.trim() || "National"
  const state = params.state?.trim()
  const initialScope = state || scope

  const data = await buildReportData(initialScope)

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 print:py-4" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} data-report-ready>
      {/* Cover / Title */}
      <header className="mb-12 print:mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Institutional Executive Report
        </h1>
        <p className="text-slate-600" style={{ fontSize: "11pt" }}>
          Market Analytics — FDIC Bank Screening
        </p>
        <p className="text-slate-600 mt-1" style={{ fontSize: "11pt" }}>
          Scope: {initialScope} | As of: {data.asOfQuarter} | Generated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </header>

      {/* Report content: financial-report grade, no Cards */}
      <MarketAnalyticsReportView data={data} />

      {/* Appendix */}
      <ReportAppendix />

      {/* Footer for print */}
      <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-xs text-slate-500 print:fixed print:bottom-0 print:left-0 print:right-0 print:mt-0 print:pt-2">
        Confidential — For Internal Use Only
      </footer>
    </div>
  )
}
