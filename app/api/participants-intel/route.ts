import { NextRequest, NextResponse } from "next/server"
import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"
import type {
  AssignmentRecord,
  LenderAnalyticsRecord,
  MortgageRecord,
  PreforeclosureRecord,
  SearchEntityResult,
} from "@/lib/participants-intel/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Resource = "assignments" | "mortgages" | "preforeclosures" | "lenders" | "search"

const EXTERNAL_BASE = process.env.PARTICIPANTS_API_BASE_URL?.trim()
const EXTERNAL_KEY = process.env.PARTICIPANTS_API_KEY?.trim()

async function fetchExternal<T>(resource: Resource, q?: string): Promise<T | null> {
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
    return (await res.json()) as T
  } catch {
    return null
  }
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

function loadAssignmentsFromAomSqlite(): AssignmentRecord[] {
  const dbPath = path.join(process.cwd(), "data", "aom.sqlite")
  if (!fs.existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    const cols = db.prepare("PRAGMA table_info(aom_events)").all() as Array<{ name: string }>
    const has = new Set(cols.map((c) => c.name))
    const amountExpr = has.has("loan_amount")
      ? "loan_amount"
      : has.has("amount")
        ? "amount"
        : has.has("consideration")
          ? "consideration"
          : "NULL"
    const propertyExpr = has.has("property_address")
      ? "property_address"
      : has.has("property")
        ? "property"
        : "NULL"
    const rows = db
      .prepare(
        `
        SELECT
          CAST(id AS TEXT) AS id,
          trim(first_party) AS assignor,
          trim(second_party) AS assignee,
          ${amountExpr} AS loan_amount,
          event_date AS recording_date,
          ${propertyExpr} AS property
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
    }>
    return rows
      .map((r) => ({
        id: r.id,
        assignor: r.assignor || "",
        assignee: r.assignee || "",
        loanAmount: Number(r.loan_amount || 0) || 0,
        recordingDate: normalizeDate(r.recording_date),
        property: (r.property || "").trim() || undefined,
      }))
      .filter((r) => r.recordingDate)
  } finally {
    db.close()
  }
}

function loadPreforeclosuresFromIngestionSqlite(): PreforeclosureRecord[] {
  const dbPath = path.join(process.cwd(), "data", "ingestion.sqlite")
  if (!fs.existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foreclosure_notices'")
      .all() as Array<{ name: string }>
    if (!tableRows.length) return []
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

    return rows
      .map((r) => ({
        id: r.id,
        plaintiff: (r.plaintiff || "").trim(),
        defendant: (r.defendant || "").trim(),
        lender: (r.lender || "").trim() || undefined,
        auctionDate: normalizeDate(r.auction_date),
        loanAmount: Number(r.loan_amount || 0) || undefined,
        property: (r.property || "").trim() || undefined,
      }))
      .filter((r) => r.auctionDate)
  } finally {
    db.close()
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
    const external = await fetchExternal<{ items?: AssignmentRecord[] }>("assignments")
    const items = external?.items ?? loadAssignmentsFromAomSqlite()
    return NextResponse.json({ items })
  }
  if (resource === "mortgages") {
    const external = await fetchExternal<{ items?: MortgageRecord[] }>("mortgages")
    return NextResponse.json({ items: external?.items ?? [] })
  }
  if (resource === "preforeclosures") {
    const external = await fetchExternal<{ items?: PreforeclosureRecord[] }>("preforeclosures")
    const items = external?.items ?? loadPreforeclosuresFromIngestionSqlite()
    return NextResponse.json({ items })
  }
  if (resource === "lenders") {
    const external = await fetchExternal<{ items?: LenderAnalyticsRecord[] }>("lenders")
    if (external?.items?.length) return NextResponse.json({ items: external.items })
    const assignments = loadAssignmentsFromAomSqlite()
    const pre = loadPreforeclosuresFromIngestionSqlite()
    return NextResponse.json({ items: deriveLenders(assignments, pre) })
  }
  if (resource === "search") {
    const external = await fetchExternal<{ items?: SearchEntityResult[] }>("search", q)
    if (external?.items) return NextResponse.json({ items: external.items })
    const assignments = loadAssignmentsFromAomSqlite()
    const pre = loadPreforeclosuresFromIngestionSqlite()
    const mortgages: MortgageRecord[] = []
    const lenders = deriveLenders(assignments, pre)
    return NextResponse.json({ items: localSearch(q, assignments, mortgages, pre, lenders) })
  }

  return NextResponse.json({ error: "invalid resource" }, { status: 400 })
}

