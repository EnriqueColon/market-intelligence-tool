"use client"

import type {
  AssignmentRecord,
  LenderAnalyticsRecord,
  MortgageRecord,
  PreforeclosureRecord,
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

export function fetchAssignments(): Promise<AssignmentRecord[]> {
  return cached("participants-intel:assignments", () =>
    getJson<{ items: AssignmentRecord[] }>("/api/participants-intel?resource=assignments").then((r) => r.items || [])
  )
}

export function fetchMortgages(): Promise<MortgageRecord[]> {
  return cached("participants-intel:mortgages", () =>
    getJson<{ items: MortgageRecord[] }>("/api/participants-intel?resource=mortgages").then((r) => r.items || [])
  )
}

export function fetchPreforeclosures(): Promise<PreforeclosureRecord[]> {
  return cached("participants-intel:preforeclosures", () =>
    getJson<{ items: PreforeclosureRecord[] }>("/api/participants-intel?resource=preforeclosures").then((r) => r.items || [])
  )
}

export function fetchLenders(): Promise<LenderAnalyticsRecord[]> {
  return cached("participants-intel:lenders", () =>
    getJson<{ items: LenderAnalyticsRecord[] }>("/api/participants-intel?resource=lenders").then((r) => r.items || [])
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

