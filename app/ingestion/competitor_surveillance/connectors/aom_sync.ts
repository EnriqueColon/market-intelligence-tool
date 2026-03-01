import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"
import type { Connector, ConnectorResult, RunContext, SurveillanceEvent } from "../base"
import { getDb } from "../storage/db"
import { getCompetitors, parseAliases } from "../storage/queries"

const AOM_DB_PATH = path.join(process.cwd(), "data", "aom.sqlite")
const MAX_ROWS = 50_000
const MONTHS_BACK = 24

function words(haystack: string, needle: string): boolean {
  const h = ` ${(haystack || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `
  const n = ` ${(needle || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `
  return h.includes(n)
}

function isMatch(partyName: string, competitorName: string, aliases: string[]): boolean {
  const haystack = (partyName || "").toLowerCase()
  if (!haystack || haystack.length < 3) return false
  if (words(haystack, competitorName)) return true
  for (const a of aliases) {
    if (!a?.trim() || a.length < 3) continue
    if (words(haystack, a)) return true
  }
  return false
}

function normalizeDate(date?: string): string | undefined {
  if (!date) return undefined
  const s = String(date).trim()
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const p = new Date(s)
  if (Number.isNaN(p.getTime())) return undefined
  return p.toISOString().slice(0, 10)
}

export const aomSyncConnector: Connector = {
  key: "aom_sync",
  name: "County AOM",
  sourceType: "aom",
  isConfigured: () => {
    if (!fs.existsSync(AOM_DB_PATH)) return false
    try {
      const db = new Database(AOM_DB_PATH, { readonly: true })
      const row = db.prepare("SELECT COUNT(*) as n FROM aom_events").get() as { n: number }
      db.close()
      return (row?.n ?? 0) > 0
    } catch {
      return false
    }
  },
  async run(ctx: RunContext): Promise<ConnectorResult> {
    if (!fs.existsSync(AOM_DB_PATH)) {
      return { events: [], records: 0, status: "error", message: "AOM database not found at data/aom.sqlite" }
    }

    const survDb = getDb()
    const competitors = getCompetitors(survDb)
    const aomDb = new Database(AOM_DB_PATH, { readonly: true })

    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const rows = aomDb.prepare(
      `SELECT id, event_date, first_party, second_party, doc_type, cfn_master_id
       FROM aom_events
       WHERE event_date IS NOT NULL AND event_date >= ?
       ORDER BY event_date DESC
       LIMIT ?`
    ).all(cutoffStr, MAX_ROWS) as Array<{
      id: number
      event_date: string
      first_party: string | null
      second_party: string | null
      doc_type: string | null
      cfn_master_id: string | null
    }>

    aomDb.close()

    const events: SurveillanceEvent[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      const eventDate = normalizeDate(row.event_date)
      const firstParty = (row.first_party || "").trim()
      const secondParty = (row.second_party || "").trim()
      const url = `aom:${row.id}`

      for (const comp of competitors) {
        const aliases = parseAliases(comp.aliases_json)
        const matchFirst = firstParty && isMatch(firstParty, comp.name, aliases)
        const matchSecond = secondParty && isMatch(secondParty, comp.name, aliases)
        if (!matchFirst && !matchSecond) continue

        const dedupeKey = `${comp.id}:${url}:${eventDate || ""}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)

        const title = firstParty && secondParty
          ? `AOM: ${firstParty} → ${secondParty}`
          : firstParty || secondParty || `AOM ${row.doc_type || "event"}`

        events.push({
          competitor_id: comp.id,
          source_type: "aom",
          event_type: "aom",
          title: title.slice(0, 500),
          summary: [firstParty, secondParty].filter(Boolean).join(" / "),
          event_date: eventDate,
          url,
          raw_json: JSON.stringify({
            doc_type: row.doc_type,
            cfn_master_id: row.cfn_master_id,
            first_party: firstParty,
            second_party: secondParty,
          }),
        })
      }
    }

    return {
      events,
      records: events.length,
      status: events.length > 0 ? "ok" : "partial",
      message: events.length > 0 ? undefined : "No AOM events matched competitors",
    }
  },
}
