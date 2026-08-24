"use client"

import type { ReportData } from "@/app/actions/build-report-data"
import { DefTerm } from "@/components/def-term"
import { ReportInterpretationBlock } from "@/components/report-interpretation-block"
import { CapitalSensitivityMatrix } from "@/components/charts/analytics/capital-sensitivity-matrix"
import { CrePortfolioComposition } from "@/components/charts/analytics/cre-portfolio-composition"
import { CreToCapitalRanking } from "@/components/charts/analytics/cre-to-capital-ranking"
import { OpportunityScoreHistogram } from "@/components/charts/analytics/opportunity-score-histogram"
import { useAnalyticsChartData } from "@/components/charts/analytics/use-analytics-chart-data"
import { getScoreColor, getCreCapitalColor } from "@/lib/score-colors"
import { formatMultiple as formatMultipleMetric } from "@/lib/format/metrics"

const REPORT_FONT = { fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "11pt" }
const SECTION_CLASS = "break-inside-avoid mb-10"

function formatCurrency(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}
function formatPercent(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100)
}
function formatNumber(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US").format(value)
}
function formatRatio(value: number | null | undefined) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return formatMultipleMetric(value)
}

export function MarketAnalyticsReportView({ data }: { data: ReportData }) {
  const { scope, asOfQuarter, kpis, dispersionStats, dispersionNarrative, capitalKpis, rows, topByCreToCapital, topByOpportunityScore, summaryByState } = data
  const { histogram, creToCapitalRanking, exposureMix, scatter } = useAnalyticsChartData(rows)

  return (
    <div className="space-y-10 text-slate-800" style={REPORT_FONT}>
      {/* Executive Summary */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Executive Summary</h2>
        <p className="text-slate-700 mb-4 leading-relaxed">
          {dispersionNarrative.headerBlurb}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="border-b border-slate-200 pb-2">
              <p className="text-xs font-medium text-slate-600 uppercase">{kpi.label}</p>
              <p className="text-base font-semibold text-slate-900 tabular-nums">{kpi.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Opportunity Score Distribution */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Opportunity Score Distribution</h2>
        <p className="text-slate-700 mb-2 leading-relaxed">{dispersionNarrative.headerBlurb}</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> The histogram reveals where institutions cluster by structural CRE exposure and credit stress. Institutions in the upper score bands (70+) represent the primary screening cohort with elevated concentration and asset-quality sensitivity.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div><p className="text-xs text-slate-600">Median</p><p className="font-semibold tabular-nums">{dispersionStats.p50.toFixed(1)}</p></div>
          <div><p className="text-xs text-slate-600">P90</p><p className="font-semibold tabular-nums">{dispersionStats.p90.toFixed(1)}</p></div>
          <div><p className="text-xs text-slate-600">IQR</p><p className="font-semibold tabular-nums">{dispersionStats.p25.toFixed(1)}–{dispersionStats.p75.toFixed(1)}</p></div>
          <div><p className="text-xs text-slate-600">≥80</p><p className="font-semibold tabular-nums">{Math.round(dispersionStats.share_ge_80)}%</p></div>
        </div>
        <div className="mb-4">
          <OpportunityScoreHistogram data={histogram} height={200} />
        </div>
        <p className="text-slate-700 leading-relaxed">{dispersionNarrative.interpretation}</p>
        <ReportInterpretationBlock vizType="Opportunity Score Distribution" scope={scope} asOfQuarter={asOfQuarter} stats={{ n: dispersionStats.n, median: dispersionStats.p50, p90: dispersionStats.p90, iqr: dispersionStats.iqr, share_ge_80: dispersionStats.share_ge_80, dominant_bin: dispersionStats.dominant_bin }} enabled />
      </section>

      {/* Capital Concentration */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Capital Concentration (FDIC)</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><p className="text-xs text-slate-600">Avg CRE / (T1+T2)</p><p className="font-semibold tabular-nums">{capitalKpis.avgCreToTier1Tier2 != null ? formatRatio(capitalKpis.avgCreToTier1Tier2) : "—"}</p></div>
          <div><p className="text-xs text-slate-600">Avg CRE / Equity</p><p className="font-semibold tabular-nums">{capitalKpis.avgCreToEquity != null ? formatRatio(capitalKpis.avgCreToEquity) : "—"}</p></div>
          <div><p className="text-xs text-slate-600">Coverage %</p><p className="font-semibold tabular-nums">{capitalKpis.coveragePct.toFixed(1)}%</p></div>
        </div>
      </section>

      {/* CRE-to-Capital Ranking */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">CRE-to-Capital Exposure Ranking</h2>
        <p className="text-slate-600 text-sm mb-2">Top 20 institutions by capital-adjusted CRE concentration</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> Institutions at the top of this ladder have CRE exposure materially in excess of regulatory capital buffers, indicating elevated sensitivity to asset quality deterioration and potential capital stress under adverse scenarios.
        </p>
        <div className="mb-4">
          <CreToCapitalRanking data={creToCapitalRanking} height={320} />
        </div>
        <ReportInterpretationBlock vizType="CRE-to-Capital Ranking" scope={scope} asOfQuarter={asOfQuarter} stats={{ institutionCount: rows.length, avgCreToT1T2: capitalKpis.avgCreToTier1Tier2, avgCreToEquity: capitalKpis.avgCreToEquity }} enabled />
      </section>

      {/* Capital Sensitivity Matrix */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Capital Sensitivity Matrix</h2>
        <p className="text-slate-600 text-sm mb-2">CRE exposure relative to assets and regulatory capital. Bubble color = Composite Vulnerability Score; size = total assets.</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> Institutions in the upper-right quadrant (above median CRE/Assets and CRE/Capital) with red/orange bubbles represent the highest-priority screening cohort—elevated balance sheet concentration combined with capital sensitivity and structural vulnerability.
        </p>
        <div className="mb-4">
          <CapitalSensitivityMatrix data={scatter} height={320} />
        </div>
        <ReportInterpretationBlock vizType="Capital Sensitivity Matrix" scope={scope} asOfQuarter={asOfQuarter} stats={{ institutionCount: scatter.points.length, medianCreToAssets: scatter.medianCreToAssets, medianCreToCap: scatter.medianCreToCap }} enabled />
      </section>

      {/* CRE Portfolio Composition */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">CRE Portfolio Composition</h2>
        <p className="text-slate-600 text-sm mb-2">Top 15 capital-exposed institutions by asset type</p>
        <p className="text-slate-600 text-sm mb-4 italic">
          <strong>Key insight:</strong> Construction and multifamily exposures are the primary concentration drivers within the highest capital-sensitive institutions. A heavy construction mix indicates greater development-cycle risk; multifamily offers more stable cash flows.
        </p>
        <div className="mb-4">
          <CrePortfolioComposition data={exposureMix} height={320} />
        </div>
        <ReportInterpretationBlock vizType="CRE Portfolio Composition" scope={scope} asOfQuarter={asOfQuarter} stats={{ institutionCount: exposureMix.length }} enabled />
      </section>

      {/* State Overview (National only) */}
      {scope === "National" && summaryByState.length > 0 && (
        <section className={SECTION_CLASS}>
          <h2 className="text-lg font-bold text-slate-900 mb-4">State-Level Capital Sensitivity Overview</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-300">
                  <th className="text-left py-2 font-semibold"><DefTerm term="State">State</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Total Assets">Total Assets</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Total CRE Loans">CRE Loans</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Weighted Avg CRE / Assets">CRE/Assets</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Weighted Avg CRE / Capital">CRE/Capital</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Weighted Avg NPL">NPL</DefTerm></th>
                  <th className="text-right py-2 font-semibold"><DefTerm term="Bank Count">Banks</DefTerm></th>
                </tr>
              </thead>
              <tbody>
                {summaryByState.slice(0, 25).map((row) => (
                  <tr key={row.state} className="border-b border-slate-200">
                    <td className="py-2 font-medium">{row.state}</td>
                    <td className="text-right py-2">{formatCurrency(row.totalAssets)}</td>
                    <td className="text-right py-2">{formatCurrency(row.creLoans)}</td>
                    <td className="text-right py-2">{row.weightedAvgCreToAssets != null ? formatPercent(row.weightedAvgCreToAssets) : "—"}</td>
                    <td className={`text-right py-2 ${getCreCapitalColor(row.weightedAvgCreToCap ?? undefined)}`}>{row.weightedAvgCreToCap != null ? formatRatio(row.weightedAvgCreToCap) : "—"}</td>
                    <td className="text-right py-2">{row.weightedAvgNpl != null ? formatPercent(row.weightedAvgNpl) : "—"}</td>
                    <td className="text-right py-2">{formatNumber(row.bankCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Top 25 Tables */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Top 25 by Composite Vulnerability Score</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="text-left py-2 font-semibold"><DefTerm term="Institution">Institution</DefTerm></th>
                <th className="text-left py-2 font-semibold"><DefTerm term="State">State</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Total Assets">Assets</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Total CRE Loans">CRE</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="CRE / (T1+T2)">CRE/(T1+T2)</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Structural Opportunity Score">Structural</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Earnings Resilience Score">Earnings</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Composite Vulnerability Score">Vulnerability</DefTerm></th>
              </tr>
            </thead>
            <tbody>
              {topByOpportunityScore.map((row) => (
                <tr key={row.id} className="border-b border-slate-200">
                  <td className="py-2 font-medium">{row.name}</td>
                  <td className="py-2">{row.state ?? "—"}</td>
                  <td className="text-right py-2">{formatCurrency(row.totalAssets)}</td>
                  <td className="text-right py-2">{formatCurrency(row.creLoans)}</td>
                  <td className={`text-right py-2 ${getCreCapitalColor(row.capitalRatios?.creToTier1Tier2 ?? undefined)}`}>{formatRatio(row.capitalRatios?.creToTier1Tier2)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.opportunityScore, "structural")}`}>{row.opportunityScore.toFixed(1)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.earningsScore, "earnings")}`}>{row.earningsScore.toFixed(1)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.vulnerabilityScore, "vulnerability")}`}>{row.vulnerabilityScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-3 text-slate-700 leading-relaxed text-sm">
          <p>
            <strong>Table explanation:</strong> This table presents the 25 institutions with the highest Composite Vulnerability Score in the selected scope. <strong>Institution</strong> and <strong>State</strong> identify each bank. <strong>Assets</strong> is total balance sheet size. <strong>CRE</strong> is total commercial real estate loans (construction + multifamily + non-residential + other). <strong>CRE/(T1+T2)</strong> shows how many times CRE exposure exceeds Tier 1 + Tier 2 capital—higher multiples indicate greater capital sensitivity. <strong>Structural</strong> (0–100) measures CRE concentration and credit stress; <strong>Earnings</strong> (0–100) measures income strength as a cushion; <strong>Vulnerability</strong> (0–100) combines both, with higher scores indicating elevated structural risk not offset by earnings. Institutions at the top of this table warrant the closest scrutiny for potential acquisition or partnership opportunities.
          </p>
        </div>
      </section>

      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Top 25 by CRE / (Tier1 + Tier2)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="text-left py-2 font-semibold"><DefTerm term="Institution">Institution</DefTerm></th>
                <th className="text-left py-2 font-semibold"><DefTerm term="State">State</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Total Assets">Assets</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="CRE / (T1+T2)">CRE/(T1+T2)</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="NPL Ratio">NPL</DefTerm></th>
                <th className="text-right py-2 font-semibold"><DefTerm term="Composite Vulnerability Score">Vulnerability</DefTerm></th>
              </tr>
            </thead>
            <tbody>
              {topByCreToCapital.map((row) => (
                <tr key={row.id} className="border-b border-slate-200">
                  <td className="py-2 font-medium">{row.name}</td>
                  <td className="py-2">{row.state ?? "—"}</td>
                  <td className="text-right py-2">{formatCurrency(row.totalAssets)}</td>
                  <td className={`text-right py-2 ${getCreCapitalColor(row.capitalRatios?.creToTier1Tier2 ?? undefined)}`}>{formatRatio(row.capitalRatios?.creToTier1Tier2)}</td>
                  <td className="text-right py-2">{formatPercent((row.nplRatio ?? 0) * 100)}</td>
                  <td className={`text-right py-2 ${getScoreColor(row.vulnerabilityScore, "vulnerability")}`}>{row.vulnerabilityScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-3 text-slate-700 leading-relaxed text-sm">
          <p>
            <strong>Table explanation:</strong> This table ranks the 25 institutions with the highest CRE-to-capital ratio—those whose commercial real estate exposure most exceeds regulatory capital buffers. <strong>Institution</strong> and <strong>State</strong> identify each bank. <strong>Assets</strong> is total balance sheet size. <strong>CRE/(T1+T2)</strong> expresses CRE loans as a multiple of Tier 1 + Tier 2 capital (e.g., 5.50x means CRE is 5.5 times capital); ratios above 3x–4x typically warrant heightened attention. <strong>NPL</strong> is the nonperforming loan ratio (nonaccrual loans as a share of total loans). <strong>Vulnerability</strong> (0–100) is the Composite Vulnerability Score, combining structural CRE exposure with earnings resilience. Institutions appearing in both this table and the Top 25 by Vulnerability represent the highest-priority screening cohort—elevated capital sensitivity combined with structural and earnings risk.
          </p>
        </div>
      </section>

      {/* Target Screening List — narrative with institution-level detail */}
      <section className={SECTION_CLASS}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Target Screening List</h2>
        <div className="space-y-4 text-slate-700 leading-relaxed">
          <p>
            The target screening list ranks all FDIC-insured institutions in the selected scope by Composite Vulnerability Score, which combines structural CRE exposure (concentration, NPL from noncurrent-to-loans, reserves, capital) with earnings resilience (ROA, earnings buffer, income trends). Each institution receives three scores: <strong>Structural Opportunity Score</strong> (0–100), <strong>Earnings Resilience Score</strong> (0–100), and <strong>Composite Vulnerability Score</strong> (0–100). Scores are min-max normalized within the cohort, so values are relative to peers in the same region rather than absolute thresholds.
          </p>
          <p>
            <strong>Most important institutions:</strong> The highest-priority screening cohort comprises institutions ranked at the top of both the Composite Vulnerability and CRE-to-Capital tables. {topByOpportunityScore.length > 0 ? (
              <>Among the top five by vulnerability—{topByOpportunityScore.slice(0, 5).map((r) => `${r.name}${r.state ? ` (${r.state})` : ""}`).join(", ")}—key data points to monitor include CRE concentration (share of assets in CRE loans), CRE/(T1+T2) (capital sensitivity), NPL ratio (current credit stress), and the earnings buffer (net income as a share of CRE).</>
            ) : (
              "Key data points to monitor include CRE concentration (share of assets in CRE loans), CRE/(T1+T2) (capital sensitivity), NPL ratio (current credit stress), and the earnings buffer (net income as a share of CRE)."
            )} Institutions with high vulnerability scores (e.g., 70+) and CRE-to-capital ratios above 4x represent the highest concentration of structural risk and capital sensitivity.
          </p>
          <p>
            <strong>Data points explained:</strong> <strong>Structural</strong> reflects CRE concentration (35%), NPL from noncurrent-to-loans (35%), reserves (15%), and capital (15%)—higher scores indicate elevated CRE exposure and credit stress. <strong>Earnings</strong> reflects ROA, earnings buffer, and income trends—higher scores indicate stronger income as a cushion against CRE losses. <strong>Vulnerability</strong> adjusts structural risk by earnings; high structural + low earnings yields high vulnerability. The full interactive table with 4-quarter CRE and NPL trends, capital ratios, and earnings KPIs is available in the Market Analytics view. Primary filings and loan-level data should be consulted for deal-specific verification.
          </p>
        </div>
      </section>
    </div>
  )
}
