"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export type MetricDefRich = {
  definition: string
  howCalculated?: string
  whyValuable?: string
}

export type MetricDef = string | MetricDefRich

export const METRIC_DEFINITIONS: Record<string, MetricDef> = {
  Institution: {
    definition: "FDIC-insured bank or institution name.",
    whyValuable: "Identifies the bank for comparison and screening.",
  },
  State: {
    definition: "State where the institution is chartered.",
    whyValuable: "Enables geographic filtering and regional analysis.",
  },
  Report: {
    definition: "FDIC report date (quarter).",
    whyValuable: "Indicates data vintage for time-series comparison.",
  },
  "Total Assets": {
    definition: "Total assets for the latest quarter (in dollars).",
    howCalculated: "Sum of all assets from FDIC Call Report (Schedule RC).",
    whyValuable: "Scales institution size for peer comparison and exposure analysis.",
  },
  "Total Loans": {
    definition: "Net loans and leases (in dollars). FDIC LNLSNET.",
    howCalculated: "Total loans and leases net of unearned income (FDIC LNLSNET, thousands × 1000).",
    whyValuable: "Dollar value of loan book; used as denominator for NPL ratio and reserve coverage.",
  },
  "CRE Concentration": {
    definition: "CRE loans as a share of total loans.",
    howCalculated: "CRE loans ÷ total loans × 100.",
    whyValuable: "Flags banks with elevated commercial real estate exposure relative to loan book size.",
  },
  "NPL ($)": {
    definition: "Dollar amount of nonaccrual loans and leases.",
    howCalculated: "FDIC NALNLS (nonaccrual loans, thousands × 1000).",
    whyValuable: "Absolute dollar exposure to nonperforming loans; complements NPL ratio for sizing credit stress.",
  },
  "NPL Ratio": {
    definition: "Nonaccrual loans and leases as a share of total loans and leases.",
    howCalculated: "Nonaccrual loans ÷ total loans × 100. FDIC NPL metric.",
    whyValuable: "Measures current credit stress; rising NPL suggests deteriorating loan quality.",
  },
  "CRE Loans": {
    definition: "Total commercial real estate loans (dollars).",
    howCalculated: "Sum of construction, multifamily, non-residential, and other real estate loans (FDIC Schedule RC).",
    whyValuable: "Absolute CRE exposure; used as denominator for CRE concentration and earnings buffer.",
  },
  "Capital": {
    definition: "The capital ratio used: CET1 when available; otherwise Leverage.",
    howCalculated: "CET1 if reported; else Leverage ratio (Tier 1 ÷ assets).",
    whyValuable: "Ensures consistent capital comparison across institutions with different reporting.",
  },
  "ROA": {
    definition: "Return on assets. Net income as a share of total assets.",
    howCalculated: "Net income ÷ total assets × 100 (FDIC ROA).",
    whyValuable: "Profitability per dollar of assets; low or negative ROA weakens loss-absorption capacity.",
  },
  "NIM": {
    definition: "Net interest margin. Core spread on lending.",
    howCalculated: "Net interest income ÷ average earning assets × 100 (FDIC NIMR).",
    whyValuable: "Compressed NIM limits earnings capacity; declining NIM suggests margin pressure.",
  },
  "Earnings Buffer": {
    definition: "Net income (TTM) divided by CRE loans. Measures earnings cushion relative to CRE exposure.",
    howCalculated: "Net Income (TTM) ÷ CRE loans × 100.",
    whyValuable: "How much annual profit covers CRE book; thin buffer means less cushion if CRE losses materialize.",
  },
  "Construction / Capital": {
    definition: "Construction and land development loans divided by Tier 1 + Tier 2 capital.",
    howCalculated: "Construction & land development loans ÷ (Tier 1 + Tier 2 capital).",
    whyValuable: "Construction loans are typically riskier; high ratio signals concentration in development.",
  },
  "Multifamily / Capital": {
    definition: "Multifamily real estate loans divided by Tier 1 + Tier 2 capital.",
    howCalculated: "Multifamily loans ÷ (Tier 1 + Tier 2 capital).",
    whyValuable: "Multifamily exposure relative to capital; often more stable than construction.",
  },
  "Noncurrent Loan Ratio": {
    definition: "Noncurrent loans and leases as a percent of gross loans and leases.",
    howCalculated: "Past due 90+ days plus nonaccrual ÷ gross loans × 100 (FDIC NCLNLSR).",
    whyValuable: "Measures delinquency severity; higher noncurrent ratio indicates elevated credit stress.",
  },
  "Noncurrent / Loans": {
    definition: "Noncurrent loans and leases as a percent of gross loans and leases (FDIC NCLNLSR). Past due 90+ plus nonaccrual.",
    howCalculated: "Past due 90+ days plus nonaccrual ÷ gross loans × 100. Used for Structural Opportunity Score nplScore.",
    whyValuable: "True NPL ratio; anchors credit stress to the loan book. Higher values indicate elevated delinquency.",
  },
  "Past Due 30-89 / Assets": {
    definition: "Loans past due 30–89 days as a percent of total assets (FDIC P3ASSET).",
    howCalculated: "Past due 30–89 days ÷ total assets × 100.",
    whyValuable: "Early delinquency indicator; rising values may precede noncurrent migration.",
  },
  "Past Due 90+ / Assets": {
    definition: "Loans past due 90+ days as a percent of total assets (FDIC P9ASSET).",
    howCalculated: "Past due 90+ days ÷ total assets × 100.",
    whyValuable: "Part of noncurrent definition; elevated values signal credit stress.",
  },
  "Noncurrent ($)": {
    definition: "Dollar amount of noncurrent loans and leases (past due 90+ plus nonaccrual).",
    howCalculated: "Derived: Noncurrent / Loans ratio × Total loans (NCLNLSR × LNLSNET).",
    whyValuable: "Absolute dollar exposure; complements NPL ($) which is nonaccrual only.",
  },
  "Noncurrent / Assets": {
    definition: "Noncurrent loans and leases as a percent of total assets (FDIC NCLNLS). Past due 90+ plus nonaccrual.",
    howCalculated: "Past due 90+ days plus nonaccrual ÷ total assets × 100. Display only; not used in scoring.",
    whyValuable: "Context metric for noncurrent exposure relative to balance sheet size. Complements Noncurrent / Loans.",
  },
  "Reserve Coverage": {
    definition: "Loan loss allowance as a share of total loans.",
    howCalculated: "Allowance for loan and lease losses ÷ total loans × 100 (FDIC LNLSDEPR).",
    whyValuable: "Indicates cushion for future losses; thin reserves relative to NPLs signal vulnerability.",
  },
  CET1: {
    definition: "Common Equity Tier 1 capital ratio.",
    howCalculated: "CET1 capital ÷ risk-weighted assets × 100 (FDIC RBCT1CER).",
    whyValuable: "Core measure of loss-absorbing capacity; regulatory minimum is 4.5%.",
  },
  Leverage: {
    definition: "Leverage ratio (PCA).",
    howCalculated: "Tier 1 capital ÷ average total consolidated assets × 100 (FDIC RBC1AAJ).",
    whyValuable: "Simpler capital measure; used when CET1 is unavailable.",
  },
  "Capital Used": {
    definition: "The capital ratio used by the score: CET1 when available; otherwise Leverage.",
    howCalculated: "CET1 if reported; else Leverage ratio.",
    whyValuable: "Ensures consistent capital comparison across institutions with different reporting.",
  },
  "CRE / Capital": {
    definition: "Commercial real estate loans divided by Tier 1 + Tier 2 capital.",
    howCalculated: "CRE loans ÷ (Tier 1 + Tier 2 capital). Capital from FDIC total RBC ratio when available; otherwise from leverage ratio.",
    whyValuable: "Shows how many times CRE exposure could be covered by regulatory capital.",
  },
  "CRE / (T1+T2)": {
    definition: "Commercial real estate loans divided by Tier 1 + Tier 2 capital.",
    howCalculated: "CRE loans ÷ (Tier 1 + Tier 2 capital). Capital from FDIC total RBC ratio when available; otherwise from leverage ratio.",
    whyValuable: "Shows how many times CRE exposure could be covered by regulatory capital.",
  },
  "CRE / Equity": {
    definition: "Commercial real estate loans divided by total equity.",
    howCalculated: "CRE loans ÷ total equity (EQCAP when available; otherwise derived from capital ratios).",
    whyValuable: "Measures CRE exposure relative to book equity cushion.",
  },
  "Const / (T1+T2)": {
    definition: "Construction and land development loans divided by Tier 1 + Tier 2 capital.",
    howCalculated: "Construction & land development loans ÷ (Tier 1 + Tier 2 capital).",
    whyValuable: "Construction loans are typically riskier; high ratio signals concentration in development.",
  },
  "MF / (T1+T2)": {
    definition: "Multifamily real estate loans divided by Tier 1 + Tier 2 capital.",
    howCalculated: "Multifamily loans ÷ (Tier 1 + Tier 2 capital).",
    whyValuable: "Multifamily exposure relative to capital; often more stable than construction.",
  },
  "ROA (Latest)": {
    definition: "Return on assets for the latest quarter. Net income as a share of total assets.",
    howCalculated: "Net income ÷ total assets × 100 (FDIC ROA).",
    whyValuable: "Profitability per dollar of assets; low or negative ROA weakens loss-absorption capacity.",
  },
  "ROA Δ (4Q)": {
    definition: "Change in ROA versus 4 quarters ago (percentage points).",
    howCalculated: "ROA (latest) − ROA (4 quarters ago).",
    whyValuable: "Trend in profitability; declining ROA suggests earnings pressure.",
  },
  "Net Income (TTM)": {
    definition: "Trailing twelve months net income (sum of last 4 quarters).",
    howCalculated: "Sum of net income for the last four quarters.",
    whyValuable: "Annual earnings level; used for earnings buffer and YoY comparison.",
  },
  "Net Income YoY %": {
    definition: "Year-over-year change in trailing twelve months net income (%).",
    howCalculated: "(NI TTM current − NI TTM prior year) ÷ |NI TTM prior year| × 100.",
    whyValuable: "Earnings trend; declining NI signals weakening profitability.",
  },
  "NIM (Latest)": {
    definition: "Net interest margin for the latest quarter.",
    howCalculated: "Net interest income ÷ average earning assets × 100 (FDIC NIMR).",
    whyValuable: "Core spread on lending; compressed NIM limits earnings capacity.",
  },
  "NIM Δ (4Q)": {
    definition: "Change in NIM versus 4 quarters ago (percentage points).",
    howCalculated: "NIM (latest) − NIM (4 quarters ago).",
    whyValuable: "Trend in interest margin; declining NIM suggests margin pressure.",
  },
  "Earnings Buffer %": {
    definition: "Net income (TTM) divided by CRE loans. Measures earnings cushion relative to CRE exposure.",
    howCalculated: "Net Income (TTM) ÷ CRE loans × 100.",
    whyValuable: "How much annual profit covers CRE book; thin buffer means less cushion if CRE losses materialize.",
  },
  "Structural Opportunity Score": {
    definition: "A 0–100 score that flags banks whose loan books and financial health show early warning signs. Higher scores mean more loans in commercial real estate, more delinquent loans, and thinner safety cushions.",
    howCalculated: "Weighted combination of CRE concentration (35%), NPL from noncurrent-to-loans (35%), reserve coverage (15%), and capital (15%). All values scaled 0–100 within the cohort.",
    whyValuable: "Surfaces banks that may need closer attention because of concentrated real estate exposure and weakening credit quality compared to peers.",
  },
  "Earnings Resilience Score": {
    definition: "A 0–100 score measuring how much profit a bank makes and whether it's growing. Higher scores mean the bank earns more relative to its size and has a bigger cushion of income to absorb losses if loans go bad.",
    howCalculated: "Weighted combination of earnings buffer (40%), ROA (25%), net income YoY (20%), ROA change (15%). Min-max normalized within cohort.",
    whyValuable: "Identifies banks with strong earnings capacity to absorb CRE stress versus those with thin profit cushions.",
  },
  "Composite Vulnerability Score": {
    definition: "A 0–100 score combining structural risk (exposure and weak credit) with earnings strength. Higher scores mean risky exposure without enough profit to cushion it; lower scores mean either safer exposure or strong earnings that offset risk.",
    howCalculated: "Structural score × (1 − (Earnings score ÷ 100) × 0.4). Clamped to 0–100.",
    whyValuable: "Prioritizes banks where high CRE/credit risk is not offset by earnings—the most vulnerable combination.",
  },
  "CRE Mix": {
    definition: "Construction, multifamily, and non-residential loans shown as a share of total CRE.",
    howCalculated: "Each segment ÷ total CRE loans × 100.",
    whyValuable: "Reveals portfolio composition; construction-heavy mix is typically riskier than multifamily.",
  },
  "CRE Concentration (4Q)": {
    definition: "Quarter-by-quarter CRE concentration for the last 4 quarters.",
    howCalculated: "CRE loans ÷ total loans × 100 for each of the last 4 quarters.",
    whyValuable: "Shows trend in CRE exposure over time; rising concentration may signal increasing risk.",
  },
  "NPL Ratio (4Q)": {
    definition: "Quarter-by-quarter NPL ratio for the last 4 quarters.",
    howCalculated: "Nonaccrual loans ÷ total loans × 100 for each of the last 4 quarters.",
    whyValuable: "Tracks credit quality trend; rising NPL over 4 quarters indicates deterioration.",
  },
  // Legacy / other terms (simple string for backward compatibility)
  Region: "National uses all FDIC institutions. Florida uses Florida-chartered institutions. Miami Metro uses Florida data as a Miami-Dade proxy.",
  "Scenario (CRE Stress Watch)": "Fixed scenario emphasizing CRE concentration and rising credit stress (capital/reserves may be inverted depending on the component).",
  "Institutions Screened": "Count of unique banks with a latest-quarter record in the selected region.",
  "Institutions in Top 10": "Count of institutions in the top 10 by opportunity score.",
  "Avg NPL Ratio": "Average of nonaccrual loans & leases divided by total loans & leases.",
  "Avg Noncurrent Loan Ratio": "Average noncurrent loans (past due 90+ plus nonaccrual) as a share of gross loans.",
  "Avg Noncurrent / Loans": "Average noncurrent loans (past due 90+ plus nonaccrual) as a share of gross loans (FDIC NCLNLSR).",
  "Avg Noncurrent / Assets": "Average noncurrent loans (past due 90+ plus nonaccrual) as a share of total assets (FDIC NCLNLS).",
  "Avg Reserve Coverage": "Average loan loss reserve ratio (allowance relative to loans).",
  "Avg CRE Concentration": "Average CRE loans divided by total loans.",
  "Tier 1 Capital": "Core capital—common equity, retained earnings, qualifying preferred stock. Highest-quality capital that absorbs losses first. FDIC derives from leverage ratio when direct values unavailable.",
  "Tier 2 Capital": "Supplementary capital—subordinated debt, loan loss reserves, hybrid instruments. Secondary capital providing additional loss absorption. FDIC derives Tier 1 + Tier 2 from total risk-based capital ratio.",
  "CRE / (Tier1 + Tier2)": "Commercial real estate loans divided by Tier 1 + Tier 2 capital. Capital derived from FDIC total RBC ratio when available; otherwise from leverage ratio.",
  "Construction / (Tier1 + Tier2)": "Construction & land development loans divided by Tier 1 + Tier 2 capital.",
  "Multifamily / (Tier1 + Tier2)": "Multifamily real estate loans divided by Tier 1 + Tier 2 capital.",
  "Opportunity Score": "Weighted score (0–100) combining CRE concentration, NPL ratio, noncurrent loan ratio, reserve coverage, and capital strength under the selected scenario.",
  "Rising NPL (4Q)": "Count of Top 10 institutions where NPL ratio increased over 4 quarters.",
  "CRE / Assets": {
    definition: "CRE loans as a percent of total assets.",
    howCalculated: "CRE loans ÷ total assets × 100. Distinct from CRE Concentration (CRE/loans).",
    whyValuable: "Measures CRE exposure relative to balance sheet size; complements CRE/loans for concentration analysis.",
  },
  "Coverage %": "Share of banks with capital data available for CRE-to-capital ratios.",
  "Opportunity Score Distribution": "Distribution of Opportunity Scores across the screened cohort. Higher scores indicate elevated CRE exposure and credit stress.",
  "Median Opportunity Score": "The 50th percentile (median) of Opportunity Scores in the cohort.",
  "Upper-Tail Threshold (P90)": "90th percentile of Opportunity Scores. Institutions above this threshold are in the top decile.",
  "Score Range": "Minimum to maximum Opportunity Score in the cohort.",
  "High-Score Share (≥80)": "Percentage of institutions with Opportunity Score of 80 or higher.",
  IQR: "Interquartile range (P75 minus P25). Measures spread of the middle 50% of scores.",
  "Dominant Band": "The 10-point score band (e.g. 20–30) containing the most institutions.",
  "Bank Count": {
    definition: "Number of banks in the aggregation.",
    whyValuable: "Indicates cohort size for weighted averages and coverage.",
  },
  "Total CRE Loans": {
    definition: "Total commercial real estate loans (dollars).",
    howCalculated: "Sum of CRE loans across institutions in the group.",
    whyValuable: "Absolute exposure level for the cohort.",
  },
  "Total Construction": {
    definition: "Total construction and land development loans (dollars).",
    howCalculated: "Sum of construction & land development loans across institutions.",
    whyValuable: "Construction exposure is typically riskier; high totals signal concentration.",
  },
  "Total Multifamily": {
    definition: "Total multifamily real estate loans (dollars).",
    howCalculated: "Sum of multifamily loans across institutions.",
    whyValuable: "Multifamily exposure; often more stable than construction.",
  },
  "Total Non-Residential": {
    definition: "Total nonfarm nonresidential real estate loans (dollars)—office, retail, industrial, etc.",
    howCalculated: "Sum of non-residential loans (FDIC LNRENRES) across institutions.",
    whyValuable: "Non-residential CRE (office, retail, industrial) exposure. Total CRE = Construction + Multifamily + Non-Residential + Other.",
  },
  "Total Other Real Estate": {
    definition: "All other loans secured by real estate (FDIC LNREOTH / RCFD5371)—unclassified CRE and other real estate–secured loans.",
    howCalculated: "Sum of other real estate loans (FDIC LNREOTH) across institutions.",
    whyValuable: "Captures unclassified commercial real estate and other real estate–secured loans not in construction, multifamily, or non-residential. Total CRE = Construction + Multifamily + Non-Residential + Other.",
  },
  "Total Unused Commitments": {
    definition: "Unused loan commitments (Schedule RC-L).",
    howCalculated: "FDIC UCLN field—unused portions of commitments to make or purchase loans.",
    whyValuable: "Off-balance-sheet credit exposure; potential future loan draws.",
  },
  "Unused Commitments (CRE)": {
    definition: "Unused commitments for commercial real estate, construction, and land development (Schedule RC-L).",
    howCalculated: "FDIC UCCOMRE field—unused CRE commitments (construction, multifamily, non-residential, etc.).",
    whyValuable: "CRE-specific off-balance-sheet exposure; complements funded CRE loans.",
  },
  "Weighted Avg CRE / Assets": {
    definition: "Asset-weighted average of CRE loans as a share of total assets.",
    howCalculated: "Sum(CRE loans × total assets) ÷ Sum(total assets²) × 100, or equivalent asset-weighted mean.",
    whyValuable: "Represents typical CRE concentration when larger banks count more.",
  },
  "Weighted Avg CRE / (T1+T2)": {
    definition: "Asset-weighted average of CRE-to-capital ratio.",
    howCalculated: "Sum(CRE-to-capital × total assets) ÷ Sum(total assets) for institutions with capital data.",
    whyValuable: "Typical capital-adjusted CRE exposure for the cohort.",
  },
  "Weighted Avg CRE / Capital": {
    definition: "Asset-weighted average of CRE-to-capital ratio.",
    howCalculated: "Sum(CRE-to-capital × total assets) ÷ Sum(total assets) for institutions with capital data.",
    whyValuable: "Typical capital-adjusted CRE exposure for the cohort.",
  },
  "Weighted Avg NPL": {
    definition: "Asset-weighted average nonperforming loan ratio.",
    howCalculated: "Sum(NPL ratio × total assets) ÷ Sum(total assets).",
    whyValuable: "Typical credit stress when larger banks count more.",
  },
  Bank: {
    definition: "FDIC-insured institution name.",
    whyValuable: "Identifies the bank for comparison and screening.",
  },
  City: {
    definition: "City where the institution is headquartered.",
    whyValuable: "Enables geographic filtering and local market analysis.",
  },
  "City, State": {
    definition: "City and state where the institution is headquartered.",
    howCalculated: "FDIC HQ city and state (RSSD state code).",
    whyValuable: "Enables geographic filtering and regional comparison.",
  },
  "Total UC": {
    definition: "Unused loan commitments (Schedule RC-L).",
    howCalculated: "FDIC UCLN field—unused portions of commitments to make or purchase loans.",
    whyValuable: "Off-balance-sheet credit exposure; potential future loan draws.",
  },
  "CRE UC": {
    definition: "Unused commitments for commercial real estate, construction, and land development (Schedule RC-L).",
    howCalculated: "FDIC UCCOMRE field—unused CRE commitments.",
    whyValuable: "CRE-specific off-balance-sheet exposure; complements funded CRE loans.",
  },
  "Net Income": {
    definition: "Trailing twelve months net income (sum of last 4 quarters).",
    howCalculated: "Sum of net income for the last four quarters.",
    whyValuable: "Annual earnings level; used for earnings buffer and peer percentile ranking.",
  },
  "NI YoY %": {
    definition: "Year-over-year change in trailing twelve months net income (%).",
    howCalculated: "(NI TTM current − NI TTM prior year) ÷ |NI TTM prior year| × 100.",
    whyValuable: "Earnings trend; declining NI signals weakening profitability.",
  },
  "CRE/(T1+T2)": {
    definition: "Commercial real estate loans divided by Tier 1 + Tier 2 capital.",
    howCalculated: "CRE loans ÷ (Tier 1 + Tier 2 capital). Capital from FDIC total RBC ratio when available.",
    whyValuable: "Shows how many times CRE exposure could be covered by regulatory capital.",
  },
  NPL: {
    definition: "Nonaccrual loans and leases as a share of total loans and leases.",
    howCalculated: "Nonaccrual loans ÷ total loans × 100.",
    whyValuable: "Measures current credit stress; rising NPL suggests deteriorating loan quality.",
  },
  Score: {
    definition: "Structural Opportunity Score (0–100).",
    howCalculated: "Weighted combination of CRE concentration (35%), NPL from noncurrent-to-loans (35%), reserves (15%), and capital (15%). Scaled within cohort.",
    whyValuable: "Surfaces banks with elevated CRE exposure and credit stress compared to peers.",
  },
  "T1+T2": {
    definition: "Tier 1 plus Tier 2 capital (dollars).",
    howCalculated: "Derived from FDIC total risk-based capital ratio or leverage ratio when direct values unavailable.",
    whyValuable: "Regulatory capital base for CRE-to-capital ratios.",
  },
}

function isRichDef(def: MetricDef): def is MetricDefRich {
  return typeof def === "object" && def !== null && "definition" in def
}

export function DefTerm({
  term,
  children,
  customTrigger,
}: { term: string; children: React.ReactNode; customTrigger?: boolean }) {
  const def = METRIC_DEFINITIONS[term]
  if (!def) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {customTrigger ? (
          children
        ) : (
          <span className="cursor-help border-b border-dashed border-muted-foreground/50">{children}</span>
        )}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className={isRichDef(def) ? "w-96 max-w-[90vw] text-left font-normal break-words" : "max-w-sm text-left font-normal"}
        sideOffset={6}
      >
        {isRichDef(def) ? (
          <div className="space-y-2 text-sm">
            <p><strong>Definition:</strong> {def.definition}</p>
            {def.howCalculated != null && def.howCalculated !== "" && (
              <p><strong>How it is calculated:</strong> {def.howCalculated}</p>
            )}
            {def.whyValuable != null && def.whyValuable !== "" && (
              <p><strong>Why it is valuable:</strong> {def.whyValuable}</p>
            )}
          </div>
        ) : (
          def
        )}
      </TooltipContent>
    </Tooltip>
  )
}
