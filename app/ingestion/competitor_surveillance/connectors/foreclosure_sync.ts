import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"
import type { Connector, ConnectorResult, RunContext, SurveillanceEvent } from "../base"
import { getDb } from "../storage/db"
import { getCompetitors, parseAliases } from "../storage/queries"

const INGESTION_DB_PATH = path.join(process.cwd(), "data", "ingestion.sqlite")
const MAX_ROWS = 20_000
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

export const foreclosureSyncConnector: Connector = {
  key: "foreclosure_sync",
  name: "Foreclosure / Docket",
  sourceType: "foreclosure",
  isConfigured: () => {
    if (!fs.existsSync(INGESTION_DB_PATH)) return false
    try {
      const db = new Database(INGESTION_DB_PATH, { readonly: true })
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foreclosure_notices'").all()
      if (!tables.length) {
        db.close()
        return false
      }
      const row = db.prepare("SELECT COUNT(*) as n FROM foreclosure_notices").get() as { n: number }
      db.close()
      return (row?.n ?? 0) > 0
    } catch {
      return false
    }
  },
  async run(ctx: RunContext): Promise<ConnectorResult> {
    if (!fs.existsSync(INGESTION_DB_PATH)) {
      return { events: [], records: 0, status: "error", message: "Ingestion database not found at data/ingestion.sqlite" }
    }

    const survDb = getDb()
    const competitors = getCompetitors(survDb)

    let ingDb: Database.Database
    try {
      ingDb = new Database(INGESTION_DB_PATH, { readonly: true })
    } catch {
      return { events: [], records: 0, status: "error", message: "Could not open ingestion database" }
    }

    const tables = ingDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foreclosure_notices'").all()
    if (!tables.length) {
      ingDb.close()
      return { events: [], records: 0, status: "error", message: "foreclosure_notices table not found" }
    }

    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const rows = ingDb.prepare(
      `SELECT id, county, state, case_number, filing_date, plaintiff, defendant, property_address, status
       FROM foreclosure_notices
       WHERE filing_date >= ?
       ORDER BY filing_date DESC
       LIMIT ?`
    ).all(cutoffStr, MAX_ROWS) as Array<{
      id: number
      county: string
      state: string
      case_number: string
      filing_date: string
      plaintiff: string
      defendant: string
      property_address: string
      status: string
    }>

    ingDb.close()

    const events: SurveillanceEvent[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      const eventDate = normalizeDate(row.filing_date)
      const plaintiff = (row.plaintiff || "").trim()
      const defendant = (row.defendant || "").trim()
      const url = `foreclosure:${row.id}`

      for (const comp of competitors) {
        const aliases = parseAliases(comp.aliases_json)
        const matchPlaintiff = plaintiff && isMatch(plaintiff, comp.name, aliases)
        const matchDefendant = defendant && isMatch(defendant, comp.name, aliases)
        if (!matchPlaintiff && !matchDefendant) continue

        const dedupeKey = `${comp.id}:${url}:${eventDate || ""}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)

        const title = `Foreclosure: ${row.case_number}`
        const summary = [plaintiff, defendant, row.property_address].filter(Boolean).join(" | ")

        events.push({
          competitor_id: comp.id,
          source_type: "foreclosure",
          event_type: "foreclosure",
          title: title.slice(0, 500),
          summary: summary.slice(0, 1000),
          event_date: eventDate,
          url,
          raw_json: JSON.stringify({
            county: row.county,
            state: row.state,
            case_number: row.case_number,
            plaintiff,
            defendant,
            status: row.status,
          }),
        })
      }
    }

    return {
      events,
      records: events.length,
      status: events.length > 0 ? "ok" : "partial",
      message: events.length > 0 ? undefined : "No foreclosure notices matched competitors",
    }
  },
}
