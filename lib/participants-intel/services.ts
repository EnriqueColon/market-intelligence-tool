"use client"

import type {
  AssignmentRecord,
  BankAssignorRow,
  CompetitorRanking,
  LenderAnalyticsRecord,
  MortgageRecord,
  PreforeclosureRecord,
  PrivateLenderRecord,
  RecentDealRecord,
  ResourcePayload,
  SearchEntityResult,
} from "@/lib/participants-intel/types"

type CacheEntry<T> = {
  ts: number
  value: Promise<T>
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry<unknown>>()

function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = cache.get(key) as CacheEntry<T> | undefined
  if (hit && now - hit.ts < CACHE_TTL_MS) return hit.value
  const value = loader()
  cache.set(key, { ts: now, value })
  return value
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as T
}

function emptyDiagnostics() {
  return {
    source: "local_fallback" as const,
    totalFetched: 0,
    notes: [],
  }
}

export function fetchAssignmentsPayload(): Promise<ResourcePayload<AssignmentRecord>> {
  return cached("participants-intel:assignments:payload", () =>
    getJson<ResourcePayload<AssignmentRecord>>("/api/participants-intel?resource=assignments").catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function fetchMortgagesPayload(): Promise<ResourcePayload<MortgageRecord>> {
  return cached("participants-intel:mortgages:payload", () =>
    getJson<ResourcePayload<MortgageRecord>>("/api/participants-intel?resource=mortgages").catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function fetchPreforeclosuresPayload(): Promise<ResourcePayload<PreforeclosureRecord>> {
  return cached("participants-intel:preforeclosures:payload", () =>
    getJson<ResourcePayload<PreforeclosureRecord>>("/api/participants-intel?resource=preforeclosures").catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function fetchLendersPayload(): Promise<ResourcePayload<LenderAnalyticsRecord>> {
  return cached("participants-intel:lenders:payload", () =>
    getJson<ResourcePayload<LenderAnalyticsRecord>>("/api/participants-intel?resource=lenders").catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function fetchRankingsPayload(): Promise<ResourcePayload<CompetitorRanking>> {
  return cached("participants-intel:rankings:payload", () =>
    getJson<ResourcePayload<CompetitorRanking>>("/api/participants-intel?resource=rankings").catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function fetchAssignments(): Promise<AssignmentRecord[]> {
  return fetchAssignmentsPayload().then((r) => r.items || [])
}

export function fetchMortgages(): Promise<MortgageRecord[]> {
  return fetchMortgagesPayload().then((r) => r.items || [])
}

export function fetchPreforeclosures(): Promise<PreforeclosureRecord[]> {
  return fetchPreforeclosuresPayload().then((r) => r.items || [])
}

export function fetchLenders(): Promise<LenderAnalyticsRecord[]> {
  return fetchLendersPayload().then((r) => r.items || [])
}

export function fetchPrivateLendersPayload(geo: string): Promise<ResourcePayload<PrivateLenderRecord>> {
  return cached(`participants-intel:private-lenders:${geo}`, () =>
    getJson<ResourcePayload<PrivateLenderRecord>>(`/api/participants-intel?resource=private-lenders&geo=${encodeURIComponent(geo)}`).catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function fetchRecentDealsPayload(geo: string): Promise<ResourcePayload<RecentDealRecord>> {
  return cached(`participants-intel:recent-deals:${geo}`, () =>
    getJson<ResourcePayload<RecentDealRecord>>(`/api/participants-intel?resource=recent-deals&geo=${encodeURIComponent(geo)}`).catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function fetchBankAssignorsPayload(): Promise<ResourcePayload<BankAssignorRow>> {
  return cached("participants-intel:competitor-assignors", () =>
    getJson<ResourcePayload<BankAssignorRow>>("/api/participants-intel?resource=competitor-assignors").catch(() => ({
      items: [],
      diagnostics: emptyDiagnostics(),
    }))
  )
}

export function searchEntities(query: string): Promise<SearchEntityResult[]> {
  const q = query.trim()
  if (!q) return Promise.resolve([])
  const key = `participants-intel:search:${q.toLowerCase()}`
  return cached(key, () =>
    getJson<{ items: SearchEntityResult[] }>(`/api/participants-intel?resource=search&q=${encodeURIComponent(q)}`).then(
      (r) => r.items || []
    )
  )
}

