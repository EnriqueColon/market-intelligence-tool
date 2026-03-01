"use server"

import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"
import { getDb } from "@/app/ingestion/competitor_surveillance/storage/db"
import { ingestManualCsv } from "@/app/ingestion/competitor_surveillance/connectors/manual_csv"
import { runIngestion } from "@/app/ingestion/competitor_surveillance/runner"

export type SurveillanceEventRow = {
  id: number
  competitor_id: number
  competitor_name: string
  source_type: string
  event_type: string
  title: string | null
  summary: string | null
  event_date: string | null
  url: string | null
  created_at: string | null
}

export type CompetitorRow = {
  id: number
  name: string
  aliases_json: string
}

export type MetricsRow = {
  competitor_id: number
  competitor_name: string
  metric_date: string
  event_count_30d: number
  fundraise_count_24m: number
  ucc_count_90d: number
  aom_count_90d: number
  foreclosure_count_90d: number
  hiring_count_90d: number
}

export type SourceStatus = {
  sec_edgar: boolean
  rss_news: boolean
  manual_csv: boolean
  ucc: boolean
  aom: boolean
  foreclosure: boolean
  hiring: boolean
}

export async function fetchSurveillanceSourceStatus(): Promise<SourceStatus> {
  const db = getDb()
  const aomPath = path.join(process.cwd(), "data", "aom.sqlite")
  const ingestionPath = path.join(process.cwd(), "data", "ingestion.sqlite")

  let aomConfigured = false
  if (fs.existsSync(aomPath)) {
    try {
      const aomDb = new Database(aomPath, { readonly: true })
      const row = aomDb.prepare("SELECT COUNT(*) as n FROM aom_events").get() as { n: number }
      aomDb.close()
      aomConfigured = (row?.n ?? 0) > 0
    } catch {
      aomConfigured = false
    }
  }

  let uccConfigured = false
  let foreclosureConfigured = false
  if (fs.existsSync(ingestionPath)) {
    try {
      const ingDb = new Database(ingestionPath, { readonly: true })
      const tables = ingDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ucc_filings','foreclosure_notices')"
      ).all() as { name: string }[]
      const tableNames = new Set(tables.map((t) => t.name))
      if (tableNames.has("ucc_filings")) {
        const uccRow = ingDb.prepare("SELECT COUNT(*) as n FROM ucc_filings").get() as { n: number }
        uccConfigured = (uccRow?.n ?? 0) > 0
      }
      if (tableNames.has("foreclosure_notices")) {
        const foreRow = ingDb.prepare("SELECT COUNT(*) as n FROM foreclosure_notices").get() as { n: number }
        foreclosureConfigured = (foreRow?.n ?? 0) > 0
      }
      ingDb.close()
    } catch {
      uccConfigured = false
      foreclosureConfigured = false
    }
  }

  const hiringRow = db.prepare(
    "SELECT 1 FROM events WHERE event_type = 'hiring' LIMIT 1"
  ).get()
  const hiringConfigured = !!hiringRow

  return {
    sec_edgar: true,
    rss_news: true,
    manual_csv: true,
    ucc: uccConfigured,
    aom: aomConfigured,
    foreclosure: foreclosureConfigured,
    hiring: hiringConfigured,
  }
}

export async function ensureSurveillanceMetrics(): Promise<void> {
  await computeSurveillanceMetrics()
}

export async function fetchSurveillanceEvents(limit = 50): Promise<SurveillanceEventRow[]> {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT e.id, e.competitor_id, c.name AS competitor_name, e.source_type, e.event_type,
           e.title, e.summary, e.event_date, e.url, e.created_at
    FROM events e
    JOIN competitors c ON c.id = e.competitor_id
    ORDER BY e.event_date DESC, e.created_at DESC
    LIMIT ?
  `
    )
    .all(limit) as SurveillanceEventRow[]
  return rows
}

export async function fetchSurveillanceCompetitors(): Promise<CompetitorRow[]> {
  const db = getDb()
  return db.prepare("SELECT id, name, aliases_json FROM competitors ORDER BY name").all() as CompetitorRow[]
}

export async function fetchSurveillanceMetrics(): Promise<MetricsRow[]> {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT m.competitor_id, c.name AS competitor_name, m.metric_date,
           m.event_count_30d, m.fundraise_count_24m, m.ucc_count_90d,
           m.aom_count_90d, m.foreclosure_count_90d, m.hiring_count_90d
    FROM metrics_daily m
    JOIN competitors c ON c.id = m.competitor_id
    WHERE m.metric_date = (SELECT MAX(metric_date) FROM metrics_daily WHERE competitor_id = m.competitor_id)
    ORDER BY c.name
  `
    )
    .all() as MetricsRow[]
  return rows
}

export async function computeSurveillanceMetrics(): Promise<void> {
  const db = getDb()
  const competitors = db.prepare("SELECT id FROM competitors").all() as { id: number }[]
  const today = new Date().toISOString().slice(0, 10)
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO metrics_daily
    (competitor_id, metric_date, event_count_30d, fundraise_count_24m, ucc_count_90d, aom_count_90d, foreclosure_count_90d, hiring_count_90d)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const c of competitors) {
    const eventCount30d = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE competitor_id = ? AND event_date >= date(?, '-30 days')`
      )
      .get(c.id, today) as { n: number })?.n ?? 0
    const fundraise24m = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE competitor_id = ? AND event_type IN ('fundraise','fundraise_amendment') AND event_date >= date(?, '-24 months')`
      )
      .get(c.id, today) as { n: number })?.n ?? 0
    const ucc90d = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE competitor_id = ? AND event_type = 'ucc' AND event_date >= date(?, '-90 days')`
      )
      .get(c.id, today) as { n: number })?.n ?? 0
    const aom90d = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE competitor_id = ? AND event_type = 'aom' AND event_date >= date(?, '-90 days')`
      )
      .get(c.id, today) as { n: number })?.n ?? 0
    const foreclosure90d = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE competitor_id = ? AND event_type = 'foreclosure' AND event_date >= date(?, '-90 days')`
      )
      .get(c.id, today) as { n: number })?.n ?? 0
    const hiring90d = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE competitor_id = ? AND event_type = 'hiring' AND event_date >= date(?, '-90 days')`
      )
      .get(c.id, today) as { n: number })?.n ?? 0
    stmt.run(c.id, today, eventCount30d, fundraise24m, ucc90d, aom90d, foreclosure90d, hiring90d)
  }
}

export async function runSurveillanceIngestion(connectors?: string[]): Promise<{ results: Array<{ connector: string; records: number; status: string; message?: string }> }> {
  const results = await runIngestion(connectors)
  await computeSurveillanceMetrics()
  return { results }
}

export async function uploadManualCsv(csvText: string): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const result = await ingestManualCsv(csvText)
  await computeSurveillanceMetrics()
  return result
}
