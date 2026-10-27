/**
 * Refresh the committed Form ADV extract from IAPD.
 *
 *   npm run refresh:peer-adv              # fetch, parse, write lib/peer-intel/adv-extract.json
 *   npm run refresh:peer-adv -- --dry     # fetch and parse, report, write nothing
 *   npm run refresh:peer-adv -- --crd 305314   # one adviser only (still writes, merging)
 *   npm run refresh:peer-adv -- --reuse   # parse the PDFs already downloaded
 *
 * Runs locally, never on Vercel: the PDFs run to 46 MB for Bridge and 35 MB
 * for H.I.G., and pdf.js needs the whole file. Each PDF is kept in
 * `$CLAUDE_SCRATCHPAD/adv-pdf/` (or `--pdf-dir`) so a parse can be re-run
 * without another download. IAPD is a public site, not a documented API:
 * requests are spaced 300 ms apart and carry the same User-Agent convention
 * as EDGAR calls.
 *
 * The report at the end is the check: funds reported versus parsed, funds
 * linked to registry vehicles versus not, every parser note, and any filing
 * that came back blank (Ares Management LLC's PDF is one empty page).
 */

import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
// This file is ESM because pdf.js is; the rest of `lib/` compiles as CommonJS
// under tsx, whose named exports an ESM import cannot see — hence the default
// imports and the destructuring below.
import registry from "../lib/peer-intel/registry"
import advParser from "../lib/peer-intel/adv"
import advLink from "../lib/peer-intel/adv-link"
import edgar from "../lib/peer-intel/edgar-contract"
import type { AdvExtract, AdvExtractEntry, VehicleKey } from "../lib/peer-intel/adv-link"
import { readAdvPdf } from "../lib/peer-intel/adv-pdf.mts"

const { PEERS } = registry
const { parseAdvFiling } = advParser
const { advisersToRead, managerAdv } = advLink
const { buildSubmissionsUrl } = edgar

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const DRY = args.includes("--dry")
/** Parse a PDF already in the directory instead of downloading it again. */
const REUSE = args.includes("--reuse")
const ONLY = flag("crd")
const PDF_DIR = flag("pdf-dir") ?? join(process.env.CLAUDE_SCRATCHPAD ?? "/tmp", "adv-pdf")
const OUT = join(process.cwd(), "lib", "peer-intel", "adv-extract.json")
const TODAY = new Date().toISOString().slice(0, 10)

const HEADERS = {
  "User-Agent": `MarketIntelligence/1.0 (${process.env.SEC_EDGAR_CONTACT?.trim() || "market-intelligence@safeharborcp.com"})`,
}

let last = 0
async function spaced(): Promise<void> {
  const wait = Math.max(0, 300 - (Date.now() - last))
  if (wait) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
}

async function download(crd: string): Promise<string> {
  mkdirSync(PDF_DIR, { recursive: true })
  const path = join(PDF_DIR, `${crd}.pdf`)
  if (REUSE && existsSync(path)) return path
  await spaced()
  const res = await fetch(`https://reports.adviserinfo.sec.gov/reports/ADV/${crd}/PDF/${crd}.pdf`, { headers: HEADERS })
  if (!res.ok) throw new Error(`IAPD ${res.status} for CRD ${crd}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF")) throw new Error(`CRD ${crd}: not a PDF (${bytes.length} bytes)`)
  writeFileSync(path, bytes)
  return path
}

/**
 * Each private vehicle's Form D file number from EDGAR's index — the key the
 * app links on, read here too so this report links the way the app will.
 * One request per vehicle; a failure leaves the vehicle to link by name.
 */
async function vehicleKeys(): Promise<Map<string, VehicleKey[]>> {
  const out = new Map<string, VehicleKey[]>()
  for (const peer of PEERS) {
    const keys: VehicleKey[] = []
    for (const v of peer.vehicles) {
      if (v.kind !== "private") continue
      let fileNumber: string | null = null
      try {
        await spaced()
        const res = await fetch(buildSubmissionsUrl(v.cik), { headers: HEADERS })
        if (res.ok) {
          const data = (await res.json()) as { filings?: { recent?: { form?: string[]; fileNumber?: string[] } } }
          const forms = data.filings?.recent?.form ?? []
          const numbers = data.filings?.recent?.fileNumber ?? []
          const i = forms.findIndex((f) => f === "D" || f === "D/A")
          fileNumber = i >= 0 ? numbers[i]?.trim() || null : null
        }
      } catch {
        fileNumber = null
      }
      keys.push({ cik: v.cik, name: v.name, fileNumber })
    }
    out.set(peer.id, keys)
  }
  return out
}

async function main() {
  const wanted = new Map<string, { name: string; for: string[] }>()
  for (const peer of PEERS) {
    for (const s of advisersToRead(peer)) {
      const w = wanted.get(s.crd) ?? { name: s.name, for: [] }
      w.for.push(`${peer.manager}${s.scope === "vehicle" ? ` · ${peer.vehicles.find((v) => v.cik === s.vehicleCik)?.name ?? s.vehicleCik}` : ""}`)
      wanted.set(s.crd, w)
    }
  }
  const crds = [...wanted.keys()].filter((c) => !ONLY || c === ONLY)
  console.log(`${crds.length} advisers to read${DRY ? " (dry run)" : ""}; PDFs in ${PDF_DIR}\n`)

  const previous: AdvExtract | null = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as AdvExtract) : null
  const advisers: Record<string, AdvExtractEntry> = { ...(previous?.advisers ?? {}) }
  const failures: string[] = []

  for (const crd of crds) {
    const w = wanted.get(crd)!
    const t = Date.now()
    try {
      const path = await download(crd)
      const bytes = statSync(path).size
      const pdf = await readAdvPdf(path)
      const filing = parseAdvFiling(crd, pdf.lines)
      advisers[crd] = { ...filing, fetchedOn: TODAY, pdfBytes: bytes, pages: pdf.pages }
      const gav = filing.funds.map((f) => f.grossAssetValue).filter((g): g is number => g != null).reduce((a, b) => a + b, 0)
      console.log(
        `  ${crd.padEnd(7)} ${w.name.slice(0, 40).padEnd(41)} ${(bytes / 1e6).toFixed(1).padStart(6)} MB ${String(pdf.pages).padStart(5)} pp  ${String(filing.funds.length).padStart(4)} funds${filing.fundsReported != null && filing.fundsReported !== filing.funds.length ? ` (header ${filing.fundsReported})` : ""}  GAV $${(gav / 1e9).toFixed(2)}B  ${filing.filingType ?? "?"} ${filing.filedOn ?? "?"}  ${((Date.now() - t) / 1000).toFixed(1)}s`
      )
      for (const n of filing.notes) console.log(`           note: ${n}`)
    } catch (e) {
      failures.push(`${crd} ${w.name}: ${(e as Error).message}`)
      console.log(`  ${crd.padEnd(7)} ${w.name.slice(0, 40).padEnd(41)} FAILED — ${(e as Error).message}`)
    }
  }

  const extract: AdvExtract = { refreshedOn: TODAY, advisers }
  console.log("\nReading each private vehicle's Form D file number from EDGAR…")
  const keys = await vehicleKeys()
  console.log("\nPer manager:")
  for (const peer of PEERS) {
    const vehicles = keys.get(peer.id) ?? []
    const adv = managerAdv(peer, extract, vehicles)
    if (!adv) {
      console.log(`  ${peer.manager.padEnd(32)} ${peer.noAdviser ? "no adviser on file" : peer.adviser ? "adviser not read" : "no adviser recorded"}`)
      continue
    }
    const byNumber = adv.linked.filter((f) => f.linkBasis === "file-number").length
    const linkedVehicles = new Set(adv.linked.map((f) => f.vehicleCik)).size
    const s = adv.summary
    console.log(
      `  ${peer.manager.padEnd(32)} ${String(s.funds).padStart(3)} funds on ADV; ${linkedVehicles}/${vehicles.length} tracked private vehicles linked (${adv.linked.length} records, ${byNumber} by file number); ${adv.others.length} not tracked; GAV ${s.grossAssetValue == null ? "—" : `$${(s.grossAssetValue / 1e9).toFixed(2)}B`} over ${s.grossAssetValueFunds} non-feeder funds`
    )
    for (const v of vehicles) {
      if (!adv.linked.some((f) => f.vehicleCik === v.cik)) console.log(`      unlinked vehicle: ${v.name} [${v.fileNumber ?? "no file number"}]`)
    }
  }
  if (failures.length) console.log(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`)

  if (!DRY) {
    writeFileSync(OUT, JSON.stringify(extract))
    console.log(`\nwrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB, ${Object.keys(advisers).length} advisers)`)
  }
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
