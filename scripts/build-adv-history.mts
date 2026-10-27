/**
 * Build the committed Form ADV history from the SEC's bulk filing data.
 *
 *   npm run build:adv-history -- --dir <folder with the CSVs>
 *
 * The SEC publishes every Form ADV filing from 2011-11-05 to 2024-12-31 as
 * CSVs in two zip archives (`https://www.sec.gov/files/adv-filing-data-
 * 20111105-20241231-part1.zip` and `-part2.zip`, 1.1 GB together). Four
 * tables are read, streamed line by line because the largest is 533 MB:
 *
 *   IA_ADV_Base_A        every registered adviser's filings: FilingID, the
 *                        date submitted, and the CRD (column `1E1`)
 *   ADV_Filing_Types     whether a filing was the annual updating amendment
 *   IA_Schedule_D_7B1    one row per private fund per filing — the same
 *                        questions the PDF parser reads for the current year
 *   ERA_Schedule_D_7B1   the same for exempt reporting advisers, for
 *                        completeness; every adviser in the registry is
 *                        registered, so it contributes nothing today
 *
 * Only the filings of the advisers in `registry.ts` are kept, keyed by the
 * fund's `805-` number so a renamed fund stays one series. Runs locally, like
 * `refresh:peer-adv`; the app reads the committed file and fetches nothing.
 * The report at the end is the check: filings and years per adviser, and
 * Safe Harbor's Fund 3 as a series, which the bulk table was first read on.
 */

import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { join } from "node:path"
import registry from "../lib/peer-intel/registry"
import history from "../lib/peer-intel/adv-history"
import advLink from "../lib/peer-intel/adv-link"
import type { AdvHistory, AdvHistoryPoint } from "../lib/peer-intel/adv-history"
import type { YesNo } from "../lib/peer-intel/adv"

const { PEERS } = registry
const { yearlySeries, seriesNotes } = history
const { advisersToRead } = advLink

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const DIR = flag("dir") ?? join(process.env.CLAUDE_SCRATCHPAD ?? "/tmp", "adv-bulk", "extract")
const OUT = join(process.cwd(), "lib", "peer-intel", "adv-history.json")
const TODAY = new Date().toISOString().slice(0, 10)

function file(prefix: string): string {
  const name = readdirSync(DIR).find((f) => f.startsWith(prefix) && f.endsWith(".csv"))
  if (!name) throw new Error(`no ${prefix}*.csv in ${DIR}`)
  return join(DIR, name)
}

/** RFC 4180 fields; the SEC's files carry no embedded newlines. */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      out.push(cur)
      cur = ""
    } else cur += c
  }
  out.push(cur)
  return out
}

async function scan(path: string, onRow: (row: string[], header: string[]) => void, keep?: (line: string) => boolean): Promise<number> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let header: string[] | null = null
  let n = 0
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line).map((h) => h.trim())
      continue
    }
    n++
    if (keep && !keep(line)) continue
    onRow(parseCsvLine(line), header)
  }
  return n
}

/** `MM/DD/YYYY hh:mm:ss AM` → `YYYY-MM-DD`. */
function isoDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null
}

const yesNo = (s: string): YesNo => (s === "Y" ? true : s === "N" ? false : null)
const num = (s: string): number | null => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null)
const opinion = (s: string): AdvHistoryPoint["opinion"] =>
  /^y(es)?$/i.test(s) ? "unqualified" : /^n(o)?$/i.test(s) ? "not-unqualified" : /not yet received/i.test(s) ? "report-not-yet-received" : null

async function main() {
  // The same advisers the current extract reads — which leaves out the
  // umbrella filers (Apollo Capital Management, Ares Management, HPS
  // Investment Partners) whose tracked vehicles have advisers of their own.
  // Those three alone carry 61,000 of the 70,000 fund-filings in the bulk
  // data for the registry's advisers, and none of it reaches a panel.
  const sources = new Map<string, string>()
  for (const p of PEERS) for (const s of advisersToRead(p)) sources.set(s.crd, s.name)
  const crds = new Set(sources.keys())
  console.log(`${crds.size} adviser CRDs read by the extract; reading ${DIR}\n`)

  // 1. Filings of those advisers.
  const filings = new Map<number, { crd: string; filedOn: string; annual: boolean | null }>()
  const baseA = file("IA_ADV_Base_A")
  let t = Date.now()
  const baseRows = await scan(baseA, (r, h) => {
    const crd = r[h.indexOf("1E1")]
    if (!crds.has(crd)) return
    const filedOn = isoDate(r[h.indexOf("DateSubmitted")])
    if (!filedOn) return
    filings.set(Number(r[h.indexOf("FilingID")]), { crd, filedOn, annual: null })
  })
  console.log(`IA_ADV_Base_A: ${baseRows} filings scanned, ${filings.size} belong to registry advisers (${((Date.now() - t) / 1000).toFixed(0)}s)`)

  // 2. Which were annual updating amendments.
  t = Date.now()
  await scan(file("ADV_Filing_Types"), (r, h) => {
    const f = filings.get(Number(r[h.indexOf("FilingID")]))
    if (!f) return
    const annual = r[h.indexOf("Annual Updating Amendment for Registered Adviser")] === "Y" || r[h.indexOf("Annual Updating Amendment ERA Report")] === "Y"
    const other = r[h.indexOf("Other-Than Anual Amendment For Registered Adviser")] === "Y" || r[h.indexOf("Other-Than Annual Amendment ERA Report")] === "Y"
    f.annual = annual ? true : other ? false : null
  })
  console.log(`ADV_Filing_Types: ${[...filings.values()].filter((f) => f.annual).length} annual, ${[...filings.values()].filter((f) => f.annual === false).length} other-than-annual (${((Date.now() - t) / 1000).toFixed(0)}s)`)

  // 3. The fund rows on those filings.
  const funds: AdvHistory["funds"] = {}
  const ids = new Set([...filings.keys()].map(String))
  for (const prefix of ["IA_Schedule_D_7B1_", "ERA_Schedule_D_7B1_"]) {
    const path = (() => {
      try {
        return file(prefix)
      } catch {
        return null
      }
    })()
    if (!path) {
      console.log(`${prefix}*.csv not present, skipped`)
      continue
    }
    t = Date.now()
    let kept = 0
    const rows = await scan(
      path,
      (r, h) => {
        const col = (name: string) => r[h.indexOf(name)] ?? ""
        const filingId = Number(col("FilingID"))
        const f = filings.get(filingId)
        if (!f) return
        const name = col("Fund Name").trim()
        const fundId = col("Fund ID").trim() || `${f.crd}:${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`
        const entry = (funds[fundId] ??= { crd: f.crd, names: [], points: [] })
        if (!entry.names.includes(name)) entry.names.push(name)
        entry.points.push({
          filedOn: f.filedOn,
          filingId,
          annual: f.annual,
          grossAssetValue: num(col("Gross Asset Value")),
          owners: num(col("Owners")),
          annualAudit: yesNo(col("Annual Audit")),
          statementsDistributed: yesNo(col("FS Distributed")),
          opinion: opinion(col("Unqualified Opinion")),
          isFeederFund: yesNo(col("Feeder Fund")),
        })
        kept++
      },
      (line) => ids.has(line.slice(0, line.indexOf(",")))
    )
    console.log(`${prefix}: ${rows} rows scanned, ${kept} kept (${((Date.now() - t) / 1000).toFixed(0)}s)`)
  }
  // An other-than-annual amendment usually repeats the fund's answers from
  // the filing before it; those repeats carry no information, and dropping
  // them keeps the committed file small. An annual filing is always kept,
  // and so is any filing on which something changed.
  let dropped = 0
  for (const e of Object.values(funds)) {
    e.points.sort((a, b) => a.filedOn.localeCompare(b.filedOn) || a.filingId - b.filingId)
    const kept: AdvHistoryPoint[] = []
    for (const p of e.points) {
      const prev = kept[kept.length - 1]
      const same =
        prev &&
        !p.annual &&
        prev.grossAssetValue === p.grossAssetValue &&
        prev.owners === p.owners &&
        prev.annualAudit === p.annualAudit &&
        prev.statementsDistributed === p.statementsDistributed &&
        prev.opinion === p.opinion &&
        prev.isFeederFund === p.isFeederFund
      if (same) dropped++
      else kept.push(p)
    }
    e.points = kept
  }
  console.log(`${dropped} other-than-annual points dropped as repeats of the filing before them`)

  const dates = [...filings.values()].map((f) => f.filedOn).sort()
  const out: AdvHistory = {
    builtOn: TODAY,
    source: "SEC Form ADV bulk filing data, 2011-11-05 to 2024-12-31 (adv-filing-data-20111105-20241231-part1/2.zip)",
    coverage: { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" },
    funds,
  }

  console.log("\nPer adviser:")
  for (const [crd, name] of sources) {
    const fs = [...filings.entries()].filter(([, f]) => f.crd === crd)
    const fundIds = Object.entries(funds).filter(([, e]) => e.crd === crd)
    const years = [...new Set(fs.map(([, f]) => f.filedOn.slice(0, 4)))].sort()
    console.log(
      `  ${crd.padEnd(7)} ${name.slice(0, 40).padEnd(41)} ${String(fs.length).padStart(3)} filings ${fs.length ? `${years[0]}–${years[years.length - 1]}` : "         "}  ${String(fundIds.length).padStart(4)} funds, ${fundIds.reduce((n, [, e]) => n + e.points.length, 0)} fund-filings`
    )
  }

  const fund3 = Object.entries(funds).find(([, e]) => e.crd === "305314" && e.names.some((n) => /FUND 3, L\.P\./.test(n)))
  if (fund3) {
    console.log(`\nSafe Harbor Fund 3 (${fund3[0]}):`)
    const series = yearlySeries(fund3[1].points, null)
    for (const p of series) console.log(`  ${p.year} ${p.filedOn} ${p.basis.padEnd(7)} gross ${p.grossAssetValue} owners ${p.owners} audit ${p.annualAudit} distributed ${p.statementsDistributed} opinion ${p.opinion}`)
    for (const n of seriesNotes(series)) console.log(`  note: ${n.text}`)
  }

  writeFileSync(OUT, JSON.stringify(out))
  console.log(`\nwrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB, ${Object.keys(funds).length} funds, ${filings.size} filings)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
