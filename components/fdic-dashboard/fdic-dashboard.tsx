"use client"

import { BankingSectorOverview } from "./banking-sector-overview"
import { CRELoanTracker } from "./cre-loan-tracker"
import { MiamiMarketFocus } from "./miami-market-focus"
import { CREDashboard } from "./cre-dashboard"
import { DistressedOpportunityScanner } from "./distressed-opportunity-scanner"
import { useEffect } from "react"
import { prefetchFDICDashboardData } from "@/lib/fdic-client-cache"

export function FDICDashboard() {
  useEffect(() => {
    prefetchFDICDashboardData().catch(() => {
      // Prefetch errors are handled by individual components.
    })
  }, [])

  return (
    <div className="space-y-6">
      {/* Overview Section */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">FDIC Banking Market Intelligence</h1>
        <p className="text-muted-foreground">
          Real-time banking sector analytics and portfolio benchmarking for Safe Harbor Capital Partners
        </p>
      </div>

      {/* Section 1: CRE Dashboard - Full Dashboard */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">CRE Dashboard</h2>
        <CREDashboard />
      </div>

      {/* Section 2: Banking Sector Health Overview */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Banking Sector Health Overview</h2>
        <BankingSectorOverview state="Florida" />
      </div>

      {/* Section 3: CRE Loan Performance Tracker */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">CRE Loan Performance Tracker</h2>
        <CRELoanTracker defaultState="Florida" />
      </div>

      {/* Section 4: Miami-Dade Market Focus */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Miami-Dade Market Focus</h2>
        <MiamiMarketFocus />
      </div>

      {/* Section 5: Distressed Opportunity Scanner */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Distressed Opportunity Scanner</h2>
        <DistressedOpportunityScanner />
      </div>
    </div>
  )
}

