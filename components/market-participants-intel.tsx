"use client"

import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import {
  fetchAssignments,
  fetchLenders,
  fetchMortgages,
  fetchPreforeclosures,
  searchEntities,
} from "@/lib/participants-intel/services"
import {
  aggregateTopPairs,
  buildFlowEdges,
  calculateRollingWindows,
  generateAlerts,
  monthlyTrend,
} from "@/lib/participants-intel/aggregation"
import type {
  AssignmentRecord,
  LenderAnalyticsRecord,
  MortgageRecord,
  PreforeclosureRecord,
  SearchEntityResult,
} from "@/lib/participants-intel/types"
import { SectionExecutiveSnapshot } from "@/components/participants-intel/section-executive-snapshot"
import { SectionFirmDrilldown } from "@/components/participants-intel/section-firm-drilldown"
import { SectionLegalSignals } from "@/components/participants-intel/section-legal-signals"
import { SectionMarketFlow } from "@/components/participants-intel/section-market-flow"
import { SectionPartySearch } from "@/components/participants-intel/section-party-search"

export function MarketParticipantsIntel() {
  const [loading, setLoading] = useState(true)
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([])
  const [mortgages, setMortgages] = useState<MortgageRecord[]>([])
  const [preforeclosures, setPreforeclosures] = useState<PreforeclosureRecord[]>([])
  const [lenders, setLenders] = useState<LenderAnalyticsRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedFirm, setSelectedFirm] = useState("")
  const [timeWindow, setTimeWindow] = useState<"30d" | "90d">("30d")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchEntityResult[]>([])
  const [selectedEntity, setSelectedEntity] = useState<SearchEntityResult | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [a, m, p, l] = await Promise.all([
          fetchAssignments(),
          fetchMortgages(),
          fetchPreforeclosures(),
          fetchLenders(),
        ])
        if (!mounted) return
        setAssignments(a)
        setMortgages(m)
        setPreforeclosures(p)
        setLenders(l)
      } catch (e) {
        if (!mounted) return
        setError(e instanceof Error ? e.message : "Failed to load participant intelligence data.")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults([])
      return
    }
    searchEntities(q)
      .then((items) => {
        if (!mounted) return
        setSearchResults(items)
      })
      .catch(() => {
        if (!mounted) return
        setSearchResults([])
      })
    return () => {
      mounted = false
    }
  }, [searchQuery])

  const edges = useMemo(() => buildFlowEdges(assignments), [assignments])
  const rolling = useMemo(() => calculateRollingWindows(edges), [edges])
  const topPairs = useMemo(() => aggregateTopPairs(edges, 90), [edges])
  const monthly = useMemo(() => monthlyTrend(edges), [edges])
  const alerts = useMemo(() => generateAlerts({ edges, preforeclosures, rolling }), [edges, preforeclosures, rolling])

  const rollingByWindow = useMemo(() => {
    if (timeWindow === "90d") {
      return [...rolling].sort((a, b) => b.net90d - a.net90d)
    }
    return rolling
  }, [rolling, timeWindow])

  return (
    <div className="space-y-6">
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Market Participants & Activity Intelligence System</h3>
            <p className="text-xs text-slate-600">
              API-driven participant intelligence with internal flow aggregation, rolling windows, and legal/credit signals.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Window:</span>
            <select
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value as "30d" | "90d")}
              className="rounded border border-slate-300 bg-white px-2 py-1"
            >
              <option value="30d">30d</option>
              <option value="90d">90d</option>
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-600">
          Assignments: {assignments.length} • Mortgages: {mortgages.length} • Preforeclosures: {preforeclosures.length} • Lenders: {lenders.length}
        </div>
      </Card>

      {loading ? (
        <Card className="p-6 border-slate-200/80 bg-slate-50/30 text-sm text-slate-600">Loading participant intelligence…</Card>
      ) : error ? (
        <Card className="p-6 border-red-200 bg-red-50 text-sm text-red-700">{error}</Card>
      ) : (
        <>
          <SectionMarketFlow rolling={rollingByWindow} topPairs={topPairs} monthly={monthly} onSelectFirm={setSelectedFirm} />
          <SectionExecutiveSnapshot rolling={rollingByWindow} alerts={alerts} />
          <SectionFirmDrilldown selectedFirm={selectedFirm} rolling={rollingByWindow} edges={edges} />
          <SectionPartySearch
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults}
            selectedEntity={selectedEntity}
            onSelectEntity={setSelectedEntity}
            assignments={assignments}
            mortgages={mortgages}
            preforeclosures={preforeclosures}
          />
          <SectionLegalSignals preforeclosures={preforeclosures} alerts={alerts} />
        </>
      )}
    </div>
  )
}

