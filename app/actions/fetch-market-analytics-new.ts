"use server"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs/promises"

const execFileAsync = promisify(execFile)
const SQLITE3_CANDIDATES = ["sqlite3", "/usr/bin/sqlite3"] as const

type RunStatus = {
  connector: string
  status: string
  finished_at?: string
  message?: string
}

export type FfiecTopRow = {
  institution_id: string
  value: number
  units: string
}

export type FfiecTrendPoint = {
  reporting_period_end: string
  value: number
}

export type CensusTrendPoint = {
  time_period: string
  metric_code: string
  metric_name: string
  value: number
}

export type UccCountRow = {
  state: string
  count: number
}

export type UccLatestRow = {
  state: string
  filing_number: string
  filing_date: string
  debtor_name: string
  secured_party: string
  status: string
}

export type ForeclosureCountRow = {
  county: string
  state: string
  count: number
}

export type ForeclosureLatestRow = {
  county: string
  state: string
  case_number: string
  filing_date: string
  plaintiff: string
  defendant: string
  status: string
}

export type NewSignalsSnapshot = {
  statusByConnector: Record<string, RunStatus>
  ffiec: {
    configured: boolean
    latestPeriod?: string
    metricCode: string
    metricLabel: string
    top: FfiecTopRow[]
    trend: FfiecTrendPoint[]
  }
  census: {
    configured: boolean
    latestByMetric: Record<string, CensusTrendPoint | undefined>
    trend: CensusTrendPoint[]
  }
  ucc: {
    configured: boolean
    last30ByState: UccCountRow[]
    latest: UccLatestRow[]
  }
  foreclosures: {
    configured: boolean
    last30ByCounty: ForeclosureCountRow[]
    latest: ForeclosureLatestRow[]
  }
  notes: string[]
}

const inMemoryCache = new Map<string, { value: NewSignalsSnapshot; expires: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

function ingestionDbPath() {
  return path.join(process.cwd(), "data", "ingestion.sqlite")
}

async function execSqliteJson<T>(db: string, sql: string, notes: string[]): Promise<T> {
  let lastError: unknown
  for (const bin of SQLITE3_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(bin, ["-json", db, sql], { timeout: 30_000 })
      const text = String(stdout || "").trim()
      return (text ? JSON.parse(text) : []) as T
    } catch (err) {
      lastError = err
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : typeof lastError === "string" ? lastError : "Unknown error"
  notes.push(`sqlite3 execution failed: ${message}`)
  return [] as T
}

function pickLatestRuns(rows: RunStatus[]) {
  const out: Record<string, RunStatus> = {}
  for (const row of rows) {
    if (!row.connector) continue
    const existing = out[row.connector]
    if (!existing || (row.finished_at || "") > (existing.finished_at || "")) {
      out[row.connector] = row
    }
  }
  return out
}

export async function fetchNewSignalsSnapshot(): Promise<NewSignalsSnapshot> {
  const cacheKey = "new_signals_snapshot"
  const cached = inMemoryCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return cached.value
  }

  const notes: string[] = []
  const dbPath = ingestionDbPath()
  try {
    await fs.access(dbPath)
  } catch {
    const empty: NewSignalsSnapshot = {
      statusByConnector: {},
      ffiec: {
        configured: Boolean(process.env.FFIEC_USER_ID && process.env.FFIEC_TOKEN),
        metricCode: "RCFD1415",
        metricLabel: "Nonaccrual Loans",
        top: [],
        trend: [],
      },
      census: { configured: Boolean(process.env.CENSUS_API_KEY), latestByMetric: {}, trend: [] },
      ucc: { configured: false, last30ByState: [], latest: [] },
      foreclosures: { configured: false, last30ByCounty: [], latest: [] },
      notes: ["Ingestion database not found."],
    }
    return empty
  }

  const statusRows = await execSqliteJson<RunStatus[]>(
    dbPath,
    "SELECT connector, status, finished_at, message FROM ingestion_runs ORDER BY finished_at DESC",
    notes
  )
  const statusByConnector = pickLatestRuns(statusRows)

  const ffiecMetricCode = "RCFD1415"
  const ffiecMetricLabel = "Nonaccrual Loans"
  const ffiecLatestPeriodRows = await execSqliteJson<Array<{ reporting_period_end: string }>>(
    dbPath,
    "SELECT reporting_period_end FROM ffiec_call_report ORDER BY reporting_period_end DESC LIMIT 1",
    notes
  )
  const latestPeriod = ffiecLatestPeriodRows[0]?.reporting_period_end
  const ffiecTop = latestPeriod
    ? await execSqliteJson<FfiecTopRow[]>(
        dbPath,
        `SELECT institution_id, value, units FROM ffiec_call_report WHERE reporting_period_end = '${latestPeriod}' AND field_code = '${ffiecMetricCode}' ORDER BY value DESC LIMIT 10`,
        notes
      )
    : []
  const ffiecTrend = await execSqliteJson<FfiecTrendPoint[]>(
    dbPath,
    `SELECT reporting_period_end, AVG(value) as value FROM ffiec_call_report WHERE field_code = '${ffiecMetricCode}' GROUP BY reporting_period_end ORDER BY reporting_period_end DESC LIMIT 8`,
    notes
  )

  const censusTrend = await execSqliteJson<CensusTrendPoint[]>(
    dbPath,
    "SELECT time_period, metric_code, metric_name, value FROM census_resconst ORDER BY time_period DESC LIMIT 36",
    notes
  )
  const latestByMetric: Record<string, CensusTrendPoint | undefined> = {}
  for (const row of censusTrend) {
    if (!latestByMetric[row.metric_code]) {
      latestByMetric[row.metric_code] = row
    }
  }

  const uccLast30 = await execSqliteJson<UccCountRow[]>(
    dbPath,
    "SELECT state, COUNT(*) as count FROM ucc_filings WHERE date(filing_date) >= date('now','-30 day') GROUP BY state ORDER BY count DESC",
    notes
  )
  const uccLatest = await execSqliteJson<UccLatestRow[]>(
    dbPath,
    "SELECT state, filing_number, filing_date, debtor_name, secured_party, status FROM ucc_filings ORDER BY filing_date DESC LIMIT 10",
    notes
  )

  const foreclosureLast30 = await execSqliteJson<ForeclosureCountRow[]>(
    dbPath,
    "SELECT county, state, COUNT(*) as count FROM foreclosure_notices WHERE date(filing_date) >= date('now','-30 day') GROUP BY county, state ORDER BY count DESC",
    notes
  )
  const foreclosureLatest = await execSqliteJson<ForeclosureLatestRow[]>(
    dbPath,
    "SELECT county, state, case_number, filing_date, plaintiff, defendant, status FROM foreclosure_notices ORDER BY filing_date DESC LIMIT 10",
    notes
  )

  const snapshot: NewSignalsSnapshot = {
    statusByConnector,
    ffiec: {
      configured: Boolean(process.env.FFIEC_USER_ID && process.env.FFIEC_TOKEN),
      latestPeriod,
      metricCode: ffiecMetricCode,
      metricLabel: ffiecMetricLabel,
      top: ffiecTop,
      trend: ffiecTrend,
    },
    census: {
      configured: Boolean(process.env.CENSUS_API_KEY),
      latestByMetric,
      trend: censusTrend,
    },
    ucc: {
      configured: Boolean(statusByConnector.ucc || uccLast30.length || uccLatest.length),
      last30ByState: uccLast30,
      latest: uccLatest,
    },
    foreclosures: {
      configured: Boolean(statusByConnector.foreclosures || foreclosureLast30.length || foreclosureLatest.length),
      last30ByCounty: foreclosureLast30,
      latest: foreclosureLatest,
    },
    notes,
  }
  inMemoryCache.set(cacheKey, { value: snapshot, expires: Date.now() + CACHE_TTL_MS })
  return snapshot
}
