"use server"

import { createHash } from "crypto"
import { buildSearchQuery } from "@/lib/google-query-builder"
import { filterByAllowlist, extractHostname } from "@/lib/domain-allowlist"
import type { EntityId } from "@/lib/entity-sources"
import { resolveReportDocument } from "@/lib/report-resolver"
import { isDbEnabled, sql } from "@/lib/db"
import { getSearchCache, setSearchCache } from "@/lib/market-research-memory"

export type SearchResult = {
  id: string
  title: string
  snippet: string
  url: string
  landingUrl: string
  documentUrl: string
  documentType: "pdf" | "html"
  domain: string
  inferredDate?: string
  blockedByAllowlist?: boolean
}

export type SearchIndustryReportsResult =
  | { ok: true; results: SearchResult[] }
  | { ok: false; error: string }

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

function queryHash(entityId: string, query: string, preferPdf: boolean): string {
  const payload = JSON.stringify({
    entityId,
    query: query.trim().toLowerCase(),
    preferPdf: Boolean(preferPdf),
  })
  return createHash("sha256").update(payload).digest("hex")
}

async function getCached(entityId: string, query: string, preferPdf: boolean): Promise<SearchResult[] | null> {
  const hash = queryHash(entityId, query, preferPdf)

  if (isDbEnabled()) {
    try {
      const rows = await sql<{
        results_json: SearchResult[]
        created_at: string
      }>`
        SELECT results_json, created_at
        FROM research_search_cache
        WHERE query_hash = ${hash}
        LIMIT 1
      `
      const row = rows.rows[0]
      if (!row) return null
      const createdAt = Date.parse(row.created_at)
      if (Number.isFinite(createdAt) && Date.now() - createdAt <= CACHE_TTL_MS) {
        return row.results_json ?? null
      }
      return null
    } catch (err) {
      console.error("[search-industry-reports] DB read failed:", err)
      return null
    }
  }

  if (process.env.NODE_ENV === "production") {
    return null
  }
  return getSearchCache(hash, CACHE_TTL_MS)
}

async function setCache(entityId: string, query: string, preferPdf: boolean, results: SearchResult[]): Promise<void> {
  const hash = queryHash(entityId, query, preferPdf)
  const queryJson = {
    entityId,
    query: query.trim(),
    preferPdf,
  }

  if (isDbEnabled()) {
    try {
      await sql`
        INSERT INTO research_search_cache (query_hash, query_json, results_json)
        VALUES (${hash}, ${JSON.stringify(queryJson)}::jsonb, ${JSON.stringify(results)}::jsonb)
        ON CONFLICT (query_hash)
        DO UPDATE SET
          query_json = EXCLUDED.query_json,
          results_json = EXCLUDED.results_json,
          created_at = now()
      `
      return
    } catch (err) {
      console.error("[search-industry-reports] DB write failed:", err)
      return
    }
  }

  if (process.env.NODE_ENV !== "production") {
    setSearchCache(hash, results)
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

  if (!isDbEnabled() && process.env.NODE_ENV === "production") {
    return {
      ok: false,
      error: "Database is required in production. Configure POSTGRES_URL for Market Research search persistence.",
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

    const enriched = await Promise.all(
      filtered.map(async (item, idx) => {
        const resolved = await resolveReportDocument(item.url, entityId)
        const result: SearchResult = {
          id: `sr-${entityId}-${idx}-${Date.now()}`,
          title: item.title,
          snippet: item.snippet,
          url: item.url,
          landingUrl: item.url,
          documentUrl: resolved.documentUrl,
          documentType: resolved.documentType,
          domain: extractHostname(item.url),
          inferredDate: inferDateFromSnippet(item.snippet),
          blockedByAllowlist: resolved.blockedByAllowlist,
        }
        return result
      })
    )

    const results = preferPdf
      ? enriched.filter((r) => r.documentType === "pdf")
      : enriched

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
