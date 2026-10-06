/**
 * Acceptance check for the bank-behaviour fields: do the numbers the tool
 * ingests match the Call Report the bank actually filed?
 *
 * Three things, each against live FDIC data:
 *
 *  1. Every entry in `BEHAVIOR_FIELD_CATALOG` is printed for the sample banks'
 *     newest quarter, with its BankFind source or derivation formula, so a
 *     reader can trace each figure.
 *  2. If an FFIEC CDR bulk subset is on disk (`CDR_SUBSET_DIR`), the fields
 *     the subset carries are tied to it, cert by cert and quarter by quarter:
 *     LNLSSALE = RCON5369, ORE = RCON2150, P3RSLNLT = RCONHK26,
 *     P9RSLNLT = RCONHK27, NARSLNLT = RCONHK28. Any mismatch fails the process.
 *  3. With `COHORT=1`, the full-coverage nine-quarter pull is timed for the
 *     scope, and the number of institutions and quarters returned is reported,
 *     because the weekly job's runtime is what the coverage decision rests on.
 *
 *   npm run verify:behavior-fields
 *   CERTS=35541,24156,14851 npm run verify:behavior-fields
 *   CDR_SUBSET_DIR="$HOME/Downloads/FFIEC CDR Call Bulk Subset of Schedules 2026" npm run verify:behavior-fields
 *   COHORT=1 SCOPE=Florida npm run verify:behavior-fields
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fetchFDICData } from "../lib/fdic-client"
import { FDIC_ENDPOINTS, FDIC_FIELDS } from "../lib/fdic-config"
import {
  BEHAVIOR_FIELD_CATALOG,
  BEHAVIOR_QUARTERS,
  buildBehaviorHistory,
  groupBehaviorHistories,
  quarterEnds,
  type BehaviorHistory,
} from "../lib/analytics/bank-behavior"

type RawRow = Record<string, unknown>

const CERTS = (process.env.CERTS ?? "35541,24156,14851").split(",").map((s) => s.trim()).filter(Boolean)
const SCOPE = process.env.SCOPE ?? "National"

/** BankFind field → CDR MDRM, for the items the bulk subset carries. */
const TIE_OUT: readonly [bankfind: string, mdrm: string][] = [
  ["LNLSSALE", "RCON5369"],
  ["ORE", "RCON2150"],
  ["P3RSLNLT", "RCONHK26"],
  ["P9RSLNLT", "RCONHK27"],
  ["NARSLNLT", "RCONHK28"],
]

function windowFilter(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 27)
  return `[${d.toISOString().slice(0, 7)}-01 TO *]`
}

async function fetchRows(cert: string): Promise<RawRow[]> {
  const response = await fetchFDICData<RawRow>(FDIC_ENDPOINTS.financials, {
    filters: { CERT: cert, REPDTE: windowFilter() },
    fields: FDIC_FIELDS.behavior,
    limit: 12,
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  if (response.error) throw new Error(`${cert}: ${response.error}`)
  return response.data
}

function fmt(v: number | null): string {
  return v === null ? "null" : v.toLocaleString("en-US")
}

function printCatalog(history: BehaviorHistory): void {
  const newest = history.quarters[history.quarters.length - 1]
  console.log(`\n=== CERT ${history.cert} ${history.name} (${history.state ?? "?"}) — ${newest.label}, ${history.quarters.length} quarters, $000s`)
  const w = Math.max(...BEHAVIOR_FIELD_CATALOG.map((s) => s.key.length))
  for (const spec of BEHAVIOR_FIELD_CATALOG) {
    const value = newest[spec.key] as number | null
    const src = spec.kind === "reported" ? spec.source : `derived: ${spec.source}`
    console.log(`${spec.key.padEnd(w)} ${fmt(value).padStart(12)}  ${spec.basis.padEnd(7)} ${spec.schedule.padEnd(28)} ${src}`)
  }
}

/** Rows of the CDR subset for the certs of interest: cert → quarter (YYYYMMDD) → MDRM → value. */
function readCdrSubset(dir: string, certs: Set<string>): Map<string, Map<string, Record<string, string>>> {
  const out = new Map<string, Map<string, Record<string, string>>>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".txt") && !/readme/i.test(f))) {
    const lines = readFileSync(join(dir, file), "latin1").split(/\r?\n/)
    const header = lines[0].split("\t")
    const certCol = header.indexOf("FDIC Certificate Number")
    const dateCol = header.indexOf("Reporting Period End Date")
    if (certCol < 0 || dateCol < 0) continue
    const wanted = TIE_OUT.map(([, mdrm]) => [mdrm, header.indexOf(mdrm)] as const).filter(([, i]) => i >= 0)
    if (wanted.length === 0) continue
    // Line 2 is the MDRM description row.
    for (const line of lines.slice(2)) {
      const cells = line.split("\t")
      const cert = cells[certCol]
      if (!certs.has(cert)) continue
      const quarter = cells[dateCol].replace(/-/g, "")
      const perCert = out.get(cert) ?? new Map()
      const perQuarter = perCert.get(quarter) ?? {}
      for (const [mdrm, i] of wanted) if (cells[i] !== undefined && cells[i] !== "") perQuarter[mdrm] = cells[i]
      perCert.set(quarter, perQuarter)
      out.set(cert, perCert)
    }
  }
  return out
}

function tieOut(dir: string, rowsByCert: Map<string, RawRow[]>): boolean {
  console.log(`\n=== Tie-out against the FFIEC CDR subset in ${dir}`)
  const cdr = readCdrSubset(dir, new Set(rowsByCert.keys()))
  let compared = 0
  let failed = 0
  for (const [cert, rows] of rowsByCert) {
    const perCert = cdr.get(cert)
    if (!perCert) {
      console.log(`${cert}: not in the subset`)
      continue
    }
    for (const row of rows) {
      const quarter = String(row.REPDTE ?? "").replace(/-/g, "")
      const published = perCert.get(quarter)
      if (!published) continue
      for (const [bankfind, mdrm] of TIE_OUT) {
        if (!(mdrm in published)) continue
        const ours = row[bankfind] === null || row[bankfind] === undefined ? null : Number(row[bankfind])
        const theirs = Number(published[mdrm])
        compared++
        const ok = ours === theirs
        if (!ok) failed++
        console.log(`${ok ? "ok  " : "FAIL"} ${cert} ${quarter} ${bankfind.padEnd(9)} ${fmt(ours).padStart(12)}  ${mdrm} ${fmt(theirs).padStart(12)}`)
      }
    }
  }
  console.log(`${compared} comparisons, ${failed} mismatches`)
  return failed === 0 && compared > 0
}

async function timeCohort(scope: string): Promise<void> {
  const probe = await fetchFDICData<RawRow>(FDIC_ENDPOINTS.financials, {
    limit: 1,
    fields: ["REPDTE"],
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  const latest = String(probe.data?.[0]?.REPDTE ?? "").replace(/-/g, "")
  const quarters = quarterEnds(latest, BEHAVIOR_QUARTERS)
  const state = scope === "National" || scope === "national" ? undefined : scope
  console.log(`\n=== Cohort pull, ${scope}, quarters ${quarters[0]}..${quarters[quarters.length - 1]}`)
  const started = Date.now()
  const rows: RawRow[] = []
  let bytes = 0
  for (let i = 0; i < quarters.length; i += 3) {
    const batch = quarters.slice(i, i + 3)
    const pages = await Promise.all(
      batch.map(async (quarter) => {
        const t = Date.now()
        const response = await fetchFDICData<RawRow>(FDIC_ENDPOINTS.financials, {
          filters: { REPDTE: quarter, ...(state ? { STNAME: state.toUpperCase() } : {}) },
          fields: FDIC_FIELDS.behavior,
          limit: 10000,
          sort_by: "ASSET",
          sort_order: "DESC",
        })
        if (response.error) throw new Error(`${quarter}: ${response.error}`)
        const size = JSON.stringify(response.data).length
        console.log(`${quarter}: ${response.data.length} rows, ${(size / 1e6).toFixed(1)} MB, ${((Date.now() - t) / 1000).toFixed(1)}s`)
        return { rows: response.data, size }
      })
    )
    for (const p of pages) {
      rows.push(...p.rows)
      bytes += p.size
    }
  }
  const histories = groupBehaviorHistories(rows)
  const full = histories.filter((h) => h.quarters.length === BEHAVIOR_QUARTERS).length
  console.log(
    `${rows.length} rows, ${(bytes / 1e6).toFixed(1)} MB, ${histories.length} institutions (${full} with all nine quarters), ${((Date.now() - started) / 1000).toFixed(1)}s total`
  )
}

async function main(): Promise<void> {
  const rowsByCert = new Map<string, RawRow[]>()
  for (const cert of CERTS) {
    const rows = await fetchRows(cert)
    rowsByCert.set(cert, rows)
    printCatalog(buildBehaviorHistory(cert, rows))
  }

  let ok = true
  const dir = process.env.CDR_SUBSET_DIR
  if (dir) ok = tieOut(dir, rowsByCert)
  else console.log("\n(no CDR_SUBSET_DIR set — skipping the published Call Report tie-out)")

  if (process.env.COHORT) await timeCohort(SCOPE)

  if (!ok) {
    console.error("\nTie-out failed.")
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
