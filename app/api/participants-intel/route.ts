import { NextRequest, NextResponse } from "next/server"
import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"
import type {
  AssignmentRecord,
  LenderAnalyticsRecord,
  MortgageRecord,
  PreforeclosureRecord,
  ResourceDiagnostics,
  ResourcePayload,
  SearchEntityResult,
} from "@/lib/participants-intel/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Data source priority:
 *   1) Elementix API (ELEMENTIX_API_KEY) — live AOM, mortgage, lender, and search data
 *   2) Local SQLite fallback — aom.sqlite (assignments) and ingestion.sqlite (preforeclosures)
 *
 * Elementix endpoints used:
 *   GET /api/v1/lender/{id}/assignments?state=FL   → individual AOM records per lender
 *   GET /api/v1/assignments/rankings?state=FL      → top FL AOM buyer/seller rankings
 *   GET /api/v1/transactions?state=FL&isBusinessPurpose=true → FL mortgage transactions
 *   GET /api/v1/lenders                            → national lender rankings
 *   GET /api/v1/lender-search?q=...                → lender entity search
 *
 * Assignment value recovery order (for SQLite fallback):
 *   1) assignment.loanAmount  2) assignment.amount  3) linked mortgage amounts
 *   4) aom.upb / aom.consideration  5) unknown
 */

type Resource = "assignments" | "mortgages" | "preforeclosures" | "lenders" | "search"

// ─── Elementix API config ─────────────────────────────────────────────────────

const ELEMENTIX_BASE = "https://app.elementix.ai"
const ELEMENTIX_KEY = process.env.ELEMENTIX_API_KEY?.trim()

// ─── Elementix response types ─────────────────────────────────────────────────

type ElxAssignment = {
  id: string
  countyName: string
  countyState: string
  city: string
  zipCode?: string
  regionName?: string
  recordingDate: string
  addresses: string[]
  addressDetails?: { id: string; addressFull: string }[]
  borrowerNames: string[]
  loanAmount: string | number
  originalLenderRaw: string
  originalLender: string
  originalLenderId: string
  originalLenderDomainName?: string | null
  assigneeLenderRaw: string
  assigneeLender: string
  assigneeLenderId: string
  assigneeLenderDomainName?: string | null
  mortgageId: string | null
}

type ElxTransaction = {
  id: string
  type: string
  recordingDate: string
  countyName: string
  countyState: string
  city: string
  zipCode?: string
  regionName?: string
  addresses: { id: string; addressFull: string }[]
  isBusinessPurpose: boolean
  propertyTypes: string[]
  propertySubtypes: string[]
  amount: number | null
  partiesGrantor: string[]
  partiesGrantee: string[]
  lenderId?: string
  lenderName?: string
  lenderType?: string | null
  entityBorrowers: { id: string; name: string; type: string; state: string }[]
  deedConsideration?: number | null
}

type ElxLender = {
  lenderId: string
  lenderName: string
  lenderDomainName?: string | null
  lenderType?: string | null
  address?: string
  volume: number
  volumePrev: number
  count: number
  countPrev: number
  percentChange: number
  countPercentChange: number
  rank: number
  totalVolumeAllTime?: number
  averageMortgageSizeAllTime?: number
}

type ElxAssignmentRanking = {
  buyerId?: string
  buyerName?: string
  buyerType?: string
  buyerCategory?: string | null
  sellerId?: string
  sellerName?: string
  sellerType?: string
  sellerCategory?: string | null
  volume: number
  volumePrev?: number
  count: number
  countPrev?: number
  percentChange: number
  rank: number
  avgDealSize?: number
  windowInMonths?: number
}

// ─── Elementix fetch helper ───────────────────────────────────────────────────

async function elxFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!ELEMENTIX_KEY) return null
  try {
    const url = new URL(`${ELEMENTIX_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${ELEMENTIX_KEY}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      console.warn(`[elementix] ${path} → HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[elementix] ${path} fetch error:`, err)
    return null
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function maybeNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input) && input !== 0) return input
  if (typeof input === "string") {
    const cleaned = input.replace(/[$, ]/g, "")
    const n = Number(cleaned)
    return Number.isFinite(n) && n !== 0 ? n : null
  }
  return null
}

function maybeString(input: unknown): string {
  return String(input || "").trim()
}

function normalizeDate(input: unknown): string {
  const s = String(input || "").trim()
  if (!s) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

function guessPropertyType(text?: string): string | undefined {
  const t = (text || "").toLowerCase()
  if (!t) return undefined
  if (/multifamily|apartment|residential/.test(t)) return "multifamily"
  if (/office/.test(t)) return "office"
  if (/retail/.test(t)) return "retail"
  if (/industrial|warehouse/.test(t)) return "industrial"
  if (/mixed/.test(t)) return "mixed-use"
  if (/land|parcel/.test(t)) return "land"
  if (/commercial/.test(t)) return "commercial"
  return undefined
}

// ─── Elementix: Assignment of Mortgage records (FL) ──────────────────────────
// Strategy: fetch top FL AOM buyers from rankings, then pull their individual records in parallel

async function fetchElementixAssignments(): Promise<ResourcePayload<AssignmentRecord> | null> {
  if (!ELEMENTIX_KEY) return null

  // Step 1: Get top FL AOM buyers and top Private Money lenders in parallel
  const [rankings, privateLendersResp] = await Promise.all([
    elxFetch<{ data: ElxAssignmentRanking[] }>("/api/v1/assignments/rankings", {
      state: "FL",
      limit: "20",
    }),
    elxFetch<{ data: ElxLender[] }>("/api/v1/lenders", {
      lenderType: "Private Money",
      limit: "10",
    }),
  ])
  const topBuyers = (rankings?.data ?? []).slice(0, 15)
  const buyerIds = topBuyers.map((r) => r.buyerId).filter((id): id is string => !!id)

  const privateLenderIds = (privateLendersResp?.data ?? [])
    .map((l) => l.lenderId)
    .filter((id): id is string => !!id)

  const uniqueIds = Array.from(new Set([...buyerIds, ...privateLenderIds]))

  if (uniqueIds.length === 0) return null

  // Step 2: Fetch each participant's individual FL assignment records in parallel
  const assignmentSets = await Promise.all(
    uniqueIds.map((id) =>
      elxFetch<{ data: ElxAssignment[] }>(`/api/v1/lender/${id}/assignments`, {
        state: "FL",
        limit: "200",
      })
    )
  )

  // Step 3: Deduplicate by record ID and normalize to AssignmentRecord
  const seen = new Set<string>()
  const items: AssignmentRecord[] = []

  for (const set of assignmentSets) {
    for (const a of set?.data ?? []) {
      if (!a.id || seen.has(a.id)) continue
      seen.add(a.id)

      const date = normalizeDate(a.recordingDate)
      if (!date) continue

      const loanAmt = maybeNumber(a.loanAmount)
      const assignor = (a.originalLender || a.originalLenderRaw || "").trim()
      const assignee = (a.assigneeLender || a.assigneeLenderRaw || "").trim()
      if (!assignor && !assignee) continue

      const addressFull =
        a.addressDetails?.[0]?.addressFull ||
        (typeof a.addresses?.[0] === "string" ? a.addresses[0] : undefined)

      items.push({
        id: a.id,
        assignor,
        assignee,
        loanAmount: loanAmt,
        valueStatus: loanAmt !== null ? "known" : "unknown",
        valueSource: loanAmt !== null ? "assignment.loanAmount" : "unknown",
        recordingDate: date,
        property: addressFull || undefined,
        propertyType: guessPropertyType(addressFull),
        geography: [a.city, a.countyName, a.countyState].filter(Boolean).join(", ") || undefined,
        linkedMortgageId: a.mortgageId || undefined,
      })
    }
  }

  items.sort((a, b) => b.recordingDate.localeCompare(a.recordingDate))

  const known = items.filter((x) => x.valueStatus === "known").length
  const diagnostics: ResourceDiagnostics = {
    source: "external_api",
    totalFetched: items.length,
    notes: [
      `Elementix: ${uniqueIds.length} FL participants queried (top buyers + private creditors), ${items.length} unique AOM records.`,
      known === 0 ? "No loan amounts available in current batch." : "",
    ].filter(Boolean),
    extractionStats: {
      known_value_records: known,
      unknown_value_records: items.length - known,
      lenders_queried: uniqueIds.length,
    },
  }

  console.info("[participants-intel][assignments] Elementix diagnostics", diagnostics)
  return { items, diagnostics }
}

// ─── Elementix: Mortgage transactions (FL, business purpose) ─────────────────

async function fetchElementixMortgages(): Promise<ResourcePayload<MortgageRecord> | null> {
  if (!ELEMENTIX_KEY) return null

  const resp = await elxFetch<{ data: ElxTransaction[] }>("/api/v1/transactions", {
    state: "FL",
    isBusinessPurpose: "true",
    limit: "500",
  })

  const rawItems = (resp?.data ?? []).filter((t) => t.type === "mortgage")
  if (rawItems.length === 0) return null

  const items: MortgageRecord[] = rawItems.map((m) => ({
    id: m.id,
    lender: m.lenderName || m.partiesGrantee?.[0] || "",
    borrower: m.entityBorrowers?.[0]?.name || m.partiesGrantor?.[0] || "",
    amount: maybeNumber(m.amount) ?? undefined,
    mortgageAmount: maybeNumber(m.amount) ?? undefined,
    recordingDate: normalizeDate(m.recordingDate),
    property: m.addresses?.[0]?.addressFull || undefined,
    propertyType:
      m.propertySubtypes?.[0] ||
      m.propertyTypes?.[0] ||
      guessPropertyType(m.addresses?.[0]?.addressFull) ||
      undefined,
    geography: [m.city, m.countyName, m.countyState].filter(Boolean).join(", ") || undefined,
    raw: m as unknown as Record<string, unknown>,
  }))

  const diagnostics: ResourceDiagnostics = {
    source: "external_api",
    totalFetched: items.length,
    notes: [
      `Elementix: ${items.length} FL business-purpose mortgage transactions loaded.`,
      items.length === 500 ? "Result capped at 500 — some records may be excluded." : "",
    ].filter(Boolean),
  }

  console.info("[participants-intel][mortgages] Elementix diagnostics", diagnostics)
  return { items, diagnostics }
}

// ─── Elementix: Lender analytics ─────────────────────────────────────────────
// Combines national lender volume rankings with FL-specific AOM buyer activity

async function fetchElementixLenders(): Promise<ResourcePayload<LenderAnalyticsRecord> | null> {
  if (!ELEMENTIX_KEY) return null

  const [lendersResp, flBuyersResp] = await Promise.all([
    elxFetch<{ data: ElxLender[] }>("/api/v1/lenders", { limit: "200" }),
    elxFetch<{ data: ElxAssignmentRanking[] }>("/api/v1/assignments/rankings", {
      state: "FL",
      limit: "100",
    }),
  ])

  const lendersList = lendersResp?.data ?? []
  const flBuyers = flBuyersResp?.data ?? []

  if (lendersList.length === 0 && flBuyers.length === 0) return null

  // Build FL buyer map for trend overlay
  const flBuyerMap = new Map<string, { percentChange: number; volume: number }>()
  for (const r of flBuyers) {
    const name = r.buyerName || r.sellerName || ""
    if (name) flBuyerMap.set(name.toLowerCase(), { percentChange: r.percentChange, volume: r.volume })
  }

  const items: LenderAnalyticsRecord[] = lendersList.map((l) => {
    const flData = flBuyerMap.get(l.lenderName.toLowerCase())
    const pctChange = flData?.percentChange ?? l.percentChange
    return {
      lender: l.lenderName,
      volume: l.volume,
      marketShare: l.totalVolumeAllTime ? l.volume / l.totalVolumeAllTime : undefined,
      trend: pctChange > 5 ? "up" : pctChange < -5 ? "down" : "flat",
      lenderType: l.lenderType || undefined,
      avgDealSize: l.averageMortgageSizeAllTime || undefined,
      dealCount: l.count,
      countPrev: l.countPrev,
    }
  })

  // Append any FL-only assignment buyers not already in the national list
  const nationalNames = new Set(lendersList.map((l) => l.lenderName.toLowerCase()))
  for (const r of flBuyers) {
    const name = r.buyerName || r.sellerName || ""
    if (!name || nationalNames.has(name.toLowerCase())) continue
    items.push({
      lender: name,
      volume: r.volume,
      marketShare: undefined,
      trend: r.percentChange > 5 ? "up" : r.percentChange < -5 ? "down" : "flat",
      category: r.buyerCategory || r.sellerCategory || undefined,
      avgDealSize: r.avgDealSize || undefined,
      dealCount: r.count,
      countPrev: r.countPrev,
    })
  }

  items.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))

  const diagnostics: ResourceDiagnostics = {
    source: "external_api",
    totalFetched: items.length,
    notes: [
      `Elementix: ${lendersList.length} national lenders ranked, overlaid with ${flBuyers.length} FL AOM buyer rankings.`,
    ],
    extractionStats: {
      national_lenders: lendersList.length,
      fl_assignment_buyers: flBuyers.length,
    },
  }

  console.info("[participants-intel][lenders] Elementix diagnostics", diagnostics)
  return { items, diagnostics }
}

// ─── Elementix: Lender search ─────────────────────────────────────────────────

async function fetchElementixSearch(q: string): Promise<SearchEntityResult[] | null> {
  if (!ELEMENTIX_KEY || !q.trim()) return null

  const resp = await elxFetch<{ data: ElxLender[] } | ElxLender[]>("/api/v1/lender-search", {
    q: q.trim(),
    limit: "30",
  })

  const rawItems: ElxLender[] = Array.isArray(resp)
    ? resp
    : ((asObj(resp) as { data?: ElxLender[] } | null)?.data ?? [])

  if (rawItems.length === 0) return null

  return rawItems.map((r, idx) => ({
    id: r.lenderId || String(idx),
    name: r.lenderName || "",
    type: "lender" as const,
    location: r.address || undefined,
  }))
}

// ─── Local SQLite fallbacks ───────────────────────────────────────────────────

function recoverAssignmentValue(
  raw: Record<string, unknown>,
  mortgagesById: Map<string, MortgageRecord>,
  linkedMortgage?: MortgageRecord
): { value: number | null; source: AssignmentRecord["valueSource"] } {
  const directLoan = maybeNumber(raw.loanAmount)
  if (directLoan !== null) return { value: directLoan, source: "assignment.loanAmount" }
  const directAmount = maybeNumber(raw.amount)
  if (directAmount !== null) return { value: directAmount, source: "assignment.amount" }

  const linkedMortgageId = maybeString(raw.mortgageId || raw.mortgage_id || raw.linkedMortgageId)
  const linked = linkedMortgage || (linkedMortgageId ? mortgagesById.get(linkedMortgageId) : undefined)
  const linkedMortgageAmount = maybeNumber(linked?.mortgageAmount)
  if (linkedMortgageAmount !== null) return { value: linkedMortgageAmount, source: "linkedMortgage.mortgageAmount" }
  const linkedLoanAmount = maybeNumber(linked?.loanAmount)
  if (linkedLoanAmount !== null) return { value: linkedLoanAmount, source: "linkedMortgage.loanAmount" }
  const relatedAmount = maybeNumber(linked?.amount)
  if (relatedAmount !== null) return { value: relatedAmount, source: "relatedMortgage.amount" }

  return { value: null, source: "unknown" }
}

function loadAssignmentsFromAomSqlite(): ResourcePayload<AssignmentRecord> {
  const dbPath = path.join(process.cwd(), "data", "aom.sqlite")
  if (!fs.existsSync(dbPath)) {
    return {
      items: [],
      diagnostics: {
        source: "local_fallback",
        totalFetched: 0,
        notes: ["AOM sqlite not found at data/aom.sqlite."],
      },
    }
  }
  const db = new Database(dbPath, { readonly: true })
  try {
    const cols = db.prepare("PRAGMA table_info(aom_events)").all() as Array<{ name: string }>
    const has = new Set(cols.map((c) => c.name))
    const amountExpr = [
      has.has("upb") ? "NULLIF(upb,0)" : null,
      has.has("consideration_1") ? "NULLIF(consideration_1,0)" : null,
      has.has("consideration_2") ? "NULLIF(consideration_2,0)" : null,
      has.has("loan_amount") ? "NULLIF(loan_amount,0)" : null,
      has.has("amount") ? "NULLIF(amount,0)" : null,
    ]
      .filter(Boolean)
      .join(", ")
    const propertyExpr = has.has("property_address")
      ? "property_address"
      : has.has("property")
        ? "property"
        : has.has("legal_description")
          ? "legal_description"
          : "NULL"
    const rows = db
      .prepare(
        `
        SELECT
          CAST(id AS TEXT) AS id,
          trim(first_party) AS assignor,
          trim(second_party) AS assignee,
          ${amountExpr ? `COALESCE(${amountExpr})` : "NULL"} AS loan_amount,
          event_date AS recording_date,
          ${propertyExpr} AS property,
          city,
          county,
          state,
          upb,
          consideration_1,
          consideration_2
        FROM aom_events
        WHERE event_date IS NOT NULL
          AND trim(coalesce(first_party,'')) <> ''
          AND trim(coalesce(second_party,'')) <> ''
        ORDER BY event_date DESC, id DESC
        LIMIT 10000
      `
      )
      .all() as Array<{
      id: string
      assignor: string
      assignee: string
      loan_amount?: number | string | null
      recording_date: string
      property?: string | null
      city?: string | null
      county?: string | null
      state?: string | null
      upb?: number | string | null
      consideration_1?: number | string | null
      consideration_2?: number | string | null
    }>
    const items = rows
      .map((r) => ({
        id: r.id,
        assignor: r.assignor || "",
        assignee: r.assignee || "",
        loanAmount: maybeNumber(r.loan_amount),
        valueStatus: (maybeNumber(r.loan_amount) !== null ? "known" : "unknown") as "known" | "unknown",
        valueSource: (maybeNumber(r.upb) !== null ? "aom.upb" : maybeNumber(r.consideration_1) !== null || maybeNumber(r.consideration_2) !== null ? "aom.consideration" : "unknown") as AssignmentRecord["valueSource"],
        recordingDate: normalizeDate(r.recording_date),
        property: (r.property || "").trim() || undefined,
        propertyType: guessPropertyType(maybeString(r.property)),
        geography: [maybeString(r.city), maybeString(r.county), maybeString(r.state)].filter(Boolean).join(", ") || undefined,
      }))
      .filter((r) => r.recordingDate)
    const known = items.filter((x) => x.valueStatus === "known").length
    const unknown = items.length - known
    const diagnostics: ResourceDiagnostics = {
      source: "local_fallback",
      totalFetched: items.length,
      notes: [
        "Loaded from local AOM fallback store.",
        known === 0 ? "No monetary value fields are populated in current AOM dataset (UPB/consideration unavailable)." : "",
      ].filter(Boolean),
      extractionStats: {
        known_value_records: known,
        unknown_value_records: unknown,
      },
    }
    return { items, diagnostics }
  } finally {
    db.close()
  }
}

function loadPreforeclosuresFromIngestionSqlite(): ResourcePayload<PreforeclosureRecord> {
  const dbPath = path.join(process.cwd(), "data", "ingestion.sqlite")
  if (!fs.existsSync(dbPath)) {
    return {
      items: [],
      diagnostics: {
        source: "local_fallback",
        totalFetched: 0,
        notes: ["Local ingestion sqlite missing (data/ingestion.sqlite)."],
      },
    }
  }
  const db = new Database(dbPath, { readonly: true })
  try {
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foreclosure_notices'")
      .all() as Array<{ name: string }>
    if (!tableRows.length) {
      return {
        items: [],
        diagnostics: {
          source: "local_fallback",
          totalFetched: 0,
          notes: ["No foreclosure_notices table found in ingestion sqlite."],
        },
      }
    }
    const cols = db.prepare("PRAGMA table_info(foreclosure_notices)").all() as Array<{ name: string }>
    const has = new Set(cols.map((c) => c.name))
    const plaintiffExpr = has.has("plaintiff") ? "plaintiff" : has.has("lender") ? "lender" : "NULL"
    const defendantExpr = has.has("defendant") ? "defendant" : has.has("borrower") ? "borrower" : "NULL"
    const lenderExpr = has.has("lender") ? "lender" : "NULL"
    const auctionExpr = has.has("auction_date") ? "auction_date" : has.has("filed_date") ? "filed_date" : "NULL"
    const amountExpr = has.has("loan_amount") ? "loan_amount" : has.has("amount") ? "amount" : "NULL"
    const propertyExpr = has.has("property_address") ? "property_address" : has.has("property") ? "property" : "NULL"

    const rows = db
      .prepare(
        `
        SELECT
          CAST(id AS TEXT) AS id,
          ${plaintiffExpr} AS plaintiff,
          ${defendantExpr} AS defendant,
          ${lenderExpr} AS lender,
          ${auctionExpr} AS auction_date,
          ${amountExpr} AS loan_amount,
          ${propertyExpr} AS property
        FROM foreclosure_notices
        ORDER BY COALESCE(${auctionExpr}, '') DESC, id DESC
        LIMIT 10000
      `
      )
      .all() as Array<{
      id: string
      plaintiff?: string | null
      defendant?: string | null
      lender?: string | null
      auction_date?: string | null
      loan_amount?: number | string | null
      property?: string | null
    }>

    const items = rows
      .map((r) => ({
        id: r.id,
        plaintiff: (r.plaintiff || "").trim(),
        defendant: (r.defendant || "").trim(),
        lender: (r.lender || "").trim() || undefined,
        auctionDate: normalizeDate(r.auction_date),
        loanAmount: maybeNumber(r.loan_amount) ?? undefined,
        property: (r.property || "").trim() || undefined,
        propertyType: guessPropertyType((r.property || "").trim()),
        geography: undefined,
      }))
      .filter((r) => r.auctionDate)
    const diagnostics: ResourceDiagnostics = {
      source: "local_fallback",
      totalFetched: items.length,
      notes: items.length === 0 ? ["No preforeclosure records were returned for the selected scope/window."] : ["Loaded from local foreclosure_notices table."],
    }
    return { items, diagnostics }
  } finally {
    db.close()
  }
}

function loadMortgagesFromLocal(): ResourcePayload<MortgageRecord> {
  return {
    items: [],
    diagnostics: {
      source: "local_fallback",
      totalFetched: 0,
      notes: ["No local mortgage table available; Elementix API key may be missing or returned no data."],
    },
  }
}

function deriveLenders(assignments: AssignmentRecord[], preforeclosures: PreforeclosureRecord[]): LenderAnalyticsRecord[] {
  const map = new Map<string, { volume: number; count: number }>()
  for (const a of assignments) {
    const lender = (a.assignee || "").trim()
    if (!lender) continue
    const curr = map.get(lender) || { volume: 0, count: 0 }
    curr.volume += Number(a.loanAmount || 0)
    curr.count += 1
    map.set(lender, curr)
  }
  for (const p of preforeclosures) {
    const lender = (p.lender || p.plaintiff || "").trim()
    if (!lender) continue
    const curr = map.get(lender) || { volume: 0, count: 0 }
    curr.count += 1
    map.set(lender, curr)
  }
  const totalVolume = Array.from(map.values()).reduce((s, v) => s + v.volume, 0)
  return Array.from(map.entries())
    .map(([lender, v]) => ({
      lender,
      volume: v.volume,
      marketShare: totalVolume > 0 ? v.volume / totalVolume : 0,
      trend: "flat" as const,
    }))
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
}

function localSearch(
  q: string,
  assignments: AssignmentRecord[],
  mortgages: MortgageRecord[],
  preforeclosures: PreforeclosureRecord[],
  lenders: LenderAnalyticsRecord[]
): SearchEntityResult[] {
  const query = q.toLowerCase().trim()
  if (!query) return []
  const out = new Map<string, SearchEntityResult>()
  const add = (name: string, type: SearchEntityResult["type"], location?: string) => {
    const n = name.trim()
    if (!n || !n.toLowerCase().includes(query)) return
    const key = `${type}:${n.toLowerCase()}`
    if (!out.has(key)) out.set(key, { id: key, name: n, type, location })
  }
  for (const a of assignments) {
    add(a.assignor, "firm")
    add(a.assignee, "firm")
  }
  for (const m of mortgages) {
    add(m.lender, "lender")
    add(m.borrower, "firm")
  }
  for (const p of preforeclosures) {
    add(p.plaintiff, "lender")
    add(p.defendant, "firm")
    if (p.lender) add(p.lender, "lender")
  }
  for (const l of lenders) add(l.lender, "lender")
  return Array.from(out.values()).slice(0, 100)
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const resource = (req.nextUrl.searchParams.get("resource") || "").trim() as Resource
  const q = (req.nextUrl.searchParams.get("q") || "").trim()

  if (!resource) {
    return NextResponse.json({ error: "resource is required" }, { status: 400 })
  }

  // ── Assignments ──────────────────────────────────────────────────────────────
  if (resource === "assignments") {
    const elementix = await fetchElementixAssignments()
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<AssignmentRecord>)
    const fallback = loadAssignmentsFromAomSqlite()
    console.info("[participants-intel][assignments] using SQLite fallback, diagnostics:", fallback.diagnostics)
    return NextResponse.json(fallback)
  }

  // ── Mortgages ────────────────────────────────────────────────────────────────
  if (resource === "mortgages") {
    const elementix = await fetchElementixMortgages()
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<MortgageRecord>)
    const fallback = loadMortgagesFromLocal()
    console.info("[participants-intel][mortgages] using local fallback, diagnostics:", fallback.diagnostics)
    return NextResponse.json(fallback)
  }

  // ── Preforeclosures ──────────────────────────────────────────────────────────
  // No Elementix endpoint available — always uses local SQLite
  if (resource === "preforeclosures") {
    const fallback = loadPreforeclosuresFromIngestionSqlite()
    console.info("[participants-intel][preforeclosures] diagnostics:", fallback.diagnostics)
    return NextResponse.json(fallback)
  }

  // ── Lenders ──────────────────────────────────────────────────────────────────
  if (resource === "lenders") {
    const elementix = await fetchElementixLenders()
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<LenderAnalyticsRecord>)
    const assignmentsPayload = loadAssignmentsFromAomSqlite()
    const prePayload = loadPreforeclosuresFromIngestionSqlite()
    const items = deriveLenders(assignmentsPayload.items, prePayload.items)
    const diagnostics: ResourceDiagnostics = {
      source: "local_fallback",
      totalFetched: items.length,
      notes: ["Derived lender analytics from local AOM/preforeclosure fallback data."],
    }
    console.info("[participants-intel][lenders] using SQLite fallback, diagnostics:", diagnostics)
    return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<LenderAnalyticsRecord>)
  }

  // ── Search ───────────────────────────────────────────────────────────────────
  if (resource === "search") {
    const elementixResults = await fetchElementixSearch(q)
    if (elementixResults && elementixResults.length > 0) {
      const diagnostics: ResourceDiagnostics = {
        source: "external_api",
        totalFetched: elementixResults.length,
        notes: [`Elementix lender search: ${elementixResults.length} results for "${q}".`],
      }
      return NextResponse.json({ items: elementixResults, diagnostics } satisfies ResourcePayload<SearchEntityResult>)
    }
    // Local fallback search
    const assignments = loadAssignmentsFromAomSqlite()
    const pre = loadPreforeclosuresFromIngestionSqlite()
    const mortgages = loadMortgagesFromLocal()
    const lenders = deriveLenders(assignments.items, pre.items)
    const items = localSearch(q, assignments.items, mortgages.items, pre.items, lenders)
    const diagnostics: ResourceDiagnostics = {
      source: "local_fallback",
      totalFetched: items.length,
      notes: ["Search results from local fallback datasets."],
    }
    return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<SearchEntityResult>)
  }

  return NextResponse.json({ error: "invalid resource" }, { status: 400 })
}
