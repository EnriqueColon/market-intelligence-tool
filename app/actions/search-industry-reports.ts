"use server"

import * as fs from "fs/promises"
import * as path from "path"
import { buildSearchQuery } from "@/lib/google-query-builder"
import { filterByAllowlist, extractHostname } from "@/lib/domain-allowlist"
import type { EntityId } from "@/lib/entity-sources"

export type SearchResult = {
  id: string
  title: string
  snippet: string
  url: string
  domain: string
  inferredDate?: string
}

export type SearchIndustryReportsResult =
  | { ok: true; results: SearchResult[] }
  | { ok: false; error: string }

const CACHE_PATH = path.join(process.cwd(), "data", "search-cache.json")
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

type CacheEntry = { results: SearchResult[]; cachedAt: number }

function cacheKey(entityId: string, query: string, preferPdf: boolean): string {
  return `${entityId}:${query.trim().toLowerCase()}:${preferPdf}`
}

async function getCached(entityId: string, query: string, preferPdf: boolean): Promise<SearchResult[] | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf-8")
    const cache = JSON.parse(raw) as Record<string, CacheEntry>
    const key = cacheKey(entityId, query, preferPdf)
    const entry = cache[key]
    if (!entry || Date.now() - entry.cachedAt > CACHE_TTL_MS) return null
    return entry.results
  } catch {
    return null
  }
}

async function setCache(
  entityId: string,
  query: string,
  preferPdf: boolean,
  results: SearchResult[]
): Promise<void> {
  try {
    const dir = path.dirname(CACHE_PATH)
    await fs.mkdir(dir, { recursive: true })
    let cache: Record<string, CacheEntry> = {}
    try {
      const raw = await fs.readFile(CACHE_PATH, "utf-8")
      cache = JSON.parse(raw)
    } catch {
      /* file may not exist */
    }
    cache[cacheKey(entityId, query, preferPdf)] = {
      results,
      cachedAt: Date.now(),
    }
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8")
  } catch (err) {
    console.warn("[search-industry-reports] Could not write cache:", err)
  }
}

function inferDateFromSnippet(snippet: string): string | undefined {
  const m = snippet.match(/\b(20\d{2}|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*,?\s*(20\d{2})?\b/i)
  if (m) {
    const year = m[2] || m[1]
    if (/^\d{4}$/.test(year)) return year
    return m[0]
  }
  return undefined
}

export async function searchIndustryReports(
  entityId: EntityId,
  query: string,
  preferPdf: boolean
): Promise<SearchIndustryReportsResult> {
  const trimmed = query.trim()
  if (!trimmed) {
    return { ok: false, error: "Please enter a search term." }
  }

  const cached = await getCached(entityId, trimmed, preferPdf)
  if (cached) {
    return { ok: true, results: cached }
  }

  const cseId = process.env.GOOGLE_CSE_ID?.trim()
  const apiKey = process.env.GOOGLE_API_KEY?.trim()
  if (!cseId || !apiKey) {
    return {
      ok: false,
      error: "Google Custom Search is not configured. Add GOOGLE_CSE_ID and GOOGLE_API_KEY to .env.local.",
    }
  }

  const searchQuery = buildSearchQuery(entityId, trimmed, preferPdf)
  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: searchQuery,
    num: "10",
  })

  try {
    const res = await fetch(
      `https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`,
      { cache: "no-store" }
    )

    if (!res.ok) {
      const text = await res.text()
      return {
        ok: false,
        error: `Search failed: ${res.status}. ${text.slice(0, 200)}`,
      }
    }

    const data = (await res.json()) as {
      items?: Array<{
        title?: string
        link?: string
        snippet?: string
        pagemap?: Record<string, unknown[]>
      }>
      error?: { message?: string }
    }

    if (data.error) {
      return {
        ok: false,
        error: data.error.message || "Search request failed.",
      }
    }

    const rawItems = data.items || []
    const withUrl = rawItems
      .filter((i): i is typeof i & { link: string } => Boolean(i.link))
      .map((i) => ({
        url: i.link,
        title: i.title || "",
        snippet: i.snippet || "",
      }))

    const filtered = filterByAllowlist(withUrl, entityId)

    const results: SearchResult[] = filtered.map((item, idx) => ({
      id: `sr-${entityId}-${idx}-${Date.now()}`,
      title: item.title,
      snippet: item.snippet,
      url: item.url,
      domain: extractHostname(item.url),
      inferredDate: inferDateFromSnippet(item.snippet),
    }))

    await setCache(entityId, trimmed, preferPdf, results)

    return { ok: true, results }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `Search failed: ${msg}`,
    }
  }
}
