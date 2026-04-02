import { NextRequest, NextResponse } from "next/server"
import type {
  AssignmentRecord,
  CompetitorAssignorRow,
  CompetitorRanking,
  EntityProfileRecord,
  LenderAnalyticsRecord,
  MortgageRecord,
  PreforeclosureRecord,
  PrivateLenderRecord,
  RecentDealRecord,
  ResourceDiagnostics,
  ResourcePayload,
  SearchEntityResult,
} from "@/lib/participants-intel/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Data source: Elementix API (ELEMENTIX_API_KEY required)
 *
 * Elementix endpoints used:
 *   GET /api/v1/lender/{id}/assignments?state=FL   → individual AOM records per lender
 *   GET /api/v1/assignments/rankings?state=FL      → top FL AOM buyer/seller rankings
 *   GET /api/v1/transactions?state=FL&isBusinessPurpose=true → FL mortgage transactions
 *   GET /api/v1/lenders                            → national lender rankings
 *   GET /api/v1/lender-search?q=...                → lender entity search
 */

type Resource = "assignments" | "mortgages" | "preforeclosures" | "lenders" | "search" | "rankings" | "private-lenders" | "recent-deals" | "competitor-assignors" | "entity-profile"

// ─── Elementix API config ─────────────────────────────────────────────────────

const ELEMENTIX_BASE = "https://app.elementix.ai"

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

async function elxFetch<T>(path: string, params: Record<string, string | string[]> = {}): Promise<T | null> {
  const key = process.env.ELEMENTIX_API_KEY?.trim()
  if (!key) return null
  try {
    const url = new URL(`${ELEMENTIX_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, val))
      } else {
        url.searchParams.set(k, v)
      }
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
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
  if (!process.env.ELEMENTIX_API_KEY?.trim()) return null

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
  if (!process.env.ELEMENTIX_API_KEY?.trim()) return null

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
  if (!process.env.ELEMENTIX_API_KEY?.trim()) return null

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
// Multi-source: tries the dedicated lender-search endpoint first, then falls
// back to filtering FL AOM rankings + private lenders by name — guaranteeing
// that any entity visible in other panels is always discoverable here.

async function fetchElementixSearch(q: string): Promise<SearchEntityResult[] | null> {
  if (!process.env.ELEMENTIX_API_KEY?.trim() || !q.trim()) return null

  const qLower = q.trim().toLowerCase()
  const results: SearchEntityResult[] = []
  const seen = new Set<string>()

  const addResult = (id: string, name: string, location?: string) => {
    const key = name.toLowerCase().trim()
    if (!name || !key || seen.has(key)) return
    seen.add(key)
    results.push({ id: id || name, name: name.trim(), type: "lender", location })
  }

  // ── Source 1: dedicated lender-search endpoint (may or may not exist) ────
  const searchResp = await elxFetch<{ data: ElxLender[] } | ElxLender[]>("/api/v1/lender-search", {
    q: q.trim(),
    limit: "30",
  })
  if (searchResp) {
    const rawItems: ElxLender[] = Array.isArray(searchResp)
      ? searchResp
      : ((asObj(searchResp) as { data?: ElxLender[] } | null)?.data ?? [])
    for (const r of rawItems) {
      if (r.lenderName) addResult(r.lenderId || r.lenderName, r.lenderName, r.address || undefined)
    }
  }

  // ── Source 2: FL AOM rankings — filter buyers by name match ──────────────
  const [rankingsResp, privateLendersResp] = await Promise.all([
    elxFetch<{ data: ElxAssignmentRanking[] }>("/api/v1/assignments/rankings", {
      state: "FL",
      limit: "50",
    }),
    elxFetch<{ data: ElxLender[] }>("/api/v1/lenders", {
      lenderType: "Private Money",
      perPage: "30",
      sortBy: "volume",
    }),
  ])

  for (const r of rankingsResp?.data ?? []) {
    const name = r.buyerName || r.sellerName || ""
    if (name && name.toLowerCase().includes(qLower)) {
      addResult(r.buyerId || r.sellerId || name, name)
    }
  }

  // ── Source 3: private lenders — filter by name match ─────────────────────
  for (const l of privateLendersResp?.data ?? []) {
    if (l.lenderName && l.lenderName.toLowerCase().includes(qLower)) {
      addResult(l.lenderId, l.lenderName, l.address || undefined)
    }
  }

  return results.length > 0 ? results : null
}

// ─── Empty payload helper ─────────────────────────────────────────────────────

function emptyPayload<T>(note: string): ResourcePayload<T> {
  return {
    items: [],
    diagnostics: {
      source: "external_api" as const,
      totalFetched: 0,
      notes: [note],
    },
  }
}

// ─── Geo param builder ───────────────────────────────────────────────────────

function geoParams(geo: string): Record<string, string[]> {
  if (geo === "miami") return { countyName: ["Miami-Dade|FL"] }
  // "florida" or "national" both scope to FL (this tab is FL-focused)
  return { state: ["FL"] }
}

// ─── Elementix: Active private creditors by geography ────────────────────────

async function fetchElementixPrivateLenders(geo: string): Promise<ResourcePayload<PrivateLenderRecord> | null> {
  if (!process.env.ELEMENTIX_API_KEY?.trim()) return null

  const resp = await elxFetch<{ data: ElxLender[] }>("/api/v1/lenders", {
    lenderType: ["Private Money"],
    windowInMonths: "12",
    perPage: "20",
    sortBy: "volume",
    sortOrder: "desc",
    ...geoParams(geo),
  })

  const data = resp?.data ?? []
  if (data.length === 0) return null

  const items: PrivateLenderRecord[] = data.map((l) => ({
    lenderId: l.lenderId,
    name: l.lenderName,
    volume: l.volume ?? 0,
    volumePrev: l.volumePrev ?? 0,
    count: l.count ?? 0,
    countPrev: l.countPrev ?? 0,
    percentChange: l.percentChange ?? 0,
    avgDealSize: l.averageMortgageSizeAllTime ?? 0,
    shortTermPct: (l as unknown as Record<string, number>).shortTermLoanPercentage ?? 0,
    longTermPct: (l as unknown as Record<string, number>).longTermLoanPercentage ?? 0,
    lenderType: l.lenderType || undefined,
    rank: l.rank ?? 0,
  }))

  return {
    items,
    diagnostics: {
      source: "external_api",
      totalFetched: items.length,
      notes: [`Elementix: ${items.length} active private lenders for geo=${geo}.`],
    },
  }
}

// ─── Elementix: Recent private credit originations by geography ───────────────

async function fetchElementixRecentDeals(geo: string): Promise<ResourcePayload<RecentDealRecord> | null> {
  if (!process.env.ELEMENTIX_API_KEY?.trim()) return null

  const resp = await elxFetch<{ data: ElxTransaction[] }>("/api/v1/transactions", {
    transactionType: "mortgage",
    lenderType: ["Private Money"],
    isBusinessPurpose: "true",
    sortBy: "recordingDate",
    sortOrder: "desc",
    perPage: "25",
    ...geoParams(geo),
  })

  const data = resp?.data ?? []
  if (data.length === 0) return null

  const items: RecentDealRecord[] = data.map((t) => {
    const borrower =
      (t.entityBorrowers?.[0]?.name) ||
      (t.partiesGrantor?.[0]) ||
      "Unknown"
    const addressFull = t.addresses?.[0]?.addressFull
    return {
      id: t.id,
      date: normalizeDate(t.recordingDate),
      lender: t.lenderName || t.partiesGrantee?.[0] || "Unknown",
      lenderId: t.lenderId || undefined,
      borrower,
      amount: maybeNumber(t.amount),
      address: addressFull || undefined,
      city: t.city || undefined,
      county: t.countyName || undefined,
      loanStatus: (t as unknown as Record<string, string>).loanStatus || undefined,
      isBusinessPurpose: t.isBusinessPurpose ?? true,
      propertyType: t.propertySubtypes?.[0] || t.propertyTypes?.[0] || undefined,
    }
  })

  return {
    items,
    diagnostics: {
      source: "external_api",
      totalFetched: items.length,
      notes: [`Elementix: ${items.length} recent private credit deals for geo=${geo}.`],
    },
  }
}

// ─── Elementix: FL AOM buyer rankings (authoritative volume + trend) ──────────

async function fetchElementixRankings(geo: string): Promise<ResourcePayload<CompetitorRanking> | null> {
  const key = process.env.ELEMENTIX_API_KEY?.trim()
  if (!key) return null

  const resp = await elxFetch<{ data: ElxAssignmentRanking[] }>("/api/v1/assignments/rankings", {
    ...geoParams(geo),
    limit: "20",
  })

  const data = resp?.data ?? []
  if (data.length === 0) return null

  const items: CompetitorRanking[] = data
    .filter((r) => r.buyerName)
    .map((r) => ({
      name: r.buyerName!,
      volume: r.volume ?? 0,
      volumePrev: r.volumePrev ?? 0,
      count: r.count ?? 0,
      countPrev: r.countPrev ?? 0,
      percentChange: r.percentChange ?? 0,
      avgDealSize: r.avgDealSize ?? 0,
      category: r.buyerCategory || undefined,
      buyerType: r.buyerType || undefined,
      rank: r.rank ?? 0,
    }))

  return {
    items,
    diagnostics: {
      source: "external_api",
      totalFetched: items.length,
      notes: [`Elementix: ${items.length} FL AOM buyer rankings loaded.`],
    },
  }
}

// ─── Competitor Assignor Intelligence ────────────────────────────────────────
// For Safe Harbor C-suite: which banks are selling paper to our competitors?
// Data flow:
//   1. Fetch FL AOM rankings → build competitor whitelist (investment firms only)
//   2. Parallel-fetch assignment records for top 10 competitors
//   3. Group by originating bank (assignor) → competitor matrix
//   4. Filter noise: skip individuals and one-off unknown entities

const INSTITUTIONAL_RE = /bank|financial|mortgage|capital|fund|credit|trust|llc|corp|inc|holdings|group|partners|lending|loan|asset|management|investment|securities|realty|real estate|servicer|servicing|equity|debt|note|reit/i

const SERVER_GSE_RE = /fannie mae|freddie mac|fhlmc|fnma|ginnie mae|hud\b|federal home loan|department of housing|veteran|va loan/i
const SERVER_SERVICER_RE = /nationstar|mr\.? cooper|ocwen|shellpoint|select portfolio|phh |sps \b|carrington|rushmore|specialized loan|loancare|dovenmuehle|cenlar|roundpoint|planet home|fay servicing|bsi financial|provident funding/i
const SERVER_BANK_RE = /wells fargo|jpmorgan|chase bank|bank of america|citibank|\bus bank\b|\bu\.s\. bank\b|goldman sachs|deutsche bank|hsbc|barclays|morgan stanley|truist|regions bank|suntrust|td bank\b|pnc bank|fifth third|citizens bank|bank na\b|national bank|national association|wilmington trust|computershare/i

/** Returns true if this entity looks like a competitor (investment firm / private credit) rather than a bank/servicer/GSE */
function isCompetitorEntity(name: string, buyerType?: string, buyerCategory?: string): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  if (SERVER_GSE_RE.test(n)) return false
  if (SERVER_SERVICER_RE.test(n)) return false
  if (SERVER_BANK_RE.test(n)) return false
  if (buyerType === "Bank" || buyerType === "Credit Union" || buyerType === "Thrift") return false
  if (buyerCategory?.toLowerCase().includes("servicer")) return false
  return true
}

// Residential / consumer lenders that are noise for Safe Harbor's CRE distressed debt focus.
// These originate consumer home loans, homebuilder captive mortgages, or retail residential paper —
// not the commercial real estate debt Safe Harbor sources.
const RESIDENTIAL_NOISE_RE = /lennar mortgage|lennar financial|movement mortgage|rocket mortgage|quicken loan|united wholesale|uwm\b|loanDepot|loan depot|better\.com|better mortgage|homepoint|home point|guild mortgage|caliber home|pennymac|newrez|mr\. cooper|freedom mortgage|guaranteed rate|fairway independent|cross country mortgage|homeside financial|american pacific mortgage|plaza home mortgage|homebridge|first continental|first home mortgage|summit funding|academy mortgage|american financing|pulte mortgage|kb home mortgage|dr horton mortgage|toll brothers mortgage|beazer mortgage|meritage mortgage|century mortgage|taylor morrison mortgage|nvr mortgage|smith douglas mortgage|smith douglas home|highland homes mortgage|gehan mortgage|on q financial|atlantic bay mortgage|success mortgage|michigan mutual|michigan-mutual|lakeview loan|finance of america|foamortgage|finance of america mortgage|mutual of omaha mortgage|american neighborhood mortgage|paramount residential|prmi\b|primary residential/i

/** Returns true if an assignor is a CRE-relevant institutional entity.
 *  Excludes residential/consumer originators and random individuals. */
function isInstitutionalAssignor(name: string): boolean {
  if (!name || name.length < 4) return false
  if (RESIDENTIAL_NOISE_RE.test(name)) return false
  return INSTITUTIONAL_RE.test(name)
}

async function fetchElementixCompetitorAssignors(geo: string): Promise<ResourcePayload<CompetitorAssignorRow> | null> {
  if (!process.env.ELEMENTIX_API_KEY?.trim()) return null

  // Step 1: Get FL AOM buyer rankings → build competitor whitelist
  const rankingsResp = await elxFetch<{ data: ElxAssignmentRanking[] }>("/api/v1/assignments/rankings", {
    ...geoParams(geo),
    limit: "20",
  })

  const allRankings = rankingsResp?.data ?? []
  if (allRankings.length === 0) return null

  // Step 2: Filter to real competitors (investment firms, private credit, distressed debt buyers)
  const competitors = allRankings
    .filter((r) => r.buyerName && r.buyerId)
    .filter((r) => isCompetitorEntity(r.buyerName!, r.buyerType, r.buyerCategory ?? undefined))
    .slice(0, 10)

  if (competitors.length === 0) return null

  // Step 3: Parallel-fetch assignment records for each competitor
  const assignmentSets = await Promise.all(
    competitors.map((c) =>
      elxFetch<{ data: ElxAssignment[] }>(`/api/v1/lender/${c.buyerId}/assignments`, {
        ...geoParams(geo),
        limit: "200",
      })
    )
  )

  // Step 4: Build competitor → assignor breakdown
  // Exclude competitor-to-competitor flows so only true institutional originators appear
  const competitorNameSet = new Set(competitors.map((c) => c.buyerName!.toLowerCase().trim()))

  const items: CompetitorAssignorRow[] = []

  for (let i = 0; i < competitors.length; i++) {
    const competitor = competitors[i]
    const assignments = assignmentSets[i]?.data ?? []

    const assignorMap = new Map<string, { deals: number; amount: number }>()

    for (const a of assignments) {
      const assignorName = (a.originalLender || a.originalLenderRaw || "").trim()
      if (!assignorName || !isInstitutionalAssignor(assignorName)) continue
      if (competitorNameSet.has(assignorName.toLowerCase().trim())) continue

      const amount = maybeNumber(a.loanAmount) ?? 0
      const curr = assignorMap.get(assignorName) ?? { deals: 0, amount: 0 }
      curr.deals += 1
      curr.amount += amount
      assignorMap.set(assignorName, curr)
    }

    const assignors = Array.from(assignorMap.entries())
      .map(([name, v]) => ({ name, deals: v.deals, amount: v.amount }))
      .sort((a, b) => b.deals - a.deals)

    const totalAOMs = assignors.reduce((s, a) => s + a.deals, 0)
    const totalAmount = assignors.reduce((s, a) => s + a.amount, 0)

    if (totalAOMs === 0) continue

    items.push({
      competitorName: competitor.buyerName!,
      rank: competitor.rank ?? 0,
      totalAOMs,
      totalAmount,
      assignors,
    })
  }

  items.sort((a, b) => b.totalAOMs - a.totalAOMs)

  return {
    items,
    diagnostics: {
      source: "external_api",
      totalFetched: items.length,
      notes: [
        `${competitors.length} competitors analyzed, ${items.length} with trackable bank assignment sources.`,
      ],
    },
  }
}

// ─── Elementix: Entity profile (AOM activity for a specific lender) ───────────

async function fetchElementixEntityProfile(id: string, name: string): Promise<ResourcePayload<EntityProfileRecord> | null> {
  if (!process.env.ELEMENTIX_API_KEY?.trim() || !id) return null

  // Fetch the lender's FL assignment records (as buyer/assignee)
  const assignmentsResp = await elxFetch<{ data: ElxAssignment[] }>(`/api/v1/lender/${id}/assignments`, {
    state: "FL",
    limit: "200",
  })

  const assignments = assignmentsResp?.data ?? []
  if (assignments.length === 0) return null

  const assignorMap = new Map<string, { deals: number; amount: number }>()
  let aomsBought = 0
  let volumeBought = 0

  const recentDeals: EntityProfileRecord["recentDeals"] = []

  for (const a of assignments) {
    const assignorName = (a.originalLender || a.originalLenderRaw || "").trim()
    const amount = maybeNumber(a.loanAmount)
    const date = normalizeDate(a.recordingDate)
    if (!date) continue

    aomsBought++
    if (amount) volumeBought += amount

    if (assignorName) {
      const curr = assignorMap.get(assignorName) ?? { deals: 0, amount: 0 }
      curr.deals++
      if (amount) curr.amount += amount
      assignorMap.set(assignorName, curr)
    }

    const addressFull =
      a.addressDetails?.[0]?.addressFull ||
      (typeof a.addresses?.[0] === "string" ? a.addresses[0] : undefined)

    recentDeals.push({
      id: a.id,
      date,
      counterparty: assignorName || "Unknown",
      amount,
      county: a.countyName || undefined,
      property: addressFull || undefined,
    })
  }

  recentDeals.sort((a, b) => b.date.localeCompare(a.date))

  const topAssignors = Array.from(assignorMap.entries())
    .map(([n, v]) => ({ name: n, deals: v.deals, amount: v.amount }))
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 10)

  const avgDealSizeBought = aomsBought > 0 && volumeBought > 0 ? volumeBought / aomsBought : 0

  const item: EntityProfileRecord = {
    id,
    name,
    aomsBought,
    volumeBought,
    avgDealSizeBought,
    percentChange: 0,
    topAssignors,
    recentDeals: recentDeals.slice(0, 25),
  }

  return {
    items: [item],
    diagnostics: {
      source: "external_api",
      totalFetched: assignments.length,
      notes: [`Entity profile for "${name}": ${assignments.length} FL AOM records found.`],
    },
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const resource = (req.nextUrl.searchParams.get("resource") || "").trim() as Resource
  const q = (req.nextUrl.searchParams.get("q") || "").trim()
  const geo = (req.nextUrl.searchParams.get("geo") || "florida").trim()

  if (!resource) {
    return NextResponse.json({ error: "resource is required" }, { status: 400 })
  }

  // ── Assignments ──────────────────────────────────────────────────────────────
  if (resource === "assignments") {
    const elementix = await fetchElementixAssignments()
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<AssignmentRecord>)
    return NextResponse.json(emptyPayload<AssignmentRecord>("Elementix unavailable — check ELEMENTIX_API_KEY."))
  }

  // ── Mortgages ────────────────────────────────────────────────────────────────
  if (resource === "mortgages") {
    const elementix = await fetchElementixMortgages()
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<MortgageRecord>)
    return NextResponse.json(emptyPayload<MortgageRecord>("Elementix unavailable — check ELEMENTIX_API_KEY."))
  }

  // ── Preforeclosures ──────────────────────────────────────────────────────────
  if (resource === "preforeclosures") {
    return NextResponse.json(emptyPayload<PreforeclosureRecord>("No preforeclosure data source configured."))
  }

  // ── Lenders ──────────────────────────────────────────────────────────────────
  if (resource === "lenders") {
    const elementix = await fetchElementixLenders()
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<LenderAnalyticsRecord>)
    return NextResponse.json(emptyPayload<LenderAnalyticsRecord>("Elementix unavailable — check ELEMENTIX_API_KEY."))
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
    return NextResponse.json(emptyPayload<SearchEntityResult>(`No results for "${q}" — Elementix unavailable or no matches.`))
  }

  // ── Rankings ─────────────────────────────────────────────────────────────────
  if (resource === "rankings") {
    const elementix = await fetchElementixRankings(geo)
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<CompetitorRanking>)
    return NextResponse.json(emptyPayload<CompetitorRanking>("Elementix unavailable — check ELEMENTIX_API_KEY."))
  }

  // ── Private Lenders ───────────────────────────────────────────────────────────
  if (resource === "private-lenders") {
    const elementix = await fetchElementixPrivateLenders(geo)
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<PrivateLenderRecord>)
    return NextResponse.json(emptyPayload<PrivateLenderRecord>("Elementix unavailable — check ELEMENTIX_API_KEY."))
  }

  // ── Recent Deals ─────────────────────────────────────────────────────────────
  if (resource === "recent-deals") {
    const elementix = await fetchElementixRecentDeals(geo)
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<RecentDealRecord>)
    return NextResponse.json(emptyPayload<RecentDealRecord>("Elementix unavailable — check ELEMENTIX_API_KEY."))
  }

  // ── Competitor Assignors ──────────────────────────────────────────────────────
  if (resource === "competitor-assignors") {
    const elementix = await fetchElementixCompetitorAssignors(geo)
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<CompetitorAssignorRow>)
    return NextResponse.json(emptyPayload<CompetitorAssignorRow>("Elementix unavailable — check ELEMENTIX_API_KEY."))
  }

  // ── Entity Profile ────────────────────────────────────────────────────────────
  if (resource === "entity-profile") {
    const entityId = (req.nextUrl.searchParams.get("id") || "").trim()
    const entityName = (req.nextUrl.searchParams.get("name") || "").trim()
    const elementix = await fetchElementixEntityProfile(entityId, entityName)
    if (elementix) return NextResponse.json(elementix satisfies ResourcePayload<EntityProfileRecord>)
    return NextResponse.json(emptyPayload<EntityProfileRecord>(`No AOM data found for "${entityName}" — entity may not be active in FL.`))
  }

  return NextResponse.json({ error: "invalid resource" }, { status: 400 })
}
