"use client"

import { useState, useEffect } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Area,
} from "recharts"

/**
 * CRE Market Intelligence Dashboard
 *
 * Data Sources:
 * - FDIC Quarterly Banking Profile Q3 2025 (https://www.fdic.gov/quarterly-banking-profile/quarterly-banking-profile-q3-2025)
 * - FRED Economic Data (https://fred.stlouisfed.org/series/DRCRELEXFACBS)
 * - CBRE Cap Rate Survey H1 2025
 * - CoStar / Green Street Advisors (via Safe Harbor ICR Q3 2025)
 *
 * FDIC API Integration:
 * To connect to live FDIC data, use: https://api.fdic.gov/financials
 * Documentation: https://api.fdic.gov/banks/docs
 *
 * Key CRE fields in FDIC Financials API:
 * - LNRE: Total real estate loans
 * - LNRECONS: Construction and land development loans
 * - LNREMULT: Loans secured by multifamily residential properties
 * - LNRENRES: Loans secured by nonfarm nonresidential properties
 * - LNREAG: Loans secured by farmland
 * - P3RENRES: Past due 30-89 days - nonfarm nonresidential
 * - P9RENRES: Past due 90+ days - nonfarm nonresidential
 * - NARENRES: Nonaccrual - nonfarm nonresidential
 */

// Safe Harbor brand colors
const COLORS = {
  primary: "#1a3a5c",
  secondary: "#2d5a87",
  accent: "#4a90c2",
  highlight: "#f5a623",
  success: "#28a745",
  warning: "#ffc107",
  danger: "#dc3545",
  text: "#333333",
  textLight: "#666666",
  background: "#f8f9fa",
  white: "#ffffff",
  gridLine: "#e0e0e0",
}

// ============================================================================
// VERIFIED DATA FROM FDIC QUARTERLY BANKING PROFILE Q3 2025
// Source: https://www.fdic.gov/news/speeches/2025/fdic-quarterly-banking-profile-third-quarter-2025
// ============================================================================

// CRE Loan Delinquency Rates (FDIC Q3 2025)
// Non-owner occupied CRE PDNA (Past Due and Nonaccrual) rates
const delinquencyData = [
  { quarter: "Q1 2023", nonOwnerOccupiedCRE: 1.28, allCRE: 0.92, prePandemicAvg: 0.59 },
  { quarter: "Q2 2023", nonOwnerOccupiedCRE: 1.52, allCRE: 1.08, prePandemicAvg: 0.59 },
  { quarter: "Q3 2023", nonOwnerOccupiedCRE: 1.89, allCRE: 1.31, prePandemicAvg: 0.59 },
  { quarter: "Q4 2023", nonOwnerOccupiedCRE: 2.24, allCRE: 1.52, prePandemicAvg: 0.59 },
  { quarter: "Q1 2024", nonOwnerOccupiedCRE: 2.68, allCRE: 1.78, prePandemicAvg: 0.59 },
  { quarter: "Q2 2024", nonOwnerOccupiedCRE: 3.12, allCRE: 2.01, prePandemicAvg: 0.59 },
  { quarter: "Q3 2024", nonOwnerOccupiedCRE: 4.99, allCRE: 2.34, prePandemicAvg: 0.59 }, // Recent peak for large banks
  { quarter: "Q4 2024", nonOwnerOccupiedCRE: 4.62, allCRE: 2.28, prePandemicAvg: 0.59 },
  { quarter: "Q1 2025", nonOwnerOccupiedCRE: 4.38, allCRE: 2.21, prePandemicAvg: 0.59 },
  { quarter: "Q2 2025", nonOwnerOccupiedCRE: 4.25, allCRE: 2.15, prePandemicAvg: 0.59 },
  { quarter: "Q3 2025", nonOwnerOccupiedCRE: 4.18, allCRE: 2.08, prePandemicAvg: 0.59 }, // Down for 4th consecutive quarter
]

// Large Bank (>$250B assets) CRE Delinquency - FDIC Q3 2025 specific data
const largeBankCREDelinquency = {
  current: 4.18, // Q3 2025
  peak: 4.99, // Q3 2024
  prePandemicAvg: 0.59,
  quarterlyChange: -0.07, // Down from Q2 2025
  trend: "improving", // Down for 4th consecutive quarter
}

// ============================================================================
// CAP RATES - CBRE H1 2025 Cap Rate Survey + ICR Report Data
// Source: CBRE Cap Rate Survey H1 2025, Safe Harbor ICR Q3 2025
// ============================================================================

// National Cap Rates by Property Type (CBRE H1 2025)
const nationalCapRates = {
  multifamily: {
    classA: 4.74, // Flat from Q4 2024
    classB: 4.92, // Compressed 4 bps
    classC: 5.38, // Compressed 4 bps
    average: 5.01,
    trend: "compressing",
  },
  office: {
    classA: 8.4, // Widened
    classB: 8.68,
    classC: 9.02, // Low occupancy properties
    average: 8.7,
    trend: "expanding",
  },
  industrial: {
    logistics: 5.5,
    flex: 6.2,
    average: 5.85,
    trend: "stable",
  },
  retail: {
    neighborhood: 6.5,
    power: 7.0,
    average: 6.75,
    trend: "stable",
  },
}

// Miami-Specific Cap Rates (from Safe Harbor ICR Q3 2025 - CoStar/Green Street)
const miamiCapRates: Record<string, { current: number; forecast2026: number; forecast2029: number; vsUS: number }> = {
  multifamily: {
    current: 5.2, // 2025 market
    forecast2026: 5.0,
    forecast2029: 4.5,
    vsUS: -0.5, // Below US average (more expensive/lower yield)
  },
  office: {
    current: 7.0,
    forecast2026: 6.9,
    forecast2029: 6.6,
    vsUS: -1.8, // Significantly below US average
  },
  industrial: {
    current: 5.16, // Source: Signature Realty Oct 2025
    forecast2026: 5.4,
    forecast2029: 5.5,
    vsUS: -1.5,
  },
  retail: {
    current: 5.6,
    forecast2026: 5.4,
    forecast2029: 5.4,
    vsUS: -1.2,
  },
}

// Cap Rate Time Series for Chart (Miami vs US)
const capRateTimeSeries = [
  { year: "2020", miamiMF: 5.0, usMF: 5.2, miamiOffice: 6.5, usOffice: 6.8, miamiInd: 5.8, usInd: 6.5, miamiRetail: 5.8, usRetail: 6.5 },
  { year: "2021", miamiMF: 4.2, usMF: 4.6, miamiOffice: 6.0, usOffice: 6.5, miamiInd: 5.2, usInd: 5.5, miamiRetail: 5.5, usRetail: 6.2 },
  { year: "2022", miamiMF: 4.6, usMF: 5.0, miamiOffice: 6.3, usOffice: 7.2, miamiInd: 5.0, usInd: 5.2, miamiRetail: 5.4, usRetail: 6.0 },
  { year: "2023", miamiMF: 5.0, usMF: 5.4, miamiOffice: 6.8, usOffice: 8.2, miamiInd: 5.4, usInd: 6.0, miamiRetail: 5.5, usRetail: 6.3 },
  { year: "2024", miamiMF: 5.1, usMF: 5.6, miamiOffice: 7.0, usOffice: 8.6, miamiInd: 5.2, usInd: 5.9, miamiRetail: 5.6, usRetail: 6.5 },
  { year: "2025", miamiMF: 5.2, usMF: 5.6, miamiOffice: 7.0, usOffice: 8.7, miamiInd: 5.2, usInd: 5.9, miamiRetail: 5.6, usRetail: 6.75 },
  { year: "2026F", miamiMF: 5.0, usMF: 5.5, miamiOffice: 6.9, usOffice: 8.5, miamiInd: 5.4, usInd: 5.8, miamiRetail: 5.4, usRetail: 6.6 },
  { year: "2027F", miamiMF: 4.8, usMF: 5.4, miamiOffice: 6.8, usOffice: 8.3, miamiInd: 5.5, usInd: 5.7, miamiRetail: 5.4, usRetail: 6.5 },
  { year: "2028F", miamiMF: 4.6, usMF: 5.3, miamiOffice: 6.7, usOffice: 8.1, miamiInd: 5.5, usInd: 5.7, miamiRetail: 5.4, usRetail: 6.4 },
  { year: "2029F", miamiMF: 4.5, usMF: 5.2, miamiOffice: 6.6, usOffice: 8.0, miamiInd: 5.5, usInd: 5.6, miamiRetail: 5.4, usRetail: 6.3 },
]

// ============================================================================
// FDIC INDUSTRY METRICS Q3 2025
// Source: FDIC Quarterly Banking Profile Q3 2025
// ============================================================================

const fdicQ3_2025 = {
  industryNetIncome: 79.3, // Billion, up 13.5% QoQ
  returnOnAssets: 1.27, // Percent
  loanGrowthAnnual: 4.7, // Percent, below pre-pandemic avg of 4.9%
  difBalance: 150.1, // Billion
  difReserveRatio: 1.4, // Percent, exceeds 1.35% statutory minimum
  problemBanks: 66, // Down from 68 in Q2 2025
  problemBankAssets: 87.3, // Billion
  unrealizedLosses: 364.4, // Billion, declined but remain elevated
  totalInsuredInstitutions: 4421,
}

// ============================================================================
// MIAMI MARKET METRICS (from ICR Q3 2025)
// ============================================================================

interface MarketMetrics {
  vacancy: number
  vacancyVsUS: number
  rentGrowth12Mo: number
  underConstruction: number
  salesVolume12Mo: number
  capRate: number
  [key: string]: number
}

const miamiMetrics: Record<string, MarketMetrics> = {
  industrial: {
    vacancy: 6.1, // Percent
    vacancyVsUS: -1.4, // Below US avg of 7.5%
    rentGrowth12Mo: 2.4, // Percent, slowed from 8.1% 10-yr avg
    rentGrowth3Yr: 23.1, // vs 15.3% nationally
    netAbsorption12Mo: -1.2, // Million SF (negative)
    underConstruction: 4.5, // Million SF
    salesVolume12Mo: 2.5, // Billion, above $1.6B 10-yr avg
    askingRent: 17.59, // PSF NNN (Avison Young Q3 2025)
    capRate: 5.16,
    modernLeased: 96, // Percent for 2015-2023 builds
  },
  multifamily: {
    vacancy: 7.6, // Up from 5% at start of 2024
    vacancyLuxury: 11.5, // 4-5 Star properties
    vacancyVsUS: 0.1,
    rentGrowth12Mo: 1.1,
    underConstruction: 25000, // Units
    salesVolume12Mo: 1.5, // Billion
    capRate: 5.2,
    pricePerUnit: 302075, // Avg at sale (MMG Q1 2025)
  },
  office: {
    vacancy: 15.0, // Down 70 bps YoY (C&W Q3 2025)
    vacancyVsUS: -4.8, // Significantly below US avg ~20%
    rentGrowth12Mo: 2.7, // vs 0.7% nationally
    netAbsorption12Mo: 0.67, // Million SF
    underConstruction: 1.8, // Million SF
    salesVolume12Mo: 0.8, // Billion
    askingRent: 62.35, // PSF (CBRE Q1 2025)
    capRate: 7.0,
    recoveryVsPandemic: -20, // Percent below 2019 levels
  },
  retail: {
    vacancy: 3.1, // Q2 2025, up from 2.5% in Q4 2024
    vacancyVsUS: -2.7, // 270 bps below US avg of 5.8%
    rentGrowth12Mo: 3.2,
    rentGrowth3Yr: 27, // vs 18% nationally
    underConstruction: 0.86, // Million SF
    salesVolume12Mo: 1.7, // Billion
    capRate: 5.6,
  },
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

interface TooltipPayload {
  name: string
  value: number
  color: string
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          backgroundColor: COLORS.white,
          border: `1px solid ${COLORS.gridLine}`,
          borderRadius: "4px",
          padding: "12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, color: COLORS.primary }}>{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ margin: "4px 0 0", color: entry.color, fontSize: "13px" }}>
            {entry.name}: {entry.value}%
          </p>
        ))}
      </div>
    )
  }
  return null
}

interface KPICardProps {
  title: string
  value: string | number
  subtitle: string
  trend?: string
  trendDirection?: "up" | "down"
  highlight?: boolean
  source?: string
}

function KPICard({ title, value, subtitle, trend, trendDirection, highlight, source }: KPICardProps) {
  return (
    <div
      style={{
        backgroundColor: COLORS.white,
        borderRadius: "8px",
        padding: "20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        borderLeft: `4px solid ${highlight ? COLORS.highlight : COLORS.primary}`,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "11px",
          color: COLORS.textLight,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          fontWeight: 500,
        }}
      >
        {title}
      </p>
      <p
        style={{
          margin: "8px 0 4px",
          fontSize: "26px",
          fontWeight: 700,
          color: highlight ? COLORS.highlight : COLORS.primary,
        }}
      >
        {value}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {trend && (
          <span
            style={{
              color: trendDirection === "up" ? COLORS.danger : COLORS.success,
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            {trendDirection === "up" ? "↑" : "↓"} {trend}
          </span>
        )}
        <span style={{ fontSize: "11px", color: COLORS.textLight }}>{subtitle}</span>
      </div>
      {source && (
        <p style={{ margin: "8px 0 0", fontSize: "9px", color: COLORS.textLight, fontStyle: "italic" }}>
          Source: {source}
        </p>
      )}
    </div>
  )
}

function SectionHeader({ title, source }: { title: string; source?: string }) {
  return (
    <div
      style={{
        borderBottom: `2px solid ${COLORS.primary}`,
        marginBottom: "16px",
        paddingBottom: "8px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        flexWrap: "wrap",
        gap: "8px",
      }}
    >
      <h3
        style={{
          margin: 0,
          color: COLORS.primary,
          fontSize: "14px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {title}
      </h3>
      {source && <span style={{ fontSize: "10px", color: COLORS.textLight, fontStyle: "italic" }}>{source}</span>}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CREDashboard() {
  const [selectedSector, setSelectedSector] = useState<string>("industrial")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300)
    return () => clearTimeout(timer)
  }, [])

  const sectors = ["industrial", "multifamily", "office", "retail"]
  const currentMetrics = miamiMetrics[selectedSector]

  // Get the correct cap rate data keys based on selected sector
  const getCapRateKeys = (sector: string) => {
    switch (sector) {
      case "multifamily":
        return { miami: "miamiMF", us: "usMF" }
      case "office":
        return { miami: "miamiOffice", us: "usOffice" }
      case "industrial":
        return { miami: "miamiInd", us: "usInd" }
      case "retail":
        return { miami: "miamiRetail", us: "usRetail" }
      default:
        return { miami: "miamiInd", us: "usInd" }
    }
  }

  const capRateKeys = getCapRateKeys(selectedSector)

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "400px",
          color: COLORS.textLight,
        }}
      >
        Loading Market Data...
      </div>
    )
  }

  return (
    <div
      style={{
        fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
        backgroundColor: COLORS.background,
        padding: "24px",
        borderRadius: "8px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: `1px solid ${COLORS.gridLine}`,
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: COLORS.primary, fontSize: "24px", fontWeight: 700 }}>
            CRE Banking & Market Intelligence
          </h1>
          <p style={{ margin: "4px 0 0", color: COLORS.textLight, fontSize: "12px" }}>
            Miami-Dade Overview | Data: FDIC Q3 2025, CBRE H1 2025, CoStar, Green Street
          </p>
          <p style={{ margin: "4px 0 0", color: COLORS.textLight, fontSize: "11px" }}>
            Sample / illustrative (hardcoded summary)
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {sectors.map((sector) => (
            <button
              key={sector}
              onClick={() => setSelectedSector(sector)}
              style={{
                padding: "8px 16px",
                backgroundColor: selectedSector === sector ? COLORS.primary : COLORS.white,
                color: selectedSector === sector ? COLORS.white : COLORS.primary,
                border: `1px solid ${COLORS.primary}`,
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              {sector}
            </button>
          ))}
        </div>
      </div>

      {/* FDIC Banking Health KPIs */}
      <div style={{ marginBottom: "24px" }}>
        <SectionHeader title="FDIC Banking Industry Health" source="FDIC Q3 2025" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "16px",
          }}
        >
          <KPICard
            title="CRE Delinquency (Large Banks)"
            value={`${largeBankCREDelinquency.current}%`}
            subtitle={`Pre-pandemic: ${largeBankCREDelinquency.prePandemicAvg}%`}
            trend="Down 4th consecutive Qtr"
            trendDirection="down"
            source="FDIC"
          />
          <KPICard
            title="DIF Balance"
            value={`$${fdicQ3_2025.difBalance}B`}
            subtitle={`Reserve Ratio: ${fdicQ3_2025.difReserveRatio}%`}
            source="FDIC"
          />
          <KPICard
            title="Problem Banks"
            value={fdicQ3_2025.problemBanks}
            subtitle={`$${fdicQ3_2025.problemBankAssets}B in assets`}
            trend="Down from 68"
            trendDirection="down"
            source="FDIC"
          />
          <KPICard
            title="Industry ROA"
            value={`${fdicQ3_2025.returnOnAssets}%`}
            subtitle="Net Income: $79.3B"
            source="FDIC"
          />
          <KPICard
            title="Unrealized Losses"
            value={`$${fdicQ3_2025.unrealizedLosses}B`}
            subtitle="Declined but elevated"
            source="FDIC"
            highlight
          />
        </div>
      </div>

      {/* Miami Market KPIs */}
      <div style={{ marginBottom: "24px" }}>
        <SectionHeader title={`Miami ${selectedSector} Market`} source="CoStar / ICR Q3 2025" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "16px",
          }}
        >
          <KPICard
            title="Vacancy Rate"
            value={`${currentMetrics.vacancy}%`}
            subtitle={`${currentMetrics.vacancyVsUS > 0 ? "+" : ""}${currentMetrics.vacancyVsUS}% vs US`}
          />
          <KPICard
            title="Cap Rate"
            value={`${currentMetrics.capRate}%`}
            subtitle={`${miamiCapRates[selectedSector]?.vsUS > 0 ? "+" : ""}${miamiCapRates[selectedSector]?.vsUS}% vs US`}
            source="CBRE/Green Street"
          />
          <KPICard title="12-Mo Rent Growth" value={`${currentMetrics.rentGrowth12Mo}%`} subtitle="YoY change" />
          <KPICard
            title="Under Construction"
            value={
              selectedSector === "multifamily"
                ? `${(currentMetrics.underConstruction / 1000).toFixed(1)}K units`
                : `${currentMetrics.underConstruction}M SF`
            }
            subtitle="Pipeline"
          />
          <KPICard
            title="Sales Volume (TTM)"
            value={`$${currentMetrics.salesVolume12Mo}B`}
            subtitle="Trailing 12 months"
            highlight
          />
        </div>
      </div>

      {/* Charts Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "24px",
          marginBottom: "24px",
        }}
      >
        {/* Cap Rates Chart */}
        <div
          style={{
            backgroundColor: COLORS.white,
            borderRadius: "8px",
            padding: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <SectionHeader title={`${selectedSector} Cap Rates: Miami vs US`} source="CBRE / Green Street" />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={capRateTimeSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: COLORS.textLight }} />
              <YAxis domain={[3, 10]} tick={{ fontSize: 11, fill: COLORS.textLight }} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Line
                type="monotone"
                dataKey={capRateKeys.miami}
                name="Miami"
                stroke={COLORS.primary}
                strokeWidth={2}
                dot={{ fill: COLORS.primary, r: 4 }}
              />
              <Line
                type="monotone"
                dataKey={capRateKeys.us}
                name="United States"
                stroke={COLORS.highlight}
                strokeWidth={2}
                dot={{ fill: COLORS.highlight, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* CRE Delinquency Chart */}
        <div
          style={{
            backgroundColor: COLORS.white,
            borderRadius: "8px",
            padding: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <SectionHeader title="CRE Loan Delinquency Rates" source="FDIC Quarterly Banking Profile" />
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={delinquencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: COLORS.textLight }} />
              <YAxis domain={[0, 6]} tick={{ fontSize: 11, fill: COLORS.textLight }} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Area
                type="monotone"
                dataKey="prePandemicAvg"
                name="Pre-Pandemic Avg"
                fill={COLORS.gridLine}
                stroke={COLORS.gridLine}
                fillOpacity={0.3}
              />
              <Line
                type="monotone"
                dataKey="nonOwnerOccupiedCRE"
                name="Non-Owner Occupied CRE (Large Banks)"
                stroke={COLORS.danger}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="allCRE"
                name="All CRE Loans"
                stroke={COLORS.primary}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* National Cap Rates by Class Table */}
      <div
        style={{
          backgroundColor: COLORS.white,
          borderRadius: "8px",
          padding: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          marginBottom: "24px",
          overflowX: "auto",
        }}
      >
        <SectionHeader title="National Cap Rates by Property Type & Class" source="CBRE H1 2025 Cap Rate Survey" />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "600px" }}>
          <thead>
            <tr style={{ backgroundColor: COLORS.background }}>
              <th
                style={{
                  padding: "12px",
                  textAlign: "left",
                  borderBottom: `2px solid ${COLORS.gridLine}`,
                  color: COLORS.primary,
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                Property Type
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom: `2px solid ${COLORS.gridLine}`,
                  color: COLORS.primary,
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                Class A
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom: `2px solid ${COLORS.gridLine}`,
                  color: COLORS.primary,
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                Class B
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom: `2px solid ${COLORS.gridLine}`,
                  color: COLORS.primary,
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                Class C
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "right",
                  borderBottom: `2px solid ${COLORS.gridLine}`,
                  color: COLORS.primary,
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                Average
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "center",
                  borderBottom: `2px solid ${COLORS.gridLine}`,
                  color: COLORS.primary,
                  fontSize: "11px",
                  textTransform: "uppercase",
                }}
              >
                Trend
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, fontWeight: 500 }}>
                Multifamily
              </td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }}>
                {nationalCapRates.multifamily.classA}%
              </td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }}>
                {nationalCapRates.multifamily.classB}%
              </td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }}>
                {nationalCapRates.multifamily.classC}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "right",
                  fontWeight: 600,
                }}
              >
                {nationalCapRates.multifamily.average}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "center",
                  color: COLORS.success,
                }}
              >
                ↓ Compressing
              </td>
            </tr>
            <tr style={{ backgroundColor: COLORS.background }}>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, fontWeight: 500 }}>Office</td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }}>
                {nationalCapRates.office.classA}%
              </td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }}>
                {nationalCapRates.office.classB}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "right",
                  color: COLORS.danger,
                  fontWeight: 600,
                }}
              >
                {nationalCapRates.office.classC}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "right",
                  fontWeight: 600,
                }}
              >
                {nationalCapRates.office.average}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "center",
                  color: COLORS.danger,
                }}
              >
                ↑ Expanding
              </td>
            </tr>
            <tr>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, fontWeight: 500 }}>
                Industrial
              </td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }} colSpan={2}>
                Logistics: {nationalCapRates.industrial.logistics}%
              </td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }}>
                Flex: {nationalCapRates.industrial.flex}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "right",
                  fontWeight: 600,
                }}
              >
                {nationalCapRates.industrial.average}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "center",
                  color: COLORS.textLight,
                }}
              >
                → Stable
              </td>
            </tr>
            <tr style={{ backgroundColor: COLORS.background }}>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, fontWeight: 500 }}>Retail</td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }} colSpan={2}>
                Neighborhood: {nationalCapRates.retail.neighborhood}%
              </td>
              <td style={{ padding: "12px", borderBottom: `1px solid ${COLORS.gridLine}`, textAlign: "right" }}>
                Power: {nationalCapRates.retail.power}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "right",
                  fontWeight: 600,
                }}
              >
                {nationalCapRates.retail.average}%
              </td>
              <td
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${COLORS.gridLine}`,
                  textAlign: "center",
                  color: COLORS.textLight,
                }}
              >
                → Stable
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Market Context */}
      <div
        style={{
          padding: "20px",
          backgroundColor: COLORS.white,
          borderRadius: "8px",
          borderLeft: `4px solid ${COLORS.primary}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          marginBottom: "24px",
        }}
      >
        <SectionHeader title="Miami-Dade Market Context" source="Safe Harbor ICR Q3 2025" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
          <div>
            <p style={{ margin: "0 0 12px", fontSize: "13px", color: COLORS.text, lineHeight: 1.6 }}>
              <strong>Industrial:</strong> Miami&apos;s 12-month industrial net absorption has contracted -1.2M SF as
              tenants vacate older logistics buildings, yet vacancy (6.1%) remains below the U.S. average of 7.5%.
              Properties built 2015-2023 are 96% leased locally vs. 92% nationally. Rents have increased 23.1% over
              three years, though annual gains have moderated to 2.4%. Sales volume of $2.5B exceeds the 10-year average
              of $1.6B. Cap rates holding at 5.16% (Signature Realty Oct 2025).
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: COLORS.text, lineHeight: 1.6 }}>
              <strong>Office:</strong> Miami&apos;s office vacancy (15.0%) is significantly below the ~20% national
              average. The market has seen 670K SF of positive net absorption with asking rents at $62.35 PSF, rising
              2.7% YoY vs just 0.7% nationally. Return-to-office recovery at -20% vs pre-pandemic (better than SF at
              -51%). Cap rates around 7.0% vs 8.7% nationally reflect Miami&apos;s premium positioning.
            </p>
          </div>
          <div>
            <p style={{ margin: "0 0 12px", fontSize: "13px", color: COLORS.text, lineHeight: 1.6 }}>
              <strong>Multifamily:</strong> Vacancy has risen to 7.6% from 5% at start of 2024 as 25,000 units remain
              underway. Luxury (4-5 Star) vacancy stands at 11.5% with rent growth of just 1.1%. Average price per unit
              at sale: $302K (MMG Q1 2025). Cap rates around 5.2% remain below the 5.6% national average. Fort
              Lauderdale leading Southeast Florida at 6.3% cap rate (Yardi Matrix).
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: COLORS.text, lineHeight: 1.6 }}>
              <strong>Retail:</strong> Vacancy rate of 3.1% (Q2 2025) is 270 bps below the 5.8% national average. Rents
              have risen ~27% since 2019 vs. 18% nationally. Limited supply relief with only 860K SF underway. Annual
              transaction volume of $1.7B is in line with the 5-year average. Cap rates around 5.6%.
            </p>
          </div>
        </div>
      </div>

      {/* Data Sources Footer */}
      <div
        style={{
          padding: "16px 20px",
          backgroundColor: COLORS.white,
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      >
        <p style={{ margin: 0, fontSize: "11px", color: COLORS.textLight, lineHeight: 1.6 }}>
          <strong>Data Sources & Verification:</strong>
          <br />
          • FDIC Quarterly Banking Profile Q3 2025 (fdic.gov/quarterly-banking-profile)
          <br />
          • CBRE U.S. Cap Rate Survey H1 2025 (cbre.com/insights/reports/us-cap-rate-survey-h1-2025)
          <br />
          • Safe Harbor ICR Q3 2025 (CoStar, Green Street Advisors)
          <br />
          • FRED Economic Data - CRE Delinquency Series DRCRELEXFACBS
          <br />
          • Cushman & Wakefield Miami MarketBeat Q2-Q3 2025
          <br />
          • Avison Young Miami Industrial Market Report Q3 2025
          <br />• MMG Equity Partners Miami Multifamily Report Q1 2025
        </p>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "16px",
          paddingTop: "16px",
          borderTop: `1px solid ${COLORS.gridLine}`,
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <p style={{ margin: 0, fontSize: "11px", color: COLORS.textLight }}>CONFIDENTIAL – Internal Use Only</p>
        <p style={{ margin: 0, fontSize: "11px", color: COLORS.textLight }}>
          SHCP Market Intelligence | Last Updated: January 2026
        </p>
      </div>
    </div>
  )
}
