import type {
  AssignmentRecord,
  ExecutiveAlert,
  FlowEdge,
  FlowWindowStats,
  MonthlyFlowPoint,
  PairAggregate,
  PreforeclosureRecord,
} from "@/lib/participants-intel/types"

function toIsoDate(input?: string): string {
  const s = String(input || "").trim()
  if (!s) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function shiftIsoDays(anchorIso: string, minusDays: number): string {
  const d = new Date(`${anchorIso}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return daysAgoIso(minusDays)
  d.setUTCDate(d.getUTCDate() - minusDays)
  return d.toISOString().slice(0, 10)
}

function normalizePartyName(name: string): string {
  const base = (name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(llc|inc|corp|corporation|lp|l p|ltd|co|company|trust|holdings?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return base || "unknown party"
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function buildFlowEdges(assignments: AssignmentRecord[]): FlowEdge[] {
  return assignments
    .map((a) => {
      const date = toIsoDate(a.recordingDate)
      const fromRaw = (a.assignor || "").trim()
      const toRaw = (a.assignee || "").trim()
      if (!date || !fromRaw || !toRaw) return null
      const amount = Number(a.loanAmount || 0)
      return {
        from_party: titleCase(normalizePartyName(fromRaw)),
        to_party: titleCase(normalizePartyName(toRaw)),
        amount: Number.isFinite(amount) ? amount : 0,
        date,
        rawAssignor: fromRaw,
        rawAssignee: toRaw,
        property: a.property,
      } satisfies FlowEdge
    })
    .filter((x): x is FlowEdge => Boolean(x))
}

export function calculateInboundOutbound(edges: FlowEdge[], fromDateIso: string, toDateIso: string) {
  const map = new Map<string, { inboundVolume: number; outboundVolume: number; inboundCount: number; outboundCount: number }>()
  for (const e of edges) {
    if (e.date < fromDateIso || e.date > toDateIso) continue
    const from = map.get(e.from_party) || { inboundVolume: 0, outboundVolume: 0, inboundCount: 0, outboundCount: 0 }
    from.outboundVolume += e.amount
    from.outboundCount += 1
    map.set(e.from_party, from)
    const to = map.get(e.to_party) || { inboundVolume: 0, outboundVolume: 0, inboundCount: 0, outboundCount: 0 }
    to.inboundVolume += e.amount
    to.inboundCount += 1
    map.set(e.to_party, to)
  }
  return map
}

export function calculateRollingWindows(edges: FlowEdge[]): FlowWindowStats[] {
  const maxDate = edges.reduce((max, e) => (e.date > max ? e.date : max), "")
  const anchor = maxDate || new Date().toISOString().slice(0, 10)
  const d0 = shiftIsoDays(anchor, 30)
  const d30 = shiftIsoDays(anchor, 60)
  const d90 = shiftIsoDays(anchor, 90)
  const today = anchor

  const current30 = calculateInboundOutbound(edges, d0, today)
  const prior30 = calculateInboundOutbound(edges, d30, d0)
  const current90 = calculateInboundOutbound(edges, d90, today)

  const firms = new Set<string>([...current30.keys(), ...prior30.keys(), ...current90.keys()])
  const out: FlowWindowStats[] = []

  for (const firm of firms) {
    const c30 = current30.get(firm) || { inboundVolume: 0, outboundVolume: 0, inboundCount: 0, outboundCount: 0 }
    const p30 = prior30.get(firm) || { inboundVolume: 0, outboundVolume: 0, inboundCount: 0, outboundCount: 0 }
    const c90 = current90.get(firm) || { inboundVolume: 0, outboundVolume: 0, inboundCount: 0, outboundCount: 0 }
    const a30 = c30.inboundCount + c30.outboundCount
    const p30Count = p30.inboundCount + p30.outboundCount
    const pct = p30Count > 0 ? ((a30 - p30Count) / p30Count) * 100 : (a30 > 0 ? 100 : 0)

    out.push({
      firm,
      inbound30d: c30.inboundVolume,
      outbound30d: c30.outboundVolume,
      net30d: c30.inboundVolume - c30.outboundVolume,
      assignments30d: a30,
      assignments90d: c90.inboundCount + c90.outboundCount,
      pctChange30dVsPrior30d: pct,
      inbound90d: c90.inboundVolume,
      outbound90d: c90.outboundVolume,
      net90d: c90.inboundVolume - c90.outboundVolume,
      assignmentsPrior30d: p30Count,
    })
  }

  return out.sort((a, b) => b.net30d - a.net30d)
}

export function aggregateTopPairs(edges: FlowEdge[], days = 90): PairAggregate[] {
  const maxDate = edges.reduce((max, e) => (e.date > max ? e.date : max), "")
  const to = maxDate || new Date().toISOString().slice(0, 10)
  const from = shiftIsoDays(to, days)
  const map = new Map<string, PairAggregate>()
  for (const e of edges) {
    if (e.date < from || e.date > to) continue
    const key = `${e.from_party}→${e.to_party}`
    const curr = map.get(key) || {
      assignor: e.from_party,
      assignee: e.to_party,
      totalVolume: 0,
      transactions: 0,
      lastActivityDate: e.date,
    }
    curr.totalVolume += e.amount
    curr.transactions += 1
    if (e.date > curr.lastActivityDate) curr.lastActivityDate = e.date
    map.set(key, curr)
  }
  return Array.from(map.values()).sort((a, b) => b.totalVolume - a.totalVolume)
}

export function monthlyTrend(edges: FlowEdge[]): MonthlyFlowPoint[] {
  const map = new Map<string, MonthlyFlowPoint>()
  for (const e of edges) {
    const month = e.date.slice(0, 7)
    const curr = map.get(month) || { month, inbound: 0, outbound: 0 }
    curr.outbound += e.amount
    curr.inbound += e.amount
    map.set(month, curr)
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month))
}

export function detectNewEntrants(stats: FlowWindowStats[]): FlowWindowStats[] {
  return stats.filter((s) => s.assignments30d > 0 && s.assignments90d === s.assignments30d)
}

export function detectTopMovers(stats: FlowWindowStats[]): FlowWindowStats[] {
  return [...stats].sort((a, b) => b.pctChange30dVsPrior30d - a.pctChange30dVsPrior30d)
}

export function generateAlerts(input: {
  edges: FlowEdge[]
  preforeclosures: PreforeclosureRecord[]
  rolling: FlowWindowStats[]
}): ExecutiveAlert[] {
  const alerts: ExecutiveAlert[] = []

  for (const row of input.rolling) {
    if (row.assignments30d >= 5 && row.pctChange30dVsPrior30d > 50) {
      alerts.push({
        type: "spike",
        firm: row.firm,
        severity: "medium",
        message: `${row.firm} activity spiked ${row.pctChange30dVsPrior30d.toFixed(0)}% vs prior 30d.`,
      })
    }
  }

  const recentPairs = aggregateTopPairs(input.edges, 30)
  const priorPairs = new Set(aggregateTopPairs(input.edges, 120).map((p) => `${p.assignor}→${p.assignee}`))
  for (const pair of recentPairs.slice(0, 20)) {
    const k = `${pair.assignor}→${pair.assignee}`
    if (!priorPairs.has(k)) {
      alerts.push({
        type: "new_relationship",
        severity: "low",
        message: `New assignor→assignee relationship observed: ${pair.assignor} → ${pair.assignee}.`,
      })
    }
  }

  const amounts = input.edges.map((e) => e.amount).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (amounts.length > 0) {
    const idx = Math.max(0, Math.floor(amounts.length * 0.95) - 1)
    const p95 = amounts[idx]
    input.edges
      .filter((e) => e.amount >= p95)
      .slice(0, 5)
      .forEach((e) => {
        alerts.push({
          type: "large_transaction",
          severity: "high",
          message: `Large transaction detected: ${e.from_party} → ${e.to_party} (${e.amount.toLocaleString()}).`,
        })
      })
  }

  const maxEdgeDate = input.edges.reduce((max, e) => (e.date > max ? e.date : max), "")
  const anchor = maxEdgeDate || new Date().toISOString().slice(0, 10)
  const pre30 = shiftIsoDays(anchor, 30)
  const pre90 = shiftIsoDays(anchor, 90)
  const lenderCount30 = new Map<string, number>()
  const lenderCount90 = new Map<string, number>()
  const borrowerCount30 = new Map<string, number>()
  for (const p of input.preforeclosures) {
    const d = toIsoDate(p.auctionDate)
    const lender = titleCase(normalizePartyName(p.lender || p.plaintiff || "unknown lender"))
    const borrower = titleCase(normalizePartyName(p.defendant || "unknown borrower"))
    if (d >= pre90) lenderCount90.set(lender, (lenderCount90.get(lender) || 0) + 1)
    if (d >= pre30) {
      lenderCount30.set(lender, (lenderCount30.get(lender) || 0) + 1)
      borrowerCount30.set(borrower, (borrowerCount30.get(borrower) || 0) + 1)
    }
  }
  for (const [lender, c30] of lenderCount30.entries()) {
    const c90 = lenderCount90.get(lender) || 0
    const avg30From90 = c90 / 3
    if (c30 >= 3 && c30 > avg30From90 * 1.5) {
      alerts.push({
        type: "preforeclosure_spike",
        severity: "high",
        message: `Preforeclosure spike tied to lender ${lender}: ${c30} in 30d.`,
      })
    }
    if (c30 >= 4) {
      alerts.push({
        type: "repeat_lender",
        severity: "medium",
        message: `Same lender recurring in preforeclosures: ${lender} (${c30} in 30d).`,
      })
    }
  }
  for (const [borrower, count] of borrowerCount30.entries()) {
    if (count >= 2) {
      alerts.push({
        type: "repeat_borrower",
        severity: "medium",
        message: `Borrower appears in multiple recent preforeclosures: ${borrower} (${count}).`,
      })
    }
  }

  return alerts.slice(0, 25)
}

