"use client"

import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import {
  fetchAssignmentsPayload,
  fetchLendersPayload,
  fetchMortgagesPayload,
  fetchPreforeclosuresPayload,
  searchEntities,
} from "@/lib/participants-intel/services"
import {
  aggregateTopPairs,
  buildCoverageMetrics,
  buildFlowEdges,
  calculateRollingWindows,
  generateAlerts,
  monthlyTrend,
} from "@/lib/participants-intel/aggregation"
import type {
  AssignmentRecord,
  CoverageMetrics,
  LenderAnalyticsRecord,
  MortgageRecord,
  PreforeclosureRecord,
  ResourceDiagnostics,
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
  const [participantScope, setParticipantScope] = useState<"all" | "institutional" | "commercial">("institutional")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchEntityResult[]>([])
  const [selectedEntity, setSelectedEntity] = useState<SearchEntityResult | null>(null)
  const [diagnostics, setDiagnostics] = useState<{
    assignments: ResourceDiagnostics
    mortgages: ResourceDiagnostics
    preforeclosures: ResourceDiagnostics
    lenders: ResourceDiagnostics
  } | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [a, m, p, l] = await Promise.all([
          fetchAssignmentsPayload(),
          fetchMortgagesPayload(),
          fetchPreforeclosuresPayload(),
          fetchLendersPayload(),
        ])
        if (!mounted) return
        setAssignments(a.items)
        setMortgages(m.items)
        setPreforeclosures(p.items)
        setLenders(l.items)
        setDiagnostics({
          assignments: a.diagnostics,
          mortgages: m.diagnostics,
          preforeclosures: p.diagnostics,
          lenders: l.diagnostics,
        })
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
  const coverage = useMemo<CoverageMetrics>(
    () =>
      buildCoverageMetrics({
        assignments,
        mortgages,
        preforeclosures,
        edges,
        rolling,
      }),
    [assignments, mortgages, preforeclosures, edges, rolling]
  )

  const rollingByWindow = useMemo(() => {
    const base = timeWindow === "90d" ? [...rolling].sort((a, b) => b.net90d - a.net90d) : [...rolling]
    if (participantScope === "institutional") {
      return base.filter((r) =>
        ["institutional_lender_bank", "servicer", "trust_securitization_vehicle", "borrower_owner_entity"].includes(r.participantType)
      )
    }
    if (participantScope === "commercial") {
      return base.filter((r) => r.commerciallyRelevantAssignments30d > 0)
    }
    return base
  }, [rolling, timeWindow, participantScope])

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
            <span className="text-slate-600 ml-2">Participants:</span>
            <select
              value={participantScope}
              onChange={(e) => setParticipantScope(e.target.value as "all" | "institutional" | "commercial")}
              className="rounded border border-slate-300 bg-white px-2 py-1"
            >
              <option value="all">All</option>
              <option value="institutional">Institutional only</option>
              <option value="commercial">Commercially relevant only</option>
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-600">
          Assignments: {assignments.length} • Mortgages: {mortgages.length} • Preforeclosures: {preforeclosures.length} • Lenders: {lenders.length}
        </div>
      </Card>

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h4 className="text-sm font-semibold text-slate-800">Data Quality / Coverage</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5 text-sm">
          <div className="rounded border border-slate-200 bg-white p-3">Total assignments analyzed: <strong>{coverage.totalAssignments.toLocaleString()}</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Assignment value recovered: <strong>{coverage.valueRecoveredPct.toFixed(1)}%</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Unknown assignment value: <strong>{coverage.unknownValuePct.toFixed(1)}%</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Mortgage-linked assignments: <strong>{coverage.mortgageLinkedPct.toFixed(1)}%</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Commercially relevant records: <strong>{coverage.commerciallyRelevantRecords.toLocaleString()}</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Mortgage records loaded: <strong>{coverage.mortgageRecordsLoaded.toLocaleString()}</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Preforeclosure records loaded: <strong>{coverage.preforeclosureRecordsLoaded.toLocaleString()}</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Institutional participants: <strong>{coverage.institutionalParticipants.toLocaleString()}</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Individual participants: <strong>{coverage.individualParticipants.toLocaleString()}</strong></div>
          <div className="rounded border border-slate-200 bg-white p-3">Geographic coverage points: <strong>{coverage.geographicCoverageCount.toLocaleString()}</strong></div>
        </div>
        {diagnostics && (
          <div className="mt-3 text-xs text-slate-600 space-y-1">
            {[diagnostics.assignments, diagnostics.mortgages, diagnostics.preforeclosures, diagnostics.lenders]
              .flatMap((d) => d.notes || [])
              .filter(Boolean)
              .slice(0, 8)
              .map((n, i) => <div key={i}>- {n}</div>)}
          </div>
        )}
      </Card>

      {loading ? (
        <Card className="p-6 border-slate-200/80 bg-slate-50/30 text-sm text-slate-600">Loading participant intelligence…</Card>
      ) : error ? (
        <Card className="p-6 border-red-200 bg-red-50 text-sm text-red-700">{error}</Card>
      ) : (
        <>
          <SectionMarketFlow
            rolling={rollingByWindow}
            topPairs={topPairs}
            monthly={monthly}
            onSelectFirm={setSelectedFirm}
            participantScope={participantScope}
          />
          <SectionExecutiveSnapshot rolling={rollingByWindow} alerts={alerts} />
          <SectionFirmDrilldown
            selectedFirm={selectedFirm}
            rolling={rollingByWindow}
            edges={edges}
            mortgages={mortgages}
            preforeclosures={preforeclosures}
          />
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
          <SectionLegalSignals preforeclosures={preforeclosures} alerts={alerts} edges={edges} />
        </>
      )}
    </div>
  )
}

