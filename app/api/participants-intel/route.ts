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
 * Developer notes:
 * - Assignment value recovery order:
 *   1) assignment.loanAmount
 *   2) assignment.amount
 *   3) linked mortgage.mortgageAmount
 *   4) linked mortgage.loanAmount
 *   5) related mortgage.amount
 *   6) local fallback aom.upb / aom.consideration_* (when available)
 *   7) unknown
 * - Missing values are returned as null + valueStatus="unknown" (never coerced to zero).
 * - Mortgages and preforeclosures prefer external API; local fallback coverage depends on local sqlite tables.
 */

type Resource = "assignments" | "mortgages" | "preforeclosures" | "lenders" | "search"

const EXTERNAL_BASE = process.env.PARTICIPANTS_API_BASE_URL?.trim()
const EXTERNAL_KEY = process.env.PARTICIPANTS_API_KEY?.trim()

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function pickFirstArray(obj: Record<string, unknown>): unknown[] | null {
  const keys = ["items", "data", "results", "records", "rows", "assignments", "mortgages", "preforeclosures", "entities"]
  for (const k of keys) {
    const v = obj[k]
    if (Array.isArray(v)) return v
  }
  return null
}

function maybeNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input
  if (typeof input === "string") {
    const cleaned = input.replace(/[$, ]/g, "")
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
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

async function fetchExternal<T>(resource: Resource, q?: string): Promise<{ items: T[]; diagnostics: ResourceDiagnostics } | null> {
  if (!EXTERNAL_BASE) return null
  const endpointMap: Record<Resource, string> = {
    assignments: "/assignments",
    mortgages: "/mortgages",
    preforeclosures: "/preforeclosures",
    lenders: "/lenders",
    search: "/entities/search",
  }
  const url = new URL(`${EXTERNAL_BASE.replace(/\/+$/, "")}${endpointMap[resource]}`)
  if (q) url.searchParams.set("q", q)
  const headers: Record<string, string> = {}
  if (EXTERNAL_KEY) headers.Authorization = `Bearer ${EXTERNAL_KEY}`
  try {
    const res = await fetch(url.toString(), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const raw = (await res.json()) as unknown
    const obj = asObj(raw)
    let items: unknown[] = []
    if (Array.isArray(raw)) items = raw
    else if (obj) items = pickFirstArray(obj) || []
    return {
      items: items as T[],
      diagnostics: {
        source: "external_api",
        totalFetched: items.length,
        notes: [],
        extractionStats: {},
      },
    }
  } catch {
    return null
  }
}

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
        valueStatus: maybeNumber(r.loan_amount) !== null ? "known" : "unknown",
        valueSource: maybeNumber(r.upb) !== null ? "aom.upb" : maybeNumber(r.consideration_1) !== null || maybeNumber(r.consideration_2) !== null ? "aom.consideration" : "unknown",
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
      notes: ["No local mortgage table currently available in fallback stores."],
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

export async function GET(req: NextRequest) {
  const resource = (req.nextUrl.searchParams.get("resource") || "").trim() as Resource
  const q = (req.nextUrl.searchParams.get("q") || "").trim()

  if (!resource) {
    return NextResponse.json({ error: "resource is required" }, { status: 400 })
  }

  if (resource === "assignments") {
    const external = await fetchExternal<Record<string, unknown>>("assignments")
    const mortgages = await fetchExternal<Record<string, unknown>>("mortgages")
    const mortgageItems = mortgages?.items ?? []
    const mortgagesById = new Map<string, MortgageRecord>(
      mortgageItems.map((m) => [maybeString(m.id || m.mortgageId || m.mortgage_id), {
        id: maybeString(m.id || m.mortgageId || m.mortgage_id),
        lender: maybeString(m.lender || m.lenderName),
        borrower: maybeString(m.borrower || m.borrowerName),
        amount: maybeNumber(m.amount) ?? undefined,
        mortgageAmount: maybeNumber(m.mortgageAmount) ?? undefined,
        loanAmount: maybeNumber(m.loanAmount) ?? undefined,
        recordingDate: normalizeDate(m.recordingDate || m.recording_date),
      }])
    )

    if (external?.items) {
      const items = external.items.map((a, idx) => {
        const linkedMortgageId = maybeString(a.mortgageId || a.mortgage_id || a.linkedMortgageId)
        const linked = linkedMortgageId ? mortgagesById.get(linkedMortgageId) : undefined
        const recovered = recoverAssignmentValue(a, mortgagesById, linked)
        return {
          id: maybeString(a.id || a.assignmentId || idx),
          assignor: maybeString(a.assignor || a.fromParty || a.from_party || a.firstParty),
          assignee: maybeString(a.assignee || a.toParty || a.to_party || a.secondParty),
          loanAmount: recovered.value,
          valueStatus: recovered.value !== null ? "known" : "unknown",
          valueSource: recovered.source,
          recordingDate: normalizeDate(a.recordingDate || a.recording_date || a.date || a.filingDate),
          property: maybeString(a.property || a.address || a.propertyAddress || a.collateralAddress) || undefined,
          propertyType: maybeString(a.propertyType || a.useType || a.assetType) || undefined,
          geography: maybeString(a.geography || a.market || a.cityState || a.county) || undefined,
          linkedMortgageId: linkedMortgageId || undefined,
          raw: a,
        } satisfies AssignmentRecord
      }).filter((x) => x.recordingDate)
      const known = items.filter((x) => x.valueStatus === "known").length
      const diagnostics: ResourceDiagnostics = {
        source: "external_api",
        totalFetched: items.length,
        notes: [],
        extractionStats: {
          known_value_records: known,
          unknown_value_records: items.length - known,
          mortgages_available_for_linking: mortgageItems.length,
        },
      }
      console.info("[participants-intel][assignments] diagnostics", diagnostics)
      return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<AssignmentRecord>)
    }

    const fallback = loadAssignmentsFromAomSqlite()
    console.info("[participants-intel][assignments] diagnostics", fallback.diagnostics)
    return NextResponse.json(fallback)
  }
  if (resource === "mortgages") {
    const external = await fetchExternal<Record<string, unknown>>("mortgages")
    if (external?.items) {
      const items = external.items.map((m, idx) => ({
        id: maybeString(m.id || m.mortgageId || m.mortgage_id || idx),
        lender: maybeString(m.lender || m.lenderName),
        borrower: maybeString(m.borrower || m.borrowerName),
        amount: maybeNumber(m.amount) ?? undefined,
        mortgageAmount: maybeNumber(m.mortgageAmount) ?? undefined,
        loanAmount: maybeNumber(m.loanAmount) ?? undefined,
        recordingDate: normalizeDate(m.recordingDate || m.recording_date || m.date),
        linkedAssignmentIds: Array.isArray(m.linkedAssignmentIds) ? (m.linkedAssignmentIds as string[]) : undefined,
        property: maybeString(m.property || m.address || m.propertyAddress) || undefined,
        propertyType: maybeString(m.propertyType || m.useType || m.assetType) || undefined,
        geography: maybeString(m.geography || m.market || m.county || m.cityState) || undefined,
        raw: m,
      } satisfies MortgageRecord))
      const diagnostics: ResourceDiagnostics = {
        source: "external_api",
        totalFetched: items.length,
        notes: items.length === 0 ? ["No mortgage records were returned for the selected scope/window."] : [],
      }
      console.info("[participants-intel][mortgages] diagnostics", diagnostics)
      return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<MortgageRecord>)
    }
    const fallback = loadMortgagesFromLocal()
    console.info("[participants-intel][mortgages] diagnostics", fallback.diagnostics)
    return NextResponse.json(fallback)
  }
  if (resource === "preforeclosures") {
    const external = await fetchExternal<Record<string, unknown>>("preforeclosures")
    if (external?.items) {
      const items = external.items.map((p, idx) => ({
        id: maybeString(p.id || p.preforeclosureId || p.noticeId || idx),
        plaintiff: maybeString(p.plaintiff || p.lender || p.creditor),
        defendant: maybeString(p.defendant || p.borrower || p.debtor),
        lender: maybeString(p.lender || p.plaintiff || p.creditor) || undefined,
        auctionDate: normalizeDate(p.auctionDate || p.auction_date || p.date || p.filedDate),
        loanAmount: maybeNumber(p.loanAmount || p.amount || p.claimAmount) ?? undefined,
        property: maybeString(p.property || p.address || p.propertyAddress) || undefined,
        propertyType: maybeString(p.propertyType || p.useType || p.assetType) || undefined,
        geography: maybeString(p.geography || p.market || p.county || p.cityState) || undefined,
        raw: p,
      } satisfies PreforeclosureRecord)).filter((x) => x.auctionDate)
      const diagnostics: ResourceDiagnostics = {
        source: "external_api",
        totalFetched: items.length,
        notes: items.length === 0 ? ["No preforeclosure records were returned for the selected scope/window."] : [],
      }
      console.info("[participants-intel][preforeclosures] diagnostics", diagnostics)
      return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<PreforeclosureRecord>)
    }
    const fallback = loadPreforeclosuresFromIngestionSqlite()
    console.info("[participants-intel][preforeclosures] diagnostics", fallback.diagnostics)
    return NextResponse.json(fallback)
  }
  if (resource === "lenders") {
    const external = await fetchExternal<Record<string, unknown>>("lenders")
    if (external?.items) {
      const items = external.items.map((l) => ({
        lender: maybeString(l.lender || l.name || l.entityName),
        volume: maybeNumber(l.volume) ?? undefined,
        marketShare: maybeNumber(l.marketShare) ?? undefined,
        trend: ["up", "down", "flat"].includes(maybeString(l.trend)) ? (maybeString(l.trend) as "up" | "down" | "flat") : undefined,
      } satisfies LenderAnalyticsRecord))
      const diagnostics: ResourceDiagnostics = {
        source: "external_api",
        totalFetched: items.length,
        notes: [],
      }
      console.info("[participants-intel][lenders] diagnostics", diagnostics)
      return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<LenderAnalyticsRecord>)
    }
    const assignmentsPayload = loadAssignmentsFromAomSqlite()
    const prePayload = loadPreforeclosuresFromIngestionSqlite()
    const items = deriveLenders(assignmentsPayload.items, prePayload.items)
    const diagnostics: ResourceDiagnostics = {
      source: "local_fallback",
      totalFetched: items.length,
      notes: ["Derived lender analytics from assignments/preforeclosures fallback data."],
    }
    console.info("[participants-intel][lenders] diagnostics", diagnostics)
    return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<LenderAnalyticsRecord>)
  }
  if (resource === "search") {
    const external = await fetchExternal<Record<string, unknown>>("search", q)
    if (external?.items) {
      const items = external.items.map((r, idx) => ({
        id: maybeString(r.id || idx),
        name: maybeString(r.name || r.entityName || r.fullName),
        type: (["firm", "person", "lender"].includes(maybeString(r.type).toLowerCase()) ? maybeString(r.type).toLowerCase() : "firm") as "firm" | "person" | "lender",
        location: maybeString(r.location || r.geography || r.cityState) || undefined,
      } satisfies SearchEntityResult))
      const diagnostics: ResourceDiagnostics = {
        source: "external_api",
        totalFetched: items.length,
        notes: [],
      }
      return NextResponse.json({ items, diagnostics } satisfies ResourcePayload<SearchEntityResult>)
    }
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

