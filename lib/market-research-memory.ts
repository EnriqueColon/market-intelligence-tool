import type { SearchResult } from "@/app/actions/search-industry-reports"
import type { ReportSummaryEntry } from "@/app/actions/fetch-report-summaries"

type SearchCacheEntry = {
  results: SearchResult[]
  cachedAt: number
}

const SEARCH_CACHE = new Map<string, SearchCacheEntry>()
const SUMMARY_CACHE = new Map<string, ReportSummaryEntry>()

export function getSearchCache(key: string, ttlMs: number): SearchResult[] | null {
  const entry = SEARCH_CACHE.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > ttlMs) {
    SEARCH_CACHE.delete(key)
    return null
  }
  return entry.results
}

export function setSearchCache(key: string, results: SearchResult[]): void {
  SEARCH_CACHE.set(key, { results, cachedAt: Date.now() })
}

export function getSummaryByHash(urlHash: string): ReportSummaryEntry | null {
  return SUMMARY_CACHE.get(urlHash) ?? null
}

export function setSummaryByHash(urlHash: string, entry: ReportSummaryEntry): void {
  SUMMARY_CACHE.set(urlHash, entry)
}

export function getAllSummaries(): Record<string, ReportSummaryEntry> {
  const out: Record<string, ReportSummaryEntry> = {}
  for (const [k, v] of SUMMARY_CACHE.entries()) out[k] = v
  return out
}
