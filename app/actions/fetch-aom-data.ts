"use server"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs/promises"
import { classifyParticipantRole } from "@/app/lib/participant-activity"

const execFileAsync = promisify(execFile)
const SQLITE3_CANDIDATES = ["sqlite3", "/usr/bin/sqlite3"] as const

export type AomPartyAgg = {
  name: string
  count: number
}

export type AomMonthlyPoint = {
  month: string // YYYY-MM
  count: number
}

export type AomSummary = {
  totalEvents: number
  dateMin?: string
  dateMax?: string
  docTypeCounts: Array<{ docType: string; count: number }>
  topAssignors: AomPartyAgg[]
  topAssignees: AomPartyAgg[]
  monthlyCounts: AomMonthlyPoint[]
  notes: string[]
}

export type AomEventRow = {
  event_date?: string
  doc_type?: string
  first_party?: string
  second_party?: string
  cfn_master_id?: string
  city?: string
  county?: string
  state?: string
}

export type AomSearchResponse = {
  query: string
  count: number
  rows: AomEventRow[]
  notes: string[]
}

export type AomFirmMonthly = {
  month: string // YYYY-MM
  inbound: number
  outbound: number
  net: number
}

export type AomFirmStat = {
  firm: string
  inbound: number
  outbound: number
  net: number
  total: number
  lastEventDate?: string
  monthly: AomFirmMonthly[]
  topCounterparties: Array<{ name: string; count: number }>
  /** Enhanced 30d/90d metrics */
  inbound_30d?: number
  outbound_30d?: number
  net_30d?: number
  total_30d?: number
  inbound_90d?: number
  outbound_90d?: number
  net_90d?: number
  total_90d?: number
  trend_30d?: "up" | "down" | "flat"
  trend_90d?: "up" | "down" | "flat"
  role?: string
}

export type AomUnmatchedParty = {
  name: string
  count: number
  role: "assignor" | "assignee"
}

export type AomFirmInsights = {
  scope: "watchlist" | "all"
  totalEventsScanned: number
  months: string[]
  firms: AomFirmStat[]
  unmatched: AomUnmatchedParty[]
  notes: string[]
}

export type AomFirmGraph = {
  monthsBack: number
  scope: "watchlist" | "all"
  focalFirm?: string
  depth: 1 | 2
  minEdgeCount: number
  nodes: Array<{ id: string; name: string }>
  links: Array<{ source: number; target: number; value: number }>
  outbound: Array<{ counterparty: string; count: number }>
  inbound: Array<{ counterparty: string; count: number }>
  notes: string[]
}

function aomDbPath() {
  // `app/actions/*` runs from project root; resolve relative to repo.
  return path.join(process.cwd(), "data", "aom.sqlite")
}

async function execSqliteJson<T>(db: string, sql: string, notes?: string[]): Promise<T> {
  let lastError: unknown
  for (const bin of SQLITE3_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(bin, ["-json", db, sql], { timeout: 30_000 })
      const text = String(stdout || "").trim()
      return (text ? JSON.parse(text) : []) as T
    } catch (err) {
      lastError = err
    }
  }
  if (notes) {
    const message =
      lastError instanceof Error ? lastError.message : typeof lastError === "string" ? lastError : "Unknown error"
    notes.push(`sqlite3 execution failed: ${message}`)
  }
  return [] as unknown as T
}

async function execSqliteText(db: string, sql: string, notes?: string[]): Promise<string> {
  let lastError: unknown
  for (const bin of SQLITE3_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(bin, [db, sql], { timeout: 15_000 })
      return String(stdout || "")
    } catch (err) {
      lastError = err
    }
  }
  if (notes) {
    const message =
      lastError instanceof Error ? lastError.message : typeof lastError === "string" ? lastError : "Unknown error"
    notes.push(`sqlite3 execution failed: ${message}`)
  }
  return ""
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

async function readJsonFile<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function loadWatchlistAndAliases(): Promise<{
  watchlist: string[]
  watchlistSet: Set<string>
  aliasesByFirm: Record<string, string[]>
  aliasLookup: Map<string, string>
}> {
  const { loadWatchlistData } = await import("@/app/lib/watchlist")
  const data = await loadWatchlistData()
  return {
    watchlist: data.watchlist,
    watchlistSet: data.watchlistSet,
    aliasesByFirm: data.aliasesByFirm,
    aliasLookup: data.aliasLookup,
  }
}

async function ensureDb() {
  const db = aomDbPath()
  try {
    await fs.access(db)
  } catch {
    return { ok: false as const, db, reason: "missing" as const }
  }

  try {
    const stdout = await execSqliteText(db, "select count(*) from aom_events;")
    const n = Number(String(stdout).trim())
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false as const, db, reason: "empty" as const }
    }
    return { ok: true as const, db, count: n }
  } catch {
    return { ok: false as const, db, reason: "unreadable" as const }
  }
}

async function fetchRecentAomParties(options: {
  monthsBack: number
}): Promise<Array<{ event_date: string; first_party?: string; second_party?: string }>> {
  const ready = await ensureDb()
  if (!ready.ok) return []

  const monthsBack = Math.max(1, Math.min(120, options.monthsBack))
  const sql = `
WITH bounds AS (select max(event_date) as maxd from aom_events)
select
  event_date,
  trim(first_party) as first_party,
  trim(second_party) as second_party
from aom_events, bounds
where event_date is not null
  and length(event_date) >= 10
  and date(event_date) >= date(bounds.maxd, '-${monthsBack} months')
;`

  return await execSqliteJson<Array<{ event_date: string; first_party?: string; second_party?: string }>>(
    ready.db,
    sql
  )
}

export async function fetchAomSummary(options?: {
  limitParties?: number
  months?: number
}): Promise<AomSummary> {
  const notes: string[] = []
  const ready = await ensureDb()
  if (!ready.ok) {
    notes.push(
      ready.reason === "missing"
        ? "AOM database not found at data/aom.sqlite."
        : "AOM database exists but has no rows."
    )
    notes.push("Build it from your monthly AOM files into data/aom.sqlite before using this panel.")
    return {
      totalEvents: 0,
      docTypeCounts: [],
      topAssignors: [],
      topAssignees: [],
      monthlyCounts: [],
      notes,
    }
  }

  const limitParties = Math.max(5, Math.min(50, options?.limitParties ?? 15))
  const months = Math.max(6, Math.min(48, options?.months ?? 24))

  const db = ready.db
  const qCount = "select count(*) as total, min(event_date) as dateMin, max(event_date) as dateMax from aom_events;"
  const qDocTypes = `select coalesce(doc_type,'Unknown') as docType, count(*) as count
from aom_events
group by coalesce(doc_type,'Unknown')
order by count desc
limit 20;`
  const qAssignors = `select trim(coalesce(first_party,'Unknown')) as name, count(*) as count
from aom_events
where first_party is not null and trim(first_party) != ''
group by trim(first_party)
order by count desc
limit ${limitParties};`
  const qAssignees = `select trim(coalesce(second_party,'Unknown')) as name, count(*) as count
from aom_events
where second_party is not null and trim(second_party) != ''
group by trim(second_party)
order by count desc
limit ${limitParties};`
  const qMonthly = `select substr(event_date,1,7) as month, count(*) as count
from aom_events
where event_date is not null and length(event_date) >= 7
group by substr(event_date,1,7)
order by month desc
limit ${months};`

  const runJson = async <T,>(sql: string, fallback: T): Promise<T> => {
    try {
      const out = await execSqliteJson<T>(db, sql, notes)
      // execSqliteJson returns [] by default; if caller expects non-array, keep fallback behavior.
      if (out === ([]) && typeof fallback !== "object") return fallback
      return (out as unknown as T) ?? fallback
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
      notes.push(`AOM query failed: ${message}`)
      return fallback
    }
  }

  const countRows = await runJson<Array<{ total: number; dateMin?: string; dateMax?: string }>>(qCount, [])
  const [{ total, dateMin, dateMax } = { total: 0 }] = countRows
  const docTypeCounts = await runJson<Array<{ docType: string; count: number }>>(qDocTypes, [])
  const topAssignors = await runJson<AomPartyAgg[]>(qAssignors, [])
  const topAssignees = await runJson<AomPartyAgg[]>(qAssignees, [])
  const monthlyCountsDesc = await runJson<AomMonthlyPoint[]>(qMonthly, [])
  const monthlyCounts = [...monthlyCountsDesc].reverse()

  return {
    totalEvents: total ?? 0,
    dateMin,
    dateMax,
    docTypeCounts,
    topAssignors,
    topAssignees,
    monthlyCounts,
    notes,
  }
}

export async function searchAom(options: {
  query: string
  limit?: number
}): Promise<AomSearchResponse> {
  const query = (options.query || "").trim()
  const limit = Math.max(10, Math.min(250, options.limit ?? 50))
  const notes: string[] = []

  const ready = await ensureDb()
  if (!ready.ok) {
    notes.push("AOM database unavailable. Build data/aom.sqlite first.")
    return { query, count: 0, rows: [], notes }
  }
  if (!query) {
    return { query, count: 0, rows: [], notes: ["Enter a party name to search."] }
  }

  // Keep the search simple and predictable: substring match on either party.
  // (We intentionally do not use an ESCAPE clause to avoid sqlite CLI incompatibilities.)
  const safe = query.replace(/'/g, "''")
  const like = `%${safe}%`

  const sql = `select event_date, doc_type, first_party, second_party, cfn_master_id, city, county, state
from aom_events
where (first_party like '${like}' or second_party like '${like}')
order by event_date desc, id desc
limit ${limit};`

  try {
    const rows = await execSqliteJson<AomEventRow[]>(ready.db, sql, notes)
    return { query, count: rows.length, rows, notes }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
    return { query, count: 0, rows: [], notes: [`AOM search failed: ${message}`] }
  }
}

const MAJOR_BANKS_PATH = "data/major-banks-exclude.json"

async function loadMajorBanksExclude(): Promise<string[]> {
  const p = path.join(process.cwd(), MAJOR_BANKS_PATH)
  const raw = await readJsonFile<unknown>(p, [])
  if (!Array.isArray(raw)) return []
  return raw.filter((x) => typeof x === "string" && x.trim().length > 0).map((s) => s.trim().toLowerCase())
}

function isMajorBank(firmName: string, excludePatterns: string[]): boolean {
  const n = firmName.toLowerCase()
  return excludePatterns.some((p) => n.includes(p))
}

export async function fetchAomFirmInsights(options?: {
  scope?: "watchlist" | "all"
  months?: number
  limitFirms?: number
  unmatchedLimit?: number
  excludeMajorBanks?: boolean
}): Promise<AomFirmInsights> {
  const notes: string[] = []
  const ready = await ensureDb()
  if (!ready.ok) {
    notes.push("AOM database unavailable. Build data/aom.sqlite first.")
    return {
      scope: options?.scope ?? "watchlist",
      totalEventsScanned: 0,
      months: [],
      firms: [],
      unmatched: [],
      notes,
    }
  }

  const monthsBack = Math.max(6, Math.min(48, options?.months ?? 24))
  const limitFirms = Math.max(5, Math.min(100, options?.limitFirms ?? 25))
  const unmatchedLimit = Math.max(10, Math.min(100, options?.unmatchedLimit ?? 30))

  const scope = options?.scope ?? "all"
  const { watchlistSet, aliasLookup } = await loadWatchlistAndAliases()
  if (scope === "watchlist" && watchlistSet.size === 0) {
    notes.push("Watchlist is empty. Add competitors to data/watchlist.json (or via UI) to enable watchlist rollups.")
  }

  let events: Array<{ event_date: string; first_party?: string; second_party?: string }> = []
  try {
    events = await fetchRecentAomParties({ monthsBack })
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
    notes.push(`Failed to read AOM events: ${message}`)
    return { scope: "watchlist", totalEventsScanned: 0, months: [], firms: [], unmatched: [], notes }
  }

  const resolveFirm = (party?: string) => {
    const raw = (party || "").trim()
    if (!raw) return undefined
    return aliasLookup.get(normalize(raw)) ?? raw
  }

  const monthKey = (date: string) => date.slice(0, 7)
  const monthsSet = new Set<string>()

  const today = new Date().toISOString().slice(0, 10)
  const date30dAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const date90dAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const date60dAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const date180dAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const init = () => ({
    inbound: 0,
    outbound: 0,
    lastEventDate: undefined as string | undefined,
    monthly: new Map<string, { inbound: number; outbound: number }>(),
    counterparty: new Map<string, number>(),
    inbound30: 0,
    outbound30: 0,
    inbound90: 0,
    outbound90: 0,
    inboundPrior30: 0,
    outboundPrior30: 0,
    inboundPrior90: 0,
    outboundPrior90: 0,
  })

  const stats = new Map<string, ReturnType<typeof init>>()
  const ensureFirm = (firm: string) => {
    const prev = stats.get(firm)
    if (prev) return prev
    const next = init()
    stats.set(firm, next)
    return next
  }

  const unmatchedAssignor = new Map<string, number>()
  const unmatchedAssignee = new Map<string, number>()

  for (const e of events) {
    const d = (e.event_date || "").slice(0, 10)
    const m = monthKey(e.event_date)
    monthsSet.add(m)

    const in30 = d >= date30dAgo && d <= today
    const in90 = d >= date90dAgo && d <= today
    const inPrior30 = d >= date60dAgo && d < date30dAgo
    const inPrior90 = d >= date180dAgo && d < date90dAgo

    const rawAssignor = (e.first_party || "").trim()
    const rawAssignee = (e.second_party || "").trim()
    const assignorMapped = rawAssignor ? aliasLookup.has(normalize(rawAssignor)) : false
    const assigneeMapped = rawAssignee ? aliasLookup.has(normalize(rawAssignee)) : false

    const assignorFirm = resolveFirm(rawAssignor)
    const assigneeFirm = resolveFirm(rawAssignee)

    // Unmatched tallies = parties not mapped by alias rules (even if present as raw firm).
    if (rawAssignor && !assignorMapped) {
      unmatchedAssignor.set(rawAssignor, (unmatchedAssignor.get(rawAssignor) || 0) + 1)
    }
    if (rawAssignee && !assigneeMapped) {
      unmatchedAssignee.set(rawAssignee, (unmatchedAssignee.get(rawAssignee) || 0) + 1)
    }

    const includeAssignor = scope === "all" ? !!assignorFirm : !!assignorFirm && watchlistSet.has(assignorFirm)
    const includeAssignee = scope === "all" ? !!assigneeFirm : !!assigneeFirm && watchlistSet.has(assigneeFirm)

    if (includeAssignor && assignorFirm) {
      const s = ensureFirm(assignorFirm)
      s.outbound += 1
      if (in30) s.outbound30 += 1
      if (in90) s.outbound90 += 1
      if (inPrior30) s.outboundPrior30 += 1
      if (inPrior90) s.outboundPrior90 += 1
      s.lastEventDate = !s.lastEventDate || e.event_date > s.lastEventDate ? e.event_date : s.lastEventDate
      const mm = s.monthly.get(m) || { inbound: 0, outbound: 0 }
      mm.outbound += 1
      s.monthly.set(m, mm)
      const cp = (e.second_party || "").trim()
      if (cp) s.counterparty.set(cp, (s.counterparty.get(cp) || 0) + 1)
    }

    if (includeAssignee && assigneeFirm) {
      const s = ensureFirm(assigneeFirm)
      s.inbound += 1
      if (in30) s.inbound30 += 1
      if (in90) s.inbound90 += 1
      if (inPrior30) s.inboundPrior30 += 1
      if (inPrior90) s.inboundPrior90 += 1
      s.lastEventDate = !s.lastEventDate || e.event_date > s.lastEventDate ? e.event_date : s.lastEventDate
      const mm = s.monthly.get(m) || { inbound: 0, outbound: 0 }
      mm.inbound += 1
      s.monthly.set(m, mm)
      const cp = (e.first_party || "").trim()
      if (cp) s.counterparty.set(cp, (s.counterparty.get(cp) || 0) + 1)
    }
  }

  const months = Array.from(monthsSet.values()).sort()

  const excludeMajorBanks = options?.excludeMajorBanks ?? true
  const majorBankPatterns = excludeMajorBanks ? await loadMajorBanksExclude() : []

  const trendFrom = (curr: number, prior: number): "up" | "down" | "flat" => {
    if (prior === 0) return curr > 0 ? "up" : "flat"
    const pct = (curr - prior) / prior
    if (pct > 0.1) return "up"
    if (pct < -0.1) return "down"
    return "flat"
  }

  let firms: AomFirmStat[] = Array.from(stats.entries())
    .map(([firm, s]) => {
      const monthly = months.map((m) => {
        const mm = s.monthly.get(m) || { inbound: 0, outbound: 0 }
        return { month: m, inbound: mm.inbound, outbound: mm.outbound, net: mm.inbound - mm.outbound }
      })
      const topCounterparties = Array.from(s.counterparty.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }))
      const inbound = s.inbound
      const outbound = s.outbound
      const inbound30 = s.inbound30 ?? 0
      const outbound30 = s.outbound30 ?? 0
      const inbound90 = s.inbound90 ?? 0
      const outbound90 = s.outbound90 ?? 0
      const total30 = inbound30 + outbound30
      const total90 = inbound90 + outbound90
      const totalPrior30 = (s.inboundPrior30 ?? 0) + (s.outboundPrior30 ?? 0)
      const totalPrior90 = (s.inboundPrior90 ?? 0) + (s.outboundPrior90 ?? 0)
      const role = classifyParticipantRole(firm, inbound90, outbound90, inbound90 - outbound90)
      return {
        firm,
        inbound,
        outbound,
        net: inbound - outbound,
        total: inbound + outbound,
        lastEventDate: s.lastEventDate,
        monthly,
        topCounterparties,
        inbound_30d: inbound30,
        outbound_30d: outbound30,
        net_30d: inbound30 - outbound30,
        total_30d: total30,
        inbound_90d: inbound90,
        outbound_90d: outbound90,
        net_90d: inbound90 - outbound90,
        total_90d: total90,
        trend_30d: trendFrom(total30, totalPrior30),
        trend_90d: trendFrom(total90, totalPrior90),
        role: role ?? undefined,
      }
    })
    .sort((a, b) => b.total - a.total)

  if (excludeMajorBanks && majorBankPatterns.length > 0) {
    const excludedCount = firms.filter((f) => isMajorBank(f.firm, majorBankPatterns)).length
    firms = firms.filter((f) => !isMajorBank(f.firm, majorBankPatterns))
    if (excludedCount > 0) {
      notes.push(`Excluded ${excludedCount} major bank(s) from rollups.`)
    }
  }

  firms = firms.slice(0, limitFirms)

  const unmatched: AomUnmatchedParty[] = [
    ...Array.from(unmatchedAssignor.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, unmatchedLimit)
      .map(([name, count]) => ({ name, count, role: "assignor" as const })),
    ...Array.from(unmatchedAssignee.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, unmatchedLimit)
      .map(([name, count]) => ({ name, count, role: "assignee" as const })),
  ].sort((a, b) => b.count - a.count)

  return {
    scope,
    totalEventsScanned: events.length,
    months,
    firms,
    unmatched,
    notes,
  }
}

export async function fetchAomFirmGraph(options: {
  monthsBack?: number
  scope?: "watchlist" | "all"
  focalFirm?: string
  depth?: 1 | 2
  minEdgeCount?: number
  maxNodes?: number
  maxEdges?: number
}): Promise<AomFirmGraph> {
  const notes: string[] = []
  const ready = await ensureDb()
  if (!ready.ok) {
    notes.push("AOM database unavailable. Build data/aom.sqlite first.")
    return {
      monthsBack: options.monthsBack ?? 24,
      scope: options.scope ?? "all",
      focalFirm: options.focalFirm,
      depth: options.depth ?? 2,
      minEdgeCount: options.minEdgeCount ?? 2,
      nodes: [],
      links: [],
      outbound: [],
      inbound: [],
      notes,
    }
  }

  const monthsBack = Math.max(1, Math.min(48, options.monthsBack ?? 24))
  const scope = options.scope ?? "all"
  const depth: 1 | 2 = options.depth ?? 2
  const minEdgeCount = Math.max(1, Math.min(50, options.minEdgeCount ?? 2))
  const maxNodes = Math.max(10, Math.min(80, options.maxNodes ?? 40))
  const maxEdges = Math.max(25, Math.min(400, options.maxEdges ?? 200))
  const focalFirm = (options.focalFirm || "").trim() || undefined

  const { watchlistSet, aliasLookup } = await loadWatchlistAndAliases()

  let events: Array<{ event_date: string; first_party?: string; second_party?: string }> = []
  try {
    events = await fetchRecentAomParties({ monthsBack })
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
    notes.push(`Failed to read AOM events: ${message}`)
    return {
      monthsBack,
      scope,
      focalFirm,
      depth,
      minEdgeCount,
      nodes: [],
      links: [],
      outbound: [],
      inbound: [],
      notes,
    }
  }

  const resolveFirm = (party?: string) => {
    const raw = (party || "").trim()
    if (!raw) return undefined
    return aliasLookup.get(normalize(raw)) ?? raw
  }

  // Build edge counts (source=assignor -> target=assignee)
  const edgeCounts = new Map<string, number>()
  const nodeTotals = new Map<string, number>()

  const shouldIncludeFirm = (firm: string) => (scope === "all" ? true : watchlistSet.has(firm))

  for (const e of events) {
    const src = resolveFirm(e.first_party)
    const dst = resolveFirm(e.second_party)
    if (!src || !dst) continue
    if (scope !== "all") {
      // Keep edges where at least one endpoint is in watchlist (so the graph is still useful).
      if (!watchlistSet.has(src) && !watchlistSet.has(dst)) continue
    }
    const key = `${src}→${dst}`
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1)
    nodeTotals.set(src, (nodeTotals.get(src) || 0) + 1)
    nodeTotals.set(dst, (nodeTotals.get(dst) || 0) + 1)
  }

  // If focalFirm provided, build an ego network (depth 1 or 2).
  const neighbors = (firm: string) => {
    const out = new Set<string>()
    for (const [key, count] of edgeCounts.entries()) {
      if (count < minEdgeCount) continue
      const [src, dst] = key.split("→")
      if (src === firm) out.add(dst)
      if (dst === firm) out.add(src)
    }
    return out
  }

  let allowed = new Set<string>()
  if (focalFirm) {
    allowed.add(focalFirm)
    const hop1 = neighbors(focalFirm)
    hop1.forEach((x) => allowed.add(x))
    if (depth === 2) {
      hop1.forEach((n) => neighbors(n).forEach((x) => allowed.add(x)))
    }
  } else {
    // No focal firm: show top nodes by volume.
    const top = Array.from(nodeTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxNodes)
      .map(([name]) => name)
    allowed = new Set(top)
  }

  // Build outbound/inbound lists for focal firm.
  const outboundCounts = new Map<string, number>()
  const inboundCounts = new Map<string, number>()
  if (focalFirm) {
    for (const [key, count] of edgeCounts.entries()) {
      if (count < minEdgeCount) continue
      const [src, dst] = key.split("→")
      if (src === focalFirm) outboundCounts.set(dst, (outboundCounts.get(dst) || 0) + count)
      if (dst === focalFirm) inboundCounts.set(src, (inboundCounts.get(src) || 0) + count)
    }
  }

  const outbound = Array.from(outboundCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([counterparty, count]) => ({ counterparty, count }))
  const inbound = Array.from(inboundCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([counterparty, count]) => ({ counterparty, count }))

  // Re-limit nodes if focal network is huge: keep focal + strongest neighbors.
  if (focalFirm && allowed.size > maxNodes) {
    const scored = Array.from(allowed.values())
      .filter((n) => n !== focalFirm)
      .map((n) => {
        const score = (outboundCounts.get(n) || 0) + (inboundCounts.get(n) || 0) + (nodeTotals.get(n) || 0)
        return { n, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxNodes - 1)
      .map((x) => x.n)
    allowed = new Set([focalFirm, ...scored])
  }

  // Convert to Sankey format.
  const nodesList = Array.from(allowed.values())
    .filter((n) => n && (scope === "all" ? true : shouldIncludeFirm(n) || !focalFirm)) // keep focal graph even if not in watchlist
    .slice(0, maxNodes)
  const nodeIndex = new Map(nodesList.map((n, i) => [n, i]))

  const links: Array<{ source: number; target: number; value: number }> = []
  for (const [key, count] of edgeCounts.entries()) {
    if (count < minEdgeCount) continue
    const [src, dst] = key.split("→")
    const s = nodeIndex.get(src)
    const t = nodeIndex.get(dst)
    if (s === undefined || t === undefined) continue
    links.push({ source: s, target: t, value: count })
  }
  links.sort((a, b) => b.value - a.value)
  const pruned = links.slice(0, maxEdges)

  return {
    monthsBack,
    scope,
    focalFirm,
    depth,
    minEdgeCount,
    nodes: nodesList.map((name) => ({ id: name, name })),
    links: pruned,
    outbound,
    inbound,
    notes,
  }
}

