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

export const uccSyncConnector: Connector = {
  key: "ucc_sync",
  name: "UCC Filings",
  sourceType: "ucc",
  isConfigured: () => {
    if (!fs.existsSync(INGESTION_DB_PATH)) return false
    try {
      const db = new Database(INGESTION_DB_PATH, { readonly: true })
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ucc_filings'").all()
      if (!tables.length) {
        db.close()
        return false
      }
      const row = db.prepare("SELECT COUNT(*) as n FROM ucc_filings").get() as { n: number }
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

    const tables = ingDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ucc_filings'").all()
    if (!tables.length) {
      ingDb.close()
      return { events: [], records: 0, status: "error", message: "ucc_filings table not found" }
    }

    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const rows = ingDb.prepare(
      `SELECT id, state, filing_number, filing_date, debtor_name, secured_party, collateral_summary, status
       FROM ucc_filings
       WHERE filing_date >= ?
       ORDER BY filing_date DESC
       LIMIT ?`
    ).all(cutoffStr, MAX_ROWS) as Array<{
      id: number
      state: string
      filing_number: string
      filing_date: string
      debtor_name: string
      secured_party: string
      collateral_summary: string
      status: string
    }>

    ingDb.close()

    const events: SurveillanceEvent[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      const eventDate = normalizeDate(row.filing_date)
      const securedParty = (row.secured_party || "").trim()
      const debtorName = (row.debtor_name || "").trim()
      const url = `ucc:${row.id}`

      for (const comp of competitors) {
        const aliases = parseAliases(comp.aliases_json)
        const matchSecured = securedParty && isMatch(securedParty, comp.name, aliases)
        const matchDebtor = debtorName && isMatch(debtorName, comp.name, aliases)
        if (!matchSecured && !matchDebtor) continue

        const dedupeKey = `${comp.id}:${url}:${eventDate || ""}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)

        const title = `UCC: ${securedParty || debtorName}`
        const summary = [debtorName, securedParty, row.collateral_summary].filter(Boolean).join(" | ")

        events.push({
          competitor_id: comp.id,
          source_type: "ucc",
          event_type: "ucc",
          title: title.slice(0, 500),
          summary: summary.slice(0, 1000),
          event_date: eventDate,
          url,
          raw_json: JSON.stringify({
            state: row.state,
            filing_number: row.filing_number,
            debtor_name: debtorName,
            secured_party: securedParty,
            status: row.status,
          }),
        })
      }
    }

    return {
      events,
      records: events.length,
      status: events.length > 0 ? "ok" : "partial",
      message: events.length > 0 ? undefined : "No UCC filings matched competitors",
    }
  },
}
