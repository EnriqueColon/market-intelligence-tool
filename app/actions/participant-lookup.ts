"use server"

import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"
import {
  ensureParticipantIntelDb,
  normalize_name,
} from "@/lib/participant-intel"
import { loadWatchlistData } from "@/app/lib/watchlist"

const AOM_DB_PATH = path.join(process.cwd(), "data", "aom.sqlite")

export type ParticipantCandidate = {
  firmId?: number
  canonicalName: string
  aliasText: string
  confidence: number
  source: "participant_intel" | "aom"
}

export type SearchParticipantFirmsResult = {
  candidates: ParticipantCandidate[]
  notes: string[]
}

export type FirmProfile = {
  canonicalName: string
  category?: string
  aliases: string[]
  metrics: {
    inbound: number
    outbound: number
    net: number
    total: number
    lastSeen?: string
  }
  topCounterparties: Array<{ name: string; count: number }>
  entities: Array<{ name: string; type: string; source: string }>
  notes: string[]
  error?: string
}

/**
 * Search for firms by name. Checks participant_intel first, falls back to AOM distinct parties.
 */
export async function searchParticipantFirms(
  query: string
): Promise<SearchParticipantFirmsResult> {
  const notes: string[] = []

  try {
    const db = ensureParticipantIntelDb()
    const norm = normalize_name(query)
    if (!norm) {
      return { candidates: [], notes: ["Enter a firm name."] }
    }

    // 1. Search participant_intel: firm + firm_alias by alias_norm
    const likePattern = `%${norm}%`
    const rows = db
      .prepare(
        `SELECT f.firm_id, f.canonical_name, a.alias_text, a.confidence, a.source
         FROM firm f
         JOIN firm_alias a ON a.firm_id = f.firm_id
         WHERE a.alias_norm LIKE ?
         ORDER BY a.confidence DESC NULLS LAST
         LIMIT 10`
      )
      .all(likePattern) as Array<{
      firm_id: number
      canonical_name: string
      alias_text: string
      confidence: number | null
      source: string | null
    }>

    if (rows.length > 0) {
      const seen = new Set<string>()
      const candidates: ParticipantCandidate[] = []
      for (const r of rows) {
        const key = `${r.firm_id}:${r.canonical_name}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({
          firmId: r.firm_id,
          canonicalName: r.canonical_name,
          aliasText: r.alias_text,
          confidence: r.confidence ?? 1,
          source: "participant_intel",
        })
      }
      return { candidates, notes }
    }

    // 2. Fallback: query AOM for distinct parties matching query
    if (!fs.existsSync(AOM_DB_PATH)) {
      return {
        candidates: [],
        notes: ["AOM database not found. Build data/aom.sqlite first."],
      }
    }

    const aomDb = new Database(AOM_DB_PATH, { readonly: true })
    const safeQuery = query.replace(/'/g, "''")
    const like = `%${safeQuery}%`

    const aomRows = aomDb
      .prepare(
        `SELECT DISTINCT trim(first_party) as name FROM aom_events
         WHERE first_party IS NOT NULL AND trim(first_party) != '' AND first_party LIKE ?
         UNION
         SELECT DISTINCT trim(second_party) as name FROM aom_events
         WHERE second_party IS NOT NULL AND trim(second_party) != '' AND second_party LIKE ?
         LIMIT 10`
      )
      .all(like, like) as Array<{ name: string }>

    aomDb.close()

    const candidates: ParticipantCandidate[] = aomRows.map((r) => ({
      canonicalName: r.name,
      aliasText: r.name,
      confidence: 0.5,
      source: "aom",
    }))

    return { candidates, notes }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
    return {
      candidates: [],
      notes: [`Search failed: ${message}`],
    }
  }
}

/**
 * Load firm profile. Bootstraps from AOM if firm not in participant_intel.
 */
export async function loadParticipantProfile(
  firmIdOrName: string
): Promise<FirmProfile> {
  const notes: string[] = []

  try {
    const db = ensureParticipantIntelDb()

    // 1. Resolve firm: by ID or by name
    let firmId: number | null = null
    let canonicalName = ""
    let category: string | undefined

    const numericId = parseInt(firmIdOrName, 10)
    if (!Number.isNaN(numericId) && numericId > 0) {
      const row = db
        .prepare("SELECT firm_id, canonical_name, category FROM firm WHERE firm_id = ?")
        .get(numericId) as { firm_id: number; canonical_name: string; category: string | null } | undefined
      if (row) {
        firmId = row.firm_id
        canonicalName = row.canonical_name
        category = row.category ?? undefined
      }
    }

    if (!firmId) {
      const norm = normalize_name(firmIdOrName)
      if (norm) {
        const row = db
          .prepare(
            `SELECT f.firm_id, f.canonical_name, f.category FROM firm f
             JOIN firm_alias a ON a.firm_id = f.firm_id
             WHERE a.alias_norm = ? OR a.alias_norm LIKE ?
             LIMIT 1`
          )
          .get(norm, `%${norm}%`) as
          | { firm_id: number; canonical_name: string; category: string | null }
          | undefined
        if (row) {
          firmId = row.firm_id
          canonicalName = row.canonical_name
          category = row.category ?? undefined
        }
      }
    }

    // 2. Bootstrap from AOM if not in participant_intel
    if (!firmId) {
      canonicalName = firmIdOrName.trim()
      if (!canonicalName) {
        return {
          canonicalName: "",
          aliases: [],
          metrics: { inbound: 0, outbound: 0, net: 0, total: 0 },
          topCounterparties: [],
          entities: [],
          notes: ["No firm name provided."],
          error: "No firm name provided.",
        }
      }
      const now = new Date().toISOString().slice(0, 19).replace("T", " ")
      const ins = db.prepare(
        "INSERT INTO firm (canonical_name, category, created_at, updated_at) VALUES (?, NULL, ?, ?)"
      )
      const result = ins.run(canonicalName, now, now)
      firmId = result.lastInsertRowid as number
      const aliasNorm = normalize_name(canonicalName)
      db.prepare(
        `INSERT INTO firm_alias (firm_id, alias_text, alias_norm, match_type, confidence, source, first_seen, last_seen)
         VALUES (?, ?, ?, 'exact', 1, 'aom', ?, ?)`
      ).run(firmId, canonicalName, aliasNorm, now, now)
      category = undefined
    }

    // 3. Load aliases
    const aliasRows = db
      .prepare(
        "SELECT alias_text FROM firm_alias WHERE firm_id = ? ORDER BY confidence DESC NULLS LAST"
      )
      .all(firmId) as Array<{ alias_text: string }>
    const aliases = [...new Set(aliasRows.map((r) => r.alias_text))]

    // 4. Load entities (may be empty for MVP)
    const entityRows = db
      .prepare(
        "SELECT entity_name, entity_type, source FROM firm_entity WHERE firm_id = ?"
      )
      .all(firmId) as Array<{ entity_name: string; entity_type: string; source: string }>
    const entities = entityRows.map((r) => ({
      name: r.entity_name,
      type: r.entity_type || "unknown",
      source: r.source || "aom",
    }))

    // 5. Query AOM for metrics
    let metrics = { inbound: 0, outbound: 0, net: 0, total: 0, lastSeen: undefined as string | undefined }
    let topCounterparties: Array<{ name: string; count: number }> = []

    if (!fs.existsSync(AOM_DB_PATH)) {
      notes.push("AOM database not found. Metrics unavailable.")
    } else {
      const aomDb = new Database(AOM_DB_PATH, { readonly: true })
      const aliasSet = new Set(aliases.map((a) => normalize_name(a)))

      const rows = aomDb
        .prepare(
          `SELECT event_date, trim(first_party) as first_party, trim(second_party) as second_party
           FROM aom_events
           WHERE event_date IS NOT NULL AND length(event_date) >= 10
           AND (first_party IS NOT NULL OR second_party IS NOT NULL)
           ORDER BY event_date DESC
           LIMIT 50000`
        )
        .all() as Array<{
        event_date: string
        first_party: string | null
        second_party: string | null
      }>

      const counterpartyCounts = new Map<string, number>()
      let lastSeen: string | undefined

      for (const r of rows) {
        const assignor = (r.first_party || "").trim()
        const assignee = (r.second_party || "").trim()
        const assignorNorm = normalize_name(assignor)
        const assigneeNorm = normalize_name(assignee)
        const assignorMatch = assignorNorm && aliasSet.has(assignorNorm)
        const assigneeMatch = assigneeNorm && aliasSet.has(assigneeNorm)

        if (assignorMatch && assignee) {
          metrics.outbound += 1
          counterpartyCounts.set(assignee, (counterpartyCounts.get(assignee) || 0) + 1)
          if (!lastSeen || r.event_date > lastSeen) lastSeen = r.event_date
        }
        if (assigneeMatch && assignor) {
          metrics.inbound += 1
          counterpartyCounts.set(assignor, (counterpartyCounts.get(assignor) || 0) + 1)
          if (!lastSeen || r.event_date > lastSeen) lastSeen = r.event_date
        }
      }

      metrics = {
        inbound: metrics.inbound,
        outbound: metrics.outbound,
        net: metrics.inbound - metrics.outbound,
        total: metrics.inbound + metrics.outbound,
        lastSeen: lastSeen?.slice(0, 10),
      }

      topCounterparties = Array.from(counterpartyCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }))

      aomDb.close()
    }

    return {
      canonicalName,
      category,
      aliases,
      metrics,
      topCounterparties,
      entities: entities.length > 0 ? entities : [],
      notes,
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
    return {
      canonicalName: "",
      aliases: [],
      metrics: { inbound: 0, outbound: 0, net: 0, total: 0 },
      topCounterparties: [],
      entities: [],
      notes: [`Load failed: ${message}`],
      error: message,
    }
  }
}

/**
 * Load firm profile using watchlist aliases (for Watchlist dropdown).
 * Uses canonical_name + aliases from watchlist.json for AOM matching.
 */
export async function loadParticipantProfileFromWatchlist(
  canonicalName: string
): Promise<FirmProfile> {
  const notes: string[] = []
  const name = (canonicalName || "").trim()
  if (!name) {
    return {
      canonicalName: "",
      aliases: [],
      metrics: { inbound: 0, outbound: 0, net: 0, total: 0 },
      topCounterparties: [],
      entities: [],
      notes: ["No firm name provided."],
      error: "No firm name provided.",
    }
  }

  const data = await loadWatchlistData()
  const nameNorm = normalize_name(name)
  const entry = data.entries.find(
    (e) =>
      e.canonical_name === name ||
      normalize_name(e.canonical_name) === nameNorm ||
      e.aliases.some((a) => normalize_name(a) === nameNorm)
  )
  const aliases = entry ? [entry.canonical_name, ...entry.aliases] : [name]
  const category = entry?.category
  const aliasSet = new Set(aliases.map((a) => normalize_name(a)))

  let metrics = { inbound: 0, outbound: 0, net: 0, total: 0, lastSeen: undefined as string | undefined }
  let topCounterparties: Array<{ name: string; count: number }> = []

  if (fs.existsSync(AOM_DB_PATH)) {
    const aomDb = new Database(AOM_DB_PATH, { readonly: true })
    const rows = aomDb
      .prepare(
        `SELECT event_date, trim(first_party) as first_party, trim(second_party) as second_party
         FROM aom_events
         WHERE event_date IS NOT NULL AND length(event_date) >= 10
         AND (first_party IS NOT NULL OR second_party IS NOT NULL)
         ORDER BY event_date DESC
         LIMIT 50000`
      )
      .all() as Array<{
      event_date: string
      first_party: string | null
      second_party: string | null
    }>

    const counterpartyCounts = new Map<string, number>()
    let lastSeen: string | undefined

    for (const r of rows) {
      const assignor = (r.first_party || "").trim()
      const assignee = (r.second_party || "").trim()
      const assignorNorm = normalize_name(assignor)
      const assigneeNorm = normalize_name(assignee)
      const assignorMatch = assignorNorm && aliasSet.has(assignorNorm)
      const assigneeMatch = assigneeNorm && aliasSet.has(assigneeNorm)

      if (assignorMatch && assignee) {
        metrics.outbound += 1
        counterpartyCounts.set(assignee, (counterpartyCounts.get(assignee) || 0) + 1)
        if (!lastSeen || r.event_date > lastSeen) lastSeen = r.event_date
      }
      if (assigneeMatch && assignor) {
        metrics.inbound += 1
        counterpartyCounts.set(assignor, (counterpartyCounts.get(assignor) || 0) + 1)
        if (!lastSeen || r.event_date > lastSeen) lastSeen = r.event_date
      }
    }

    metrics = {
      inbound: metrics.inbound,
      outbound: metrics.outbound,
      net: metrics.inbound - metrics.outbound,
      total: metrics.inbound + metrics.outbound,
      lastSeen: lastSeen?.slice(0, 10),
    }

    topCounterparties = Array.from(counterpartyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([n, count]) => ({ name: n, count }))

    aomDb.close()
  } else {
    notes.push("AOM database not found. Metrics unavailable.")
  }

  return {
    canonicalName: name,
    category,
    aliases: [...new Set(aliases)],
    metrics,
    topCounterparties,
    entities: [],
    notes,
  }
}
