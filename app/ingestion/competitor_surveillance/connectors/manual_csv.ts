import type { Connector, ConnectorResult, RunContext, SurveillanceEvent } from "../base"
import { getDb } from "../storage/db"
import { getCompetitorByName } from "../storage/queries"

export type ManualCsvRow = {
  competitor_name: string
  event_type: string
  event_date?: string
  title?: string
  summary?: string
  url?: string
  raw_json?: string
}

function parseCsv(text: string): ManualCsvRow[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ""))
  const idx = (name: string) => header.findIndex((h) => h === name)
  const compIdx = idx("competitor_name")
  const typeIdx = idx("event_type")
  const dateIdx = idx("event_date")
  const titleIdx = idx("title")
  const summaryIdx = idx("summary")
  const urlIdx = idx("url")
  const rawIdx = idx("raw_json")
  if (compIdx < 0 || typeIdx < 0) return []

  const rows: ManualCsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const competitor_name = cells[compIdx]?.trim() || ""
    const event_type = cells[typeIdx]?.trim() || "unknown"
    if (!competitor_name || !event_type) continue
    rows.push({
      competitor_name,
      event_type,
      event_date: cells[dateIdx]?.trim() || undefined,
      title: cells[titleIdx]?.trim() || undefined,
      summary: cells[summaryIdx]?.trim() || undefined,
      url: cells[urlIdx]?.trim() || undefined,
      raw_json: cells[rawIdx]?.trim() || undefined,
    })
  }
  return rows
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
    } else if (c === "," && !inQuotes) {
      out.push(cur.trim().replace(/^"|"$/g, ""))
      cur = ""
    } else {
      cur += c
    }
  }
  out.push(cur.trim().replace(/^"|"$/g, ""))
  return out
}

function normalizeDate(v?: string): string | undefined {
  if (!v) return undefined
  const p = new Date(v.trim())
  if (Number.isNaN(p.getTime())) return v.trim()
  return p.toISOString().slice(0, 10)
}

export const manualCsvConnector: Connector = {
  key: "manual_csv",
  name: "Manual CSV Upload",
  sourceType: "manual_csv",
  isConfigured: () => true,
  async run(ctx: RunContext): Promise<ConnectorResult> {
    return { events: [], records: 0, status: "ok", message: "Use ingestManualCsv() with CSV text" }
  },
}

export async function ingestManualCsv(csvText: string): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const db = getDb()
  const rows = parseCsv(csvText)
  const events: SurveillanceEvent[] = []
  const errors: string[] = []
  let skipped = 0

  for (const row of rows) {
    const comp = getCompetitorByName(db, row.competitor_name)
    if (!comp) {
      errors.push(`Unknown competitor: ${row.competitor_name}`)
      skipped++
      continue
    }
    events.push({
      competitor_id: comp.id,
      source_type: "manual_csv",
      event_type: row.event_type,
      title: row.title,
      summary: row.summary,
      event_date: normalizeDate(row.event_date),
      url: row.url || `manual:${comp.id}:${row.event_type}:${Date.now()}`,
      raw_json: row.raw_json,
    })
  }

  const stmt = db.prepare(`
    INSERT INTO events (competitor_id, source_type, event_type, title, summary, event_date, url, raw_json)
    VALUES (@competitor_id, @source_type, @event_type, @title, @summary, @event_date, @url, @raw_json)
  `)
  let ingested = 0
  for (const e of events) {
    try {
      stmt.run({
        competitor_id: e.competitor_id,
        source_type: e.source_type,
        event_type: e.event_type,
        title: e.title ?? null,
        summary: e.summary ?? null,
        event_date: e.event_date ?? null,
        url: e.url ?? null,
        raw_json: e.raw_json ?? null,
      })
      ingested++
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  return { ingested, skipped, errors }
}
