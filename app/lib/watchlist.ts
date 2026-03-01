/**
 * Watchlist loading: supports both legacy (string[]) and new schema
 * { canonical_name, category, aliases, notes }[].
 */

import path from "node:path"
import fs from "node:fs/promises"

export type WatchlistEntry = {
  canonical_name: string
  category: string
  aliases: string[]
  notes: string
}

export type WatchlistData = {
  entries: WatchlistEntry[]
  watchlist: string[]
  watchlistSet: Set<string>
  aliasesByFirm: Record<string, string[]>
  aliasLookup: Map<string, string>
  categoryByFirm: Record<string, string>
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

async function readJsonFile<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Load watchlist from data/watchlist.json.
 * Supports:
 * - New schema: [{ canonical_name, category, aliases, notes }]
 * - Legacy: string[] (uses watchlist-aliases.json for aliases)
 */
export async function loadWatchlistData(): Promise<WatchlistData> {
  const watchlistPath = path.join(process.cwd(), "data", "watchlist.json")
  const aliasesPath = path.join(process.cwd(), "data", "watchlist-aliases.json")

  const watchlistRaw = await readJsonFile<unknown>(watchlistPath, [])
  const entries: WatchlistEntry[] = []
  const watchlist: string[] = []
  const aliasesByFirm: Record<string, string[]> = {}
  const categoryByFirm: Record<string, string> = {}

  if (Array.isArray(watchlistRaw)) {
    for (const item of watchlistRaw) {
      if (item && typeof item === "object" && "canonical_name" in item) {
        const name = String((item as any).canonical_name || "").trim()
        if (!name) continue
        const category = String((item as any).category || "").trim()
        const aliasList = Array.isArray((item as any).aliases)
          ? (item as any).aliases.filter((x: unknown) => typeof x === "string")
          : []
        const notes = String((item as any).notes || "").trim()
        entries.push({ canonical_name: name, category, aliases: aliasList, notes })
        watchlist.push(name)
        aliasesByFirm[name] = [name, ...aliasList]
        if (category) categoryByFirm[name] = category
      } else if (typeof item === "string" && item.trim()) {
        watchlist.push(item.trim())
      }
    }
  }

  // Legacy: merge watchlist-aliases.json if we have string-only watchlist
  const aliasesRaw = await readJsonFile<Record<string, unknown>>(aliasesPath, {})
  if (Object.keys(aliasesByFirm).length === 0 && watchlist.length > 0) {
    const watchlistKeyToName = new Map(watchlist.map((name) => [normalize(name), name]))
    for (const [key, list] of Object.entries(aliasesRaw)) {
      const trimmedKey = (key || "").trim()
      if (!trimmedKey) continue
      const kNorm = normalize(trimmedKey)
      const canonical = watchlistKeyToName.get(kNorm) ?? trimmedKey
      if (!aliasesByFirm[canonical]) aliasesByFirm[canonical] = []
      aliasesByFirm[canonical].push(
        ...(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [])
      )
    }
    for (const firm of watchlist) {
      if (!aliasesByFirm[firm]) aliasesByFirm[firm] = []
      aliasesByFirm[firm].push(firm)
    }
  } else if (Object.keys(aliasesRaw).length > 0) {
    // Supplement new schema with extra aliases from watchlist-aliases
    for (const [key, list] of Object.entries(aliasesRaw)) {
      const trimmedKey = (key || "").trim()
      if (!trimmedKey) continue
      const kNorm = normalize(trimmedKey)
      const match = watchlist.find((w) => normalize(w) === kNorm)
      const canonical = match ?? trimmedKey
      if (!aliasesByFirm[canonical]) aliasesByFirm[canonical] = [canonical]
      const arr = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []
      for (const a of arr) {
        if (a && !aliasesByFirm[canonical].some((x) => normalize(x) === normalize(a))) {
          aliasesByFirm[canonical].push(a)
        }
      }
    }
  }

  // Normalize + de-dup aliases
  for (const firm of Object.keys(aliasesByFirm)) {
    const seen = new Map<string, string>()
    for (const a of aliasesByFirm[firm]) {
      const trimmed = (a || "").trim()
      if (!trimmed) continue
      const n = normalize(trimmed)
      if (!n) continue
      if (!seen.has(n)) seen.set(n, trimmed)
    }
    aliasesByFirm[firm] = Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }

  const aliasLookup = new Map<string, string>()
  for (const [firm, list] of Object.entries(aliasesByFirm)) {
    for (const a of list) {
      aliasLookup.set(normalize(a), firm)
    }
  }

  return {
    entries,
    watchlist,
    watchlistSet: new Set(watchlist),
    aliasesByFirm,
    aliasLookup,
    categoryByFirm,
  }
}
