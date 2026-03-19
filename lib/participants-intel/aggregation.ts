import type {
  AssignmentRecord,
  CoverageMetrics,
  ExecutiveAlert,
  FlowEdge,
  FlowWindowStats,
  MonthlyFlowPoint,
  PairAggregate,
  ParticipantProfile,
  ParticipantType,
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

function pickDisplayName(name: string): string {
  const trimmed = (name || "").trim().replace(/\s+/g, " ")
  if (!trimmed) return "Unknown Party"
  return trimmed
}

function isIndividualName(name: string): boolean {
  const n = normalizePartyName(name)
  if (!n) return false
  if (/\b(llc|inc|corp|bank|trust|fund|mortgage|servicing|loan|agency|department|secretary|hud|fannie|freddie)\b/i.test(n)) {
    return false
  }
  const parts = n.split(" ").filter(Boolean)
  return parts.length >= 2 && parts.length <= 4
}

export function classifyParticipant(name: string): ParticipantProfile {
  const displayName = pickDisplayName(name)
  const normalizedName = titleCase(normalizePartyName(name))
  const n = normalizedName.toLowerCase()

  let participantType: ParticipantType = "unknown"
  let confidence = 0.55

  if (/\b(bank|n a|na|federal home loan|credit union|national association|lender)\b/.test(n)) {
    participantType = "institutional_lender_bank"
    confidence = 0.85
  } else if (/\b(servic|msr|loan servicing|mortgage servicing|special servicing)\b/.test(n)) {
    participantType = "servicer"
    confidence = 0.86
  } else if (/\b(trust|issuer|holder|series|pass through|conduit|securit|remic)\b/.test(n)) {
    participantType = "trust_securitization_vehicle"
    confidence = 0.83
  } else if (/\b(llc|l p|lp|inc|corp|co|company|holdings|owner|properties|property)\b/.test(n)) {
    participantType = "borrower_owner_entity"
    confidence = 0.72
  } else if (/\b(secretary|hud|agency|department|county|city|state of|federal)\b/.test(n)) {
    participantType = "government_agency"
    confidence = 0.8
  } else if (isIndividualName(n)) {
    participantType = "individual"
    confidence = 0.68
  }

  return { normalizedName, displayName, participantType, confidence }
}

export function inferCommercialRelevance(input: {
  amount?: number | null
  propertyType?: string
  fromType: ParticipantType
  toType: ParticipantType
  property?: string
}): { commerciallyRelevant: boolean; reasons: string[] } {
  const reasons: string[] = []
  const pType = (input.propertyType || "").toLowerCase()
  const property = (input.property || "").toLowerCase()
  const amount = Number(input.amount || 0)
  const institutionalInvolved =
    input.fromType !== "individual" &&
    input.toType !== "individual" &&
    input.fromType !== "unknown" &&
    input.toType !== "unknown"

  if (/\b(commercial|multifamily|office|retail|industrial|mixed|land)\b/.test(pType)) {
    reasons.push(`property_type:${pType}`)
  }
  if (/\b(commercial|multifamily|office|retail|industrial|mixed|land)\b/.test(property)) {
    reasons.push("property_text_hint")
  }
  if (amount >= 1_000_000) {
    reasons.push("amount_threshold")
  }
  if (institutionalInvolved) {
    reasons.push("institutional_counterparties")
  }

  return {
    commerciallyRelevant: reasons.length > 0,
    reasons: reasons.length ? reasons : ["insufficient_commercial_signal"],
  }
}

function inferRole(row: {
  participantType: ParticipantType
  inbound90d: number
  outbound90d: number
}): FlowWindowStats["inferredRole"] {
  if (row.participantType === "servicer") return "servicer"
  if (row.participantType === "trust_securitization_vehicle") return "trust-conduit"
  if (row.inbound90d === 0 && row.outbound90d === 0) return "unknown"
  const ratio = row.inbound90d / Math.max(1, row.outbound90d)
  if (ratio >= 1.25) return "assignee-heavy"
  if (ratio <= 0.8) return "assignor-heavy"
  return "balanced"
}

export function buildFlowEdges(assignments: AssignmentRecord[]): FlowEdge[] {
  return assignments
    .map((a) => {
      const date = toIsoDate(a.recordingDate)
      const fromRaw = (a.assignor || "").trim()
      const toRaw = (a.assignee || "").trim()
      if (!date || !fromRaw || !toRaw) return null
      const amountKnown = a.valueStatus === "known" && Number.isFinite(Number(a.loanAmount))
      const amount = amountKnown ? Number(a.loanAmount) : null
      const fromProfile = classifyParticipant(fromRaw)
      const toProfile = classifyParticipant(toRaw)
      const relevance = inferCommercialRelevance({
        amount,
        propertyType: a.propertyType,
        fromType: fromProfile.participantType,
        toType: toProfile.participantType,
        property: a.property,
      })
      return {
        from_party: fromProfile.normalizedName,
        to_party: toProfile.normalizedName,
        amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
        amountKnown,
        valueSource: a.valueSource,
        date,
        rawAssignor: fromProfile.displayName,
        rawAssignee: toProfile.displayName,
        property: a.property,
        propertyType: a.propertyType,
        geography: a.geography,
        commerciallyRelevant: relevance.commerciallyRelevant,
        relevanceReason: relevance.reasons,
        fromProfile,
        toProfile,
      } satisfies FlowEdge
    })
    .filter((x): x is FlowEdge => Boolean(x))
}

export function calculateInboundOutbound(edges: FlowEdge[], fromDateIso: string, toDateIso: string) {
  const map = new Map<
    string,
    {
      inboundVolume: number
      outboundVolume: number
      inboundCount: number
      outboundCount: number
      knownValueCount: number
      unknownValueCount: number
      commercialCount: number
      type: ParticipantType
      confidence: number
      firstSeen?: string
      lastSeen?: string
      uniqueCounterparty: Set<string>
    }
  >()
  for (const e of edges) {
    if (e.date < fromDateIso || e.date > toDateIso) continue
    const from = map.get(e.from_party) || {
      inboundVolume: 0,
      outboundVolume: 0,
      inboundCount: 0,
      outboundCount: 0,
      knownValueCount: 0,
      unknownValueCount: 0,
      commercialCount: 0,
      type: e.fromProfile.participantType,
      confidence: e.fromProfile.confidence,
      firstSeen: e.date,
      lastSeen: e.date,
      uniqueCounterparty: new Set<string>(),
    }
    from.outboundVolume += e.amount ?? 0
    from.outboundCount += 1
    if (e.amountKnown) from.knownValueCount += 1
    else from.unknownValueCount += 1
    if (e.commerciallyRelevant) from.commercialCount += 1
    from.firstSeen = !from.firstSeen || e.date < from.firstSeen ? e.date : from.firstSeen
    from.lastSeen = !from.lastSeen || e.date > from.lastSeen ? e.date : from.lastSeen
    from.uniqueCounterparty.add(e.to_party)
    map.set(e.from_party, from)
    const to = map.get(e.to_party) || {
      inboundVolume: 0,
      outboundVolume: 0,
      inboundCount: 0,
      outboundCount: 0,
      knownValueCount: 0,
      unknownValueCount: 0,
      commercialCount: 0,
      type: e.toProfile.participantType,
      confidence: e.toProfile.confidence,
      firstSeen: e.date,
      lastSeen: e.date,
      uniqueCounterparty: new Set<string>(),
    }
    to.inboundVolume += e.amount ?? 0
    to.inboundCount += 1
    if (e.amountKnown) to.knownValueCount += 1
    else to.unknownValueCount += 1
    if (e.commerciallyRelevant) to.commercialCount += 1
    to.firstSeen = !to.firstSeen || e.date < to.firstSeen ? e.date : to.firstSeen
    to.lastSeen = !to.lastSeen || e.date > to.lastSeen ? e.date : to.lastSeen
    to.uniqueCounterparty.add(e.from_party)
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
      participantType: c90.type || c30.type || "unknown",
      confidence: c90.confidence || c30.confidence || 0.5,
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
      knownValueAssignments30d: c30.knownValueCount || 0,
      unknownValueAssignments30d: c30.unknownValueCount || 0,
      valueCoveragePct30d: a30 > 0 ? ((c30.knownValueCount || 0) / a30) * 100 : 0,
      commerciallyRelevantAssignments30d: c30.commercialCount || 0,
      firstSeenDate: c90.firstSeen || c30.firstSeen,
      lastSeenDate: c90.lastSeen || c30.lastSeen,
      activityScore:
        (a30 * 1.2) +
        ((c30.knownValueCount || 0) * 0.8) +
        ((c30.commercialCount || 0) * 0.9) +
        ((c30.uniqueCounterparty?.size || 0) * 0.5) +
        ((c90.type === "institutional_lender_bank" || c90.type === "servicer" || c90.type === "trust_securitization_vehicle") ? 2 : 0),
      inferredRole: inferRole({
        participantType: c90.type || c30.type || "unknown",
        inbound90d: c90.inboundCount || 0,
        outbound90d: c90.outboundCount || 0,
      }),
    })
  }

  return out.sort((a, b) => b.activityScore - a.activityScore)
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
      totalVolumeKnown: 0,
      transactions: 0,
      lastActivityDate: e.date,
      knownValueTransactions: 0,
      unknownValueTransactions: 0,
      valueCoveragePct: 0,
    }
    curr.totalVolumeKnown += e.amount ?? 0
    curr.transactions += 1
    if (e.amountKnown) curr.knownValueTransactions += 1
    else curr.unknownValueTransactions += 1
    if (e.date > curr.lastActivityDate) curr.lastActivityDate = e.date
    curr.valueCoveragePct = curr.transactions > 0 ? (curr.knownValueTransactions / curr.transactions) * 100 : 0
    map.set(key, curr)
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.totalVolumeKnown !== a.totalVolumeKnown) return b.totalVolumeKnown - a.totalVolumeKnown
    if (b.transactions !== a.transactions) return b.transactions - a.transactions
    return b.lastActivityDate.localeCompare(a.lastActivityDate)
  })
}

export function monthlyTrend(edges: FlowEdge[]): MonthlyFlowPoint[] {
  const hasKnownValue = edges.some((e) => e.amountKnown)
  const map = new Map<string, MonthlyFlowPoint>()
  for (const e of edges) {
    const month = e.date.slice(0, 7)
    const curr = map.get(month) || { month, inbound: 0, outbound: 0 }
    if (hasKnownValue) {
      curr.outbound += e.amount ?? 0
      curr.inbound += e.amount ?? 0
    } else {
      // Fallback to activity counts when values are unavailable.
      curr.outbound += 1
      curr.inbound += 1
    }
    map.set(month, curr)
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month))
}

export function detectNewEntrants(stats: FlowWindowStats[]): FlowWindowStats[] {
  return stats.filter(
    (s) =>
      s.assignments30d > 0 &&
      s.assignments90d === s.assignments30d &&
      s.participantType !== "individual"
  )
}

export function detectTopMovers(stats: FlowWindowStats[]): FlowWindowStats[] {
  return [...stats].sort((a, b) => {
    if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore
    return b.pctChange30dVsPrior30d - a.pctChange30dVsPrior30d
  })
}

export function generateAlerts(input: {
  edges: FlowEdge[]
  preforeclosures: PreforeclosureRecord[]
  rolling: FlowWindowStats[]
}): ExecutiveAlert[] {
  const alerts: ExecutiveAlert[] = []

  for (const row of input.rolling) {
    if (
      row.assignments30d >= 5 &&
      row.pctChange30dVsPrior30d > 50 &&
      row.participantType !== "individual" &&
      row.commerciallyRelevantAssignments30d > 0
    ) {
      alerts.push({
        type: "spike",
        firm: row.firm,
        severity: "medium",
        label: "High-Value Mover",
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
        label: "Relationship Signal",
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
          label: "Large Transaction",
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
        label: "Distress Signal",
        message: `Preforeclosure spike tied to lender ${lender}: ${c30} in 30d.`,
      })
    }
    if (c30 >= 4) {
      alerts.push({
        type: "repeat_lender",
        severity: "medium",
        label: "Distress Concentration",
        message: `Same lender recurring in preforeclosures: ${lender} (${c30} in 30d).`,
      })
    }
  }
  for (const [borrower, count] of borrowerCount30.entries()) {
    if (count >= 2) {
      alerts.push({
        type: "repeat_borrower",
        severity: "medium",
        label: "Borrower Repeat Signal",
        message: `Borrower appears in multiple recent preforeclosures: ${borrower} (${count}).`,
      })
    }
  }

  return alerts.slice(0, 25)
}

export function buildCoverageMetrics(input: {
  assignments: AssignmentRecord[]
  mortgages: AssignmentRecord[] | { id: string }[]
  preforeclosures: PreforeclosureRecord[]
  edges: FlowEdge[]
  rolling: FlowWindowStats[]
}): CoverageMetrics {
  const totalAssignments = input.assignments.length
  const assignmentsWithRecoveredValue = input.assignments.filter((a) => a.valueStatus === "known").length
  const assignmentsWithUnknownValue = totalAssignments - assignmentsWithRecoveredValue
  const assignmentsLinkedToMortgage = input.assignments.filter((a) => Boolean(a.linkedMortgageId)).length
  const mortgageRecordsLoaded = input.mortgages.length
  const preforeclosureRecordsLoaded = input.preforeclosures.length
  const institutionalParticipants = input.rolling.filter((r) =>
    ["institutional_lender_bank", "servicer", "trust_securitization_vehicle", "borrower_owner_entity"].includes(r.participantType)
  ).length
  const individualParticipants = input.rolling.filter((r) => r.participantType === "individual").length
  const commerciallyRelevantRecords = input.edges.filter((e) => e.commerciallyRelevant).length
  const geographicCoverageCount = new Set(input.edges.map((e) => (e.geography || "").trim()).filter(Boolean)).size
  const valueRecoveredPct = totalAssignments > 0 ? (assignmentsWithRecoveredValue / totalAssignments) * 100 : 0
  const unknownValuePct = totalAssignments > 0 ? (assignmentsWithUnknownValue / totalAssignments) * 100 : 0
  const mortgageLinkedPct = totalAssignments > 0 ? (assignmentsLinkedToMortgage / totalAssignments) * 100 : 0

  return {
    totalAssignments,
    assignmentsWithRecoveredValue,
    assignmentsWithUnknownValue,
    assignmentsLinkedToMortgage,
    mortgageRecordsLoaded,
    preforeclosureRecordsLoaded,
    institutionalParticipants,
    individualParticipants,
    commerciallyRelevantRecords,
    geographicCoverageCount,
    valueRecoveredPct,
    unknownValuePct,
    mortgageLinkedPct,
  }
}

