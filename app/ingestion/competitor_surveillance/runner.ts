import { getConnectors } from "./registry"
import { getDb } from "./storage/db"
import type { SurveillanceEvent } from "./base"

export type RunResult = {
  connector: string
  records: number
  status: string
  message?: string
}

export async function runIngestion(connectorKeys?: string[]): Promise<RunResult[]> {
  const connectors = connectorKeys?.length
    ? getConnectors().filter((c) => connectorKeys.includes(c.key))
    : getConnectors()
  const results: RunResult[] = []
  const db = getDb()

  for (const connector of connectors) {
    try {
      const result = await connector.run({ dryRun: false })
      if (result.events.length > 0) {
        insertEvents(db, result.events)
      }
      results.push({
        connector: connector.key,
        records: result.records,
        status: result.status,
        message: result.message,
      })
    } catch (err) {
      results.push({
        connector: connector.key,
        records: 0,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}

function insertEvents(db: ReturnType<typeof getDb>, events: SurveillanceEvent[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events (competitor_id, source_type, event_type, title, summary, event_date, url, raw_json)
    VALUES (@competitor_id, @source_type, @event_type, @title, @summary, @event_date, @url, @raw_json)
  `)
  const dedupe = db.prepare(`
    SELECT 1 FROM events WHERE competitor_id = ? AND url = ? AND event_date = ? LIMIT 1
  `)
  for (const e of events) {
    if (!e.url) continue
    const exists = dedupe.get(e.competitor_id, e.url, e.event_date || "")
    if (exists) continue
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
  }
}
