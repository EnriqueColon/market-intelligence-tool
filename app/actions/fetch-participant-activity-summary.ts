"use server"

import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"
import { loadWatchlistData } from "@/app/lib/watchlist"

const AOM_DB_PATH = path.join(process.cwd(), "data", "aom.sqlite")

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export type TopMover = {
  firm: string
  category?: string
  net_30d?: number
  net_90d?: number
  total_30d?: number
  total_90d?: number
}

export type NewEntrant = {
  firm: string
  category?: string
  total_90d: number
  firstSeen: string
}

export type TopPair = {
  assignor: string
  assignee: string
  count: number
}

export type Alert = {
  type: "Spike" | "New Entrant" | "Relationship Concentration"
  firm: string
  message: string
}

export type ParticipantActivitySummary = {
  topMovers30d: TopMover[]
  topMovers90d: TopMover[]
  newEntrants90d: NewEntrant[]
  topPairs90d: TopPair[]
  alerts: Alert[]
  notes: string[]
}

const NEW_ENTRANT_THRESHOLD = 5
const SPIKE_MIN_TOTAL = 10
const CONCENTRATION_PCT = 0.4

export async function fetchParticipantActivitySummary(options?: {
  watchlistOnly?: boolean
  category?: string
}): Promise<ParticipantActivitySummary> {
  const notes: string[] = []
  const watchlistOnly = options?.watchlistOnly ?? false
  const categoryFilter = (options?.category || "").trim() || undefined

  if (!fs.existsSync(AOM_DB_PATH)) {
    return {
      topMovers30d: [],
      topMovers90d: [],
      newEntrants90d: [],
      topPairs90d: [],
      alerts: [],
      notes: ["AOM database not found. Build data/aom.sqlite first."],
    }
  }

  const { watchlistSet, aliasLookup, categoryByFirm } = await loadWatchlistData()

  const resolveFirm = (party?: string) => {
    const raw = (party || "").trim()
    if (!raw) return undefined
    return aliasLookup.get(normalize(raw)) ?? raw
  }

  const includeFirm = (firm: string) => {
    if (watchlistOnly && !watchlistSet.has(firm)) return false
    if (categoryFilter && categoryByFirm[firm] !== categoryFilter) return false
    return true
  }

  const db = new Database(AOM_DB_PATH, { readonly: true })
  try {
    const rows = db
      .prepare(
        `SELECT event_date, trim(first_party) as first_party, trim(second_party) as second_party
         FROM aom_events
         WHERE event_date IS NOT NULL AND length(event_date) >= 10
         AND (first_party IS NOT NULL OR second_party IS NOT NULL)
         ORDER BY event_date ASC`
      )
      .all() as Array<{
      event_date: string
      first_party: string | null
      second_party: string | null
    }>

    const today = new Date().toISOString().slice(0, 10)
    const date30dAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const date90dAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const date180dAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    type FirmStats = {
      inbound30: number
      outbound30: number
      inbound90: number
      outbound90: number
      inboundPrior6m: number
      outboundPrior6m: number
      firstSeen: string | undefined
      totalPrior6m: number
    }

    const stats = new Map<string, FirmStats>()
    const pairCounts = new Map<string, number>()
    const firmCounterpartyShare = new Map<string, Map<string, number>>()

    const ensure = (firm: string) => {
      let s = stats.get(firm)
      if (!s) {
        s = {
          inbound30: 0,
          outbound30: 0,
          inbound90: 0,
          outbound90: 0,
          inboundPrior6m: 0,
          outboundPrior6m: 0,
          firstSeen: undefined,
          totalPrior6m: 0,
        }
        stats.set(firm, s)
      }
      return s
    }

    for (const r of rows) {
      const d = (r.event_date || "").slice(0, 10)
      const assignor = resolveFirm(r.first_party || "")
      const assignee = resolveFirm(r.second_party || "")

      if (!assignor || !assignee) continue

      const in30 = d >= date30dAgo && d <= today
      const in90 = d >= date90dAgo && d <= today
      const inPrior6m = d >= date180dAgo && d < date90dAgo

      if (assignor) {
        const s = ensure(assignor)
        if (!s.firstSeen || d < s.firstSeen) s.firstSeen = d
        if (in30) s.outbound30 += 1
        if (in90) s.outbound90 += 1
        if (inPrior6m) s.outboundPrior6m += 1
      }

      if (assignee) {
        const s = ensure(assignee)
        if (!s.firstSeen || d < s.firstSeen) s.firstSeen = d
        if (in30) s.inbound30 += 1
        if (in90) s.inbound90 += 1
        if (inPrior6m) s.inboundPrior6m += 1
      }

      if (assignor && assignee && in90) {
        const key = `${assignor}→${assignee}`
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1)

        const assignorTotal = (firmCounterpartyShare.get(assignor) || new Map())
        assignorTotal.set(assignee, (assignorTotal.get(assignee) || 0) + 1)
        firmCounterpartyShare.set(assignor, assignorTotal)

        const assigneeTotal = (firmCounterpartyShare.get(assignee) || new Map())
        assigneeTotal.set(assignor, (assigneeTotal.get(assignor) || 0) + 1)
        firmCounterpartyShare.set(assignee, assigneeTotal)
      }
    }

    for (const s of stats.values()) {
      s.totalPrior6m = s.inboundPrior6m + s.outboundPrior6m
    }

    let firms = Array.from(stats.entries())
      .filter(([firm]) => includeFirm(firm))
      .map(([firm, s]) => ({
        firm,
        category: categoryByFirm[firm],
        ...s,
        net30: s.inbound30 - s.outbound30,
        net90: s.inbound90 - s.outbound90,
        total30: s.inbound30 + s.outbound30,
        total90: s.inbound90 + s.outbound90,
        avgPrior6m: s.totalPrior6m / 6,
      }))

    const topMovers30d = firms
      .sort((a, b) => {
        const na = Math.abs(a.net30)
        const nb = Math.abs(b.net30)
        if (nb !== na) return nb - na
        return (b.total30 || 0) - (a.total30 || 0)
      })
      .slice(0, 10)
      .map((f) => ({
        firm: f.firm,
        category: f.category,
        net_30d: f.net30,
        net_90d: f.net90,
        total_30d: f.total30,
        total_90d: f.total90,
      }))

    const topMovers90d = firms
      .sort((a, b) => {
        const na = Math.abs(a.net90)
        const nb = Math.abs(b.net90)
        if (nb !== na) return nb - na
        return (b.total90 || 0) - (a.total90 || 0)
      })
      .slice(0, 10)
      .map((f) => ({
        firm: f.firm,
        category: f.category,
        net_30d: f.net30,
        net_90d: f.net90,
        total_30d: f.total30,
        total_90d: f.total90,
      }))

    const newEntrants90d = firms
      .filter((f) => {
        if (!f.firstSeen) return false
        if (f.firstSeen < date90dAgo) return false
        return f.total90 >= NEW_ENTRANT_THRESHOLD
      })
      .sort((a, b) => b.total90 - a.total90)
      .slice(0, 10)
      .map((f) => ({
        firm: f.firm,
        category: f.category,
        total_90d: f.total90,
        firstSeen: f.firstSeen!,
      }))

    const topPairs90d = Array.from(pairCounts.entries())
      .filter(([key]) => {
        const [a, b] = key.split("→")
        return includeFirm(a) || includeFirm(b)
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([key, count]) => {
        const [assignor, assignee] = key.split("→")
        return { assignor, assignee, count }
      })

    const alerts: Alert[] = []

    for (const f of firms) {
      if (f.total30 >= SPIKE_MIN_TOTAL && f.avgPrior6m > 0 && f.total30 > 2 * f.avgPrior6m) {
        alerts.push({
          type: "Spike",
          firm: f.firm,
          message: `Total 30d (${f.total30}) > 2× avg prior 6 months`,
        })
      }
      if (
        f.firstSeen &&
        f.firstSeen >= date90dAgo &&
        f.total90 >= NEW_ENTRANT_THRESHOLD
      ) {
        alerts.push({
          type: "New Entrant",
          firm: f.firm,
          message: `First seen ${f.firstSeen}, ${f.total90} events in 90d`,
        })
      }
      const cpMap = firmCounterpartyShare.get(f.firm)
      if (cpMap && f.total90 > 0) {
        const total = f.total90
        for (const [cp, cnt] of cpMap.entries()) {
          if (cnt / total > CONCENTRATION_PCT) {
            alerts.push({
              type: "Relationship Concentration",
              firm: f.firm,
              message: `>40% of flows to ${cp}`,
            })
            break
          }
        }
      }
    }

    return {
      topMovers30d,
      topMovers90d,
      newEntrants90d,
      topPairs90d,
      alerts: alerts.slice(0, 20),
      notes,
    }
  } finally {
    db.close()
  }
}
