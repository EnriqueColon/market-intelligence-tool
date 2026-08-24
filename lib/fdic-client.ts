import { FDIC_CONFIG } from "@/lib/fdic-config"

/**
 * The single hardened path to the FDIC API.
 *
 * This used to live privately inside app/actions/fetch-fdic-data.ts, while the
 * map endpoints called bare `fetch` and therefore had none of it: no fallback
 * host, no API key, no timeout, no retry. It lives in lib/ rather than in the
 * server-action file because a "use server" module turns every export into a
 * callable endpoint, and this is internal plumbing.
 *
 * The hardening that matters here:
 *  - a fallback host, since the primary occasionally has DNS trouble;
 *  - a per-host timeout, so a hung request cannot hold a render open;
 *  - 4xx short-circuits, because a bad query fails identically on every host;
 *  - large responses skip the Next data cache, which rejects payloads over 2MB.
 */

export interface FDICApiResponse<T> {
  data: T[]
  meta?: {
    total: number
    parameters: Record<string, any>
  }
  error?: string
}

const HOST_TIMEOUT_MS = 30_000
/** Above this row count a response can exceed the 2MB Next.js data cache limit. */
const SKIP_CACHE_LIMIT = 5000

/**
 * Build filter string for FDIC API.
 * Uses Elasticsearch query string syntax. String values must be quoted for phrase matching
 * (e.g. "New York" requires STNAME:"NEW YORK" - unquoted fails).
 */
export function buildFilterString(filters: Record<string, any>): string {
  return Object.entries(filters)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((v) => `${key}:"${String(v).replace(/"/g, '\\"')}"`).join(" OR ")
      }
      // Handle Elasticsearch date range (e.g. REPDTE:[2024-01-01 TO *])
      if (typeof value === "string" && /^\[.*\s+TO\s+/.test(value)) {
        return `${key}:${value}`
      }
      // Handle comparison operators (>, <, >=, <=)
      if (typeof value === "string" && /^[><]=?/.test(value)) {
        return `${key}:${value}`
      }
      // Wrap string values in double quotes for phrase matching (required for multi-word states like "New York")
      if (typeof value === "string") {
        return `${key}:"${value.replace(/"/g, '\\"')}"`
      }
      return `${key}:${value}`
    })
    .join(" AND ")
}

export type FdicRequest = {
  filters?: Record<string, any>
  fields?: readonly string[]
  limit?: number
  offset?: number
  sort_by?: string
  sort_order?: "ASC" | "DESC"
  format?: string
}

export async function fetchFDICData<T>(
  endpoint: string,
  params: FdicRequest = {}
): Promise<FDICApiResponse<T>> {
  try {
    const {
      filters = {},
      fields = [],
      limit = FDIC_CONFIG.defaultLimit,
      offset,
      sort_by = "ASSET",
      sort_order = "DESC",
      format = FDIC_CONFIG.defaultFormat,
    } = params

    const queryParams = new URLSearchParams({
      format,
      limit: limit.toString(),
    })
    if (offset != null && offset > 0) {
      queryParams.append("offset", offset.toString())
    }

    if (Object.keys(filters).length > 0) {
      queryParams.append("filters", buildFilterString(filters))
    }

    if (fields.length > 0) {
      queryParams.append("fields", fields.join(","))
    }

    if (sort_by) {
      queryParams.append("sort_by", sort_by)
      queryParams.append("sort_order", sort_order)
    }

    const baseUrls = [FDIC_CONFIG.baseUrl, ...(FDIC_CONFIG.fallbackBaseUrls ?? [])]
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .filter((u, i, arr) => arr.indexOf(u) === i)

    const apiKey = FDIC_CONFIG.apiKey?.trim()
    if (apiKey) {
      queryParams.set("api_key", apiKey)
    }

    const skipCache = limit >= SKIP_CACHE_LIMIT
    let lastError: string | undefined

    for (const baseUrl of baseUrls) {
      const url = `${baseUrl}${endpoint}?${queryParams.toString()}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), HOST_TIMEOUT_MS)
      try {
        const response = await fetch(url, {
          ...(skipCache
            ? { cache: "no-store" as RequestCache }
            : { next: { revalidate: FDIC_CONFIG.cacheTimeout / 1000 } }),
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          lastError = `FDIC API error: ${response.status}`
          console.error(`FDIC API error: ${response.status} - ${errorText}`)
          console.error(`FDIC API URL: ${url}`)

          // 4xx usually won't recover on another host unless auth/env changes.
          if (response.status >= 400 && response.status < 500) {
            return {
              data: [],
              error: lastError,
            }
          }
          continue
        }

        const jsonData = await response.json()

        // FDIC API returns data in different formats depending on endpoint
        if (jsonData.data && Array.isArray(jsonData.data)) {
          const normalized = jsonData.data.map((item: any) => item?.data ?? item)
          return {
            data: normalized,
            meta: jsonData.meta,
          }
        }

        if (Array.isArray(jsonData)) {
          const normalized = jsonData.map((item: any) => item?.data ?? item)
          return {
            data: normalized,
          }
        }

        lastError = "Unexpected response format from FDIC API"
      } catch (error) {
        clearTimeout(timeoutId)
        const msg = error instanceof Error ? error.message : "Unknown error"
        const isTimeout = msg.includes("abort") || msg.includes("AbortError")
        lastError = isTimeout ? "Request timed out. Try selecting a state for faster results." : msg
        console.error(`Error fetching FDIC data from ${endpoint} via ${baseUrl}:`, error)
      }
    }

    return {
      data: [],
      error: lastError || "Unable to reach FDIC API",
    }
  } catch (error) {
    console.error(`Error fetching FDIC data from ${endpoint}:`, error)
    return {
      data: [],
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
