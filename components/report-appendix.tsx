"use client"

/**
 * Appendix: Metric Definitions and Methodology
 * Institutional report section with detailed metric definitions.
 */
export function ReportAppendix() {
  const metrics = [
    {
      section: "Structural Metrics",
      items: [
        {
          name: "CRE Concentration (CRE / Loans)",
          definition: "Commercial real estate loans as a percentage of total loans.",
          calculation: "CRE Loans ÷ Total Loans × 100",
          interpretation: "High values indicate concentrated real estate exposure. Low values suggest diversified loan books.",
          whyMatters: "Institutions with elevated CRE concentration are more sensitive to real estate market stress.",
        },
        {
          name: "NPL Ratio",
          definition: "Nonperforming loans and leases as a percentage of total loans and leases.",
          calculation: "Nonaccrual loans ÷ Total loans × 100",
          interpretation: "High values signal credit deterioration. Low values indicate healthy loan performance.",
          whyMatters: "Rising NPL ratios often precede charge-offs and reserve builds.",
        },
        {
          name: "Noncurrent / Loans",
          definition: "Noncurrent loans and leases (past due 90+ plus nonaccrual) as a percent of gross loans (FDIC NCLNLSR).",
          calculation: "Noncurrent loans ÷ Gross loans × 100. Used for Structural Opportunity Score nplScore.",
          interpretation: "High values reflect elevated delinquency. Low values indicate minimal noncurrent exposure.",
          whyMatters: "True NPL ratio; anchors credit stress to the loan book. Used in scoring.",
        },
        {
          name: "Reserve Coverage Ratio",
          definition: "Allowance for loan losses as a percentage of total loans.",
          calculation: "Allowance for loan losses ÷ Total loans × 100",
          interpretation: "High values provide cushion for future losses. Low values may indicate under-reserving.",
          whyMatters: "Adequate reserves absorb credit losses before capital is impaired.",
        },
        {
          name: "Capital Ratio Used (CET1 or Leverage)",
          definition: "Regulatory capital measure. CET1 (Common Equity Tier 1) when available; otherwise Leverage ratio.",
          calculation: "CET1: Common equity ÷ Risk-weighted assets. Leverage: Tier 1 capital ÷ Average total assets.",
          interpretation: "Higher values indicate stronger loss-absorption capacity. Lower values imply thinner buffers.",
          whyMatters: "Capital is the ultimate buffer against insolvency.",
        },
        {
          name: "Structural Opportunity Score",
          definition: "A 0–100 screening score based on balance sheet CRE concentration and credit stress indicators.",
          calculation: "Min-max normalized within cohort. Weighted sum: CRE concentration (35%), NPL from noncurrent-to-loans (35%), Reserve coverage (15%, inverted), Capital ratio (15%, inverted). Scaled to 0–100.",
          interpretation: "Higher scores indicate elevated CRE exposure and weakening credit metrics relative to peers.",
          whyMatters: "Surfaces institutions warranting closer monitoring for potential distress.",
        },
      ],
    },
    {
      section: "Earnings Metrics",
      items: [
        {
          name: "ROA (Return on Assets)",
          definition: "Net income as a percentage of total assets.",
          calculation: "Net income ÷ Total assets × 100",
          interpretation: "Higher values indicate stronger profitability. Negative values signal losses.",
          whyMatters: "Earnings are the first line of defense against credit deterioration.",
        },
        {
          name: "ROA 4Q Change",
          definition: "Change in ROA versus four quarters ago, in percentage points.",
          calculation: "ROA (latest) − ROA (4 quarters ago)",
          interpretation: "Positive values indicate improving profitability. Negative values suggest earnings pressure.",
          whyMatters: "Trend in profitability matters as much as level.",
        },
        {
          name: "Net Income (TTM)",
          definition: "Trailing twelve months net income (sum of last four quarters).",
          calculation: "Sum of net income for quarters t, t−1, t−2, t−3",
          interpretation: "Higher values indicate stronger earnings capacity.",
          whyMatters: "TTM income reflects sustainable earnings power.",
        },
        {
          name: "Net Income YoY %",
          definition: "Year-over-year percentage change in TTM net income.",
          calculation: "(TTM net income − Prior TTM net income) ÷ |Prior TTM| × 100",
          interpretation: "Positive values indicate earnings growth. Negative values signal earnings decline.",
          whyMatters: "YoY trend reveals whether earnings are improving or deteriorating.",
        },
        {
          name: "Net Interest Margin (NIM)",
          definition: "Net interest income as a percentage of average earning assets.",
          calculation: "Net interest income ÷ Average earning assets × 100",
          interpretation: "Higher values indicate stronger core lending profitability.",
          whyMatters: "NIM is the primary driver of bank earnings.",
        },
        {
          name: "Earnings Buffer %",
          definition: "TTM net income as a percentage of CRE loans.",
          calculation: "Net income (TTM) ÷ CRE loans × 100",
          interpretation: "Higher values indicate more earnings cushion relative to CRE exposure.",
          whyMatters: "Measures ability to absorb CRE losses through ongoing earnings.",
        },
        {
          name: "Earnings Resilience Score",
          definition: "A 0–100 score measuring income strength and trend as a cushion against potential CRE losses.",
          calculation: "Min-max normalized within cohort. Weighted sum: Earnings Buffer (40%), ROA (25%), NI YoY % (20%), ROA Δ 4Q (15%). Missing metrics excluded; weights rebalanced.",
          interpretation: "Higher scores indicate stronger earnings capacity relative to peers.",
          whyMatters: "Differentiates banks with similar CRE exposure by earnings capacity.",
        },
      ],
    },
    {
      section: "Composite Metric",
      items: [
        {
          name: "Composite Vulnerability Score",
          definition: "A 0–100 score that adjusts structural CRE stress by earnings strength.",
          calculation: "Vulnerability = Structural Opportunity Score × (1 − Earnings Resilience Score/100 × 0.40). Clamped to 0–100.",
          interpretation: "Higher scores indicate high structural risk without earnings cushion. Lower scores mean structural risk is moderated by strong earnings.",
          whyMatters: "Prioritizes institutions with both elevated exposure and weak income support.",
        },
      ],
    },
    {
      section: "Visualization-Specific",
      items: [
        { name: "P10, P25, P50, P75, P90", definition: "Percentiles of the score distribution.", calculation: "P50 = median; P90 = 90th percentile, etc.", interpretation: "P90 and above = top decile. P50 = typical institution.", whyMatters: "Percentiles frame relative positioning within the cohort." },
        { name: "Interquartile Range (IQR)", definition: "Spread of the middle 50% of scores.", calculation: "P75 − P25", interpretation: "Larger IQR indicates more dispersion. Smaller IQR suggests clustering.", whyMatters: "Measures score spread and tail concentration." },
        { name: "Dominant Bin", definition: "The 10-point score band containing the most institutions.", calculation: "Histogram bin with maximum count.", interpretation: "Identifies where the cohort clusters.", whyMatters: "Reveals typical score range for the region." },
        { name: "Top Decile", definition: "Institutions in the highest 10% of scores.", calculation: "Scores ≥ P90", interpretation: "Highest-risk cohort by the scoring methodology.", whyMatters: "Primary screening focus for potential distress." },
      ],
    },
  ]

  return (
    <section className="mt-12 pt-8 border-t-2 border-slate-300" id="appendix">
      <h2 className="text-xl font-bold text-slate-900 mb-6" style={{ fontFamily: "Georgia, serif" }}>
        Appendix: Metric Definitions and Methodology
      </h2>
      <p className="text-sm text-slate-600 mb-8 leading-relaxed" style={{ fontSize: "11pt" }}>
        The following definitions apply to all metrics used in this report. Source: FDIC call reports (latest available quarter).
      </p>
      {metrics.map(({ section, items }) => (
        <div key={section} className="mb-10">
          <h3 className="text-base font-bold text-slate-800 mb-4 pb-2 border-b border-slate-200" style={{ fontSize: "11pt" }}>
            {section}
          </h3>
          <div className="space-y-6">
            {items.map((item) => (
              <div key={item.name} className="space-y-2">
                <p className="font-bold text-slate-800" style={{ fontSize: "11pt" }}>{item.name}</p>
                <p className="text-slate-700" style={{ fontSize: "11pt" }}>
                  <strong>Definition:</strong> {item.definition}
                </p>
                <p className="text-slate-700" style={{ fontSize: "11pt" }}>
                  <strong>Calculation:</strong> {item.calculation}
                </p>
                <p className="text-slate-700" style={{ fontSize: "11pt" }}>
                  <strong>Interpretation:</strong> {item.interpretation}
                </p>
                <p className="text-slate-700" style={{ fontSize: "11pt" }}>
                  <strong>Why It Matters:</strong> {item.whyMatters}
                </p>
                <hr className="border-slate-200 my-4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
