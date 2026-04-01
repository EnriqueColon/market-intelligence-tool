"use client"

import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { fetchAssignmentsPayload, fetchLendersPayload, fetchRankingsPayload } from "@/lib/participants-intel/services"
import { buildFlowEdges } from "@/lib/participants-intel/aggregation"
import type { AssignmentRecord, CompetitorRanking, LenderAnalyticsRecord } from "@/lib/participants-intel/types"
import { SectionCompetitorAOM } from "@/components/participants-intel/section-competitor-aom"

export function MarketParticipantsIntel() {
  const [loading, setLoading] = useState(true)
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([])
  const [lenders, setLenders] = useState<LenderAnalyticsRecord[]>([])
  const [rankings, setRankings] = useState<CompetitorRanking[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [a, l, r] = await Promise.all([fetchAssignmentsPayload(), fetchLendersPayload(), fetchRankingsPayload()])
        if (!mounted) return
        setAssignments(a.items)
        setLenders(l.items)
        setRankings(r.items)
      } catch (e) {
        if (!mounted) return
        setError(e instanceof Error ? e.message : "Failed to load data.")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const edges = useMemo(() => buildFlowEdges(assignments), [assignments])

  if (loading) {
    return (
      <Card className="p-6 border-slate-200/80 bg-slate-50/30 text-sm text-slate-600">
        Loading competitor AOM intelligence…
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-6 border-red-200 bg-red-50 text-sm text-red-700">{error}</Card>
    )
  }

  return (
    <div className="space-y-6">
      <SectionCompetitorAOM edges={edges} lenders={lenders} rankings={rankings} />
    </div>
  )
}
