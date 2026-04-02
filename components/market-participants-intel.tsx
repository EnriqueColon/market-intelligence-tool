"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import {
  fetchCompetitorAssignorsPayload,
  fetchPrivateLendersPayload,
  fetchRankingsPayload,
  fetchRecentDealsPayload,
} from "@/lib/participants-intel/services"
import type {
  CompetitorAssignorRow,
  CompetitorRanking,
  PrivateLenderRecord,
  RecentDealRecord,
} from "@/lib/participants-intel/types"
import { SectionCompetitorAOM } from "@/components/participants-intel/section-competitor-aom"
import { SectionPrivateCreditorMonitor } from "@/components/participants-intel/section-private-creditor-monitor"
import { SectionEntitySearch } from "@/components/participants-intel/section-entity-search"

type Props = { level?: string }

export function MarketParticipantsIntel({ level = "florida" }: Props) {
  const [loading, setLoading] = useState(true)
  const [rankings, setRankings] = useState<CompetitorRanking[]>([])
  const [privateLenders, setPrivateLenders] = useState<PrivateLenderRecord[]>([])
  const [recentDeals, setRecentDeals] = useState<RecentDealRecord[]>([])
  const [competitorAssignors, setCompetitorAssignors] = useState<CompetitorAssignorRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [r, pl, rd, ca] = await Promise.all([
          fetchRankingsPayload(level),
          fetchPrivateLendersPayload(level),
          fetchRecentDealsPayload(level),
          fetchCompetitorAssignorsPayload(level),
        ])
        if (!mounted) return
        setRankings(r.items)
        setPrivateLenders(pl.items)
        setRecentDeals(rd.items)
        setCompetitorAssignors(ca.items)
      } catch (e) {
        if (!mounted) return
        setError(e instanceof Error ? e.message : "Failed to load data.")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [level])

  if (loading) {
    return (
      <Card className="p-6 border-slate-200/80 bg-slate-50/30 text-sm text-slate-600">
        Loading market participants intelligence…
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
      <SectionEntitySearch />

      <SectionPrivateCreditorMonitor
        lenders={privateLenders}
        deals={recentDeals}
        rankings={rankings}
        geo={level}
      />
      <SectionCompetitorAOM
        rankings={rankings}
        competitorAssignors={competitorAssignors}
        privateLenders={privateLenders}
      />
    </div>
  )
}
