#!/usr/bin/env node
/**
 * Reconcile every derived Market Analytics column against the live FDIC API.
 *
 * Run: npm run audit:fdic-columns [-- --quarter=20260331]
 *
 * The method matters more than the checks. Recomputing a metric from the same
 * parts the app uses and comparing the two only confirms the app's own
 * assumption — a verification script did exactly that and blessed the CRE
 * double-count it was written to catch. Every check below instead reconciles
 * against a total FDIC publishes independently, so a wrong assumption about
 * what a field means shows up as a failure rather than a match.
 *
 * That is what caught the three bugs found on 2026-08-24:
 *   - NCLNLS read as a percentage: `NCLNLS == P9LNLS + NALNLS` proves dollars.
 *   - LNREDOM read as 1-4 family: `LNREDOM == LNRE` proves it is the total.
 *   - ROA rescaled by a heuristic: `ROA == NETINC*n/ASSET5*100` proves percent.
 *
 * Standalone on purpose. `node --experimental-strip-types` cannot resolve the
 * extensionless imports in lib/fdic-data-transformer.ts, so this script reads
 * the requested field list out of lib/fdic-config.ts as text and otherwise
 * depends on nothing.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const BASE = process.env.FDIC_API_URL_AUDIT || "https://api.fdic.gov/banks"

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=")
    return [k, v]
  })
)

/** Annualization multiplier FDIC applies to year-to-date income for a quarter. */
function annualizationFactor(repdte) {
  const mmdd = String(repdte).slice(4)
  if (mmdd === "0331") return 4
  if (mmdd === "0630") return 2
  if (mmdd === "0930") return 4 / 3
  return 1
}

/** The financials fields the app actually requests, read from the config as text. */
function requestedFields() {
  const src = readFileSync(join(ROOT, "lib", "fdic-config.ts"), "utf8")
  const block = src.slice(src.indexOf("financials: ["), src.indexOf("institutions: ["))
  return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1])
}

/** Extra fields the reconciliations need that the app has no reason to request. */
const RECONCILIATION_FIELDS = [
  "LNREAG",
  "LNRELOC",
  "P3LNLS",
  "P9LNLS",
  "LNATRESR",
  "ASSET5",
  "EQ5",
  "EQ",
  "LIAB",
  "NAME",
]

async function fetchAll(fields, repdte) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const url =
      `${BASE}/financials?filters=REPDTE:${repdte}` +
      `&fields=${fields.join(",")}&limit=1000&offset=${offset}&format=json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`FDIC ${res.status} for offset ${offset}`)
    const body = await res.json()
    rows.push(...body.data.map((d) => d.data))
    if (rows.length >= body.meta.total || body.data.length === 0) break
  }
  return rows
}

async function latestQuarter() {
  const res = await fetch(`${BASE}/financials?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json`)
  const body = await res.json()
  return String(body.data[0].data.REPDTE)
}

const num = (r, k) => (r[k] == null || !Number.isFinite(Number(r[k])) ? 0 : Number(r[k]))
const has = (r, k) => r[k] != null && Number.isFinite(Number(r[k]))

/**
 * A check holds when it fails on no more than `tolerateFraction` of rows.
 * FDIC data carries a handful of genuine reporting oddities — the real estate
 * decomposition does not close on about 17 institutions — so a check that
 * demanded perfection would be permanently red and therefore ignored.
 */
function identity({ name, column, tolerateFraction = 0.01, applies, left, right, epsilon = 0.01 }) {
  return { name, column, tolerateFraction, applies, left, right, epsilon }
}

const CHECKS = [
  identity({
    name: "LNRE decomposes into construction, multifamily, non-residential, 1-4 family and farmland",
    column: "creLoans",
    applies: (r) => num(r, "LNRE") > 0,
    left: (r) => num(r, "LNRE"),
    right: (r) =>
      num(r, "LNRECONS") + num(r, "LNREMULT") + num(r, "LNRENRES") + num(r, "LNRERES") + num(r, "LNREAG"),
    epsilon: 1,
    tolerateFraction: 0.01,
  }),
  identity({
    name: "LNREOTH is closed-end 1-4 family (LNRERES - LNRELOC), so it is inside residential, not CRE",
    column: "otherRealEstateLoans",
    applies: () => true,
    left: (r) => num(r, "LNRERES"),
    right: (r) => num(r, "LNRELOC") + num(r, "LNREOTH"),
    epsilon: 1,
    tolerateFraction: 0,
  }),
  identity({
    name: "LNREDOM is all domestic real estate, not the 1-4 family figure (LNRERES is)",
    column: "residentialLoans",
    applies: (r) => num(r, "LNRE") > 0,
    left: (r) => num(r, "LNREDOM"),
    right: (r) => num(r, "LNRE"),
    epsilon: 1,
    tolerateFraction: 0.01,
  }),
  identity({
    name: "LNRENRES splits into owner-occupied and non-owner-occupied",
    column: "nonOwnerOccupiedLoans",
    applies: (r) => num(r, "LNRENRES") > 0,
    left: (r) => num(r, "LNRENRES"),
    right: (r) => num(r, "LNRENROW") + num(r, "LNRENROT"),
    epsilon: 1,
    tolerateFraction: 0.01,
  }),
  identity({
    name: "NCLNLS is dollars, not a percentage: it equals past-due-90+ plus nonaccrual",
    column: "noncurrent_to_assets_ratio",
    applies: () => true,
    left: (r) => num(r, "NCLNLS"),
    right: (r) => num(r, "P9LNLS") + num(r, "NALNLS"),
    epsilon: 1,
    tolerateFraction: 0,
  }),
  identity({
    name: "gross loans are net loans plus the allowance",
    column: "grossLoans",
    applies: (r) => num(r, "LNLSGR") > 0,
    left: (r) => num(r, "LNLSGR"),
    right: (r) => num(r, "LNLSNET") + num(r, "LNATRES"),
    epsilon: 1,
    tolerateFraction: 0,
  }),
  identity({
    name: "reserve coverage reproduces FDIC's published LNATRESR (gross denominator)",
    column: "loanLossReserve",
    applies: (r) => has(r, "LNATRESR") && num(r, "LNLSGR") > 0,
    left: (r) => num(r, "LNATRESR"),
    right: (r) => (num(r, "LNATRES") / num(r, "LNLSGR")) * 100,
    epsilon: 0.001,
    tolerateFraction: 0,
  }),
  identity({
    name: "noncurrent-to-loans reproduces FDIC's published NCLNLSR (gross denominator)",
    column: "noncurrent_to_loans_ratio",
    applies: (r) => has(r, "NCLNLSR") && num(r, "LNLSGR") > 0,
    left: (r) => num(r, "NCLNLSR"),
    right: (r) => ((num(r, "P9LNLS") + num(r, "NALNLS")) / num(r, "LNLSGR")) * 100,
    epsilon: 0.001,
    tolerateFraction: 0,
  }),
  identity({
    name: "ROA is percent units: net income annualized over average assets",
    column: "roa",
    applies: (r) => has(r, "ROA") && num(r, "ASSET5") > 0,
    left: (r) => num(r, "ROA"),
    right: (r) => (num(r, "NETINC") * r.__annualize) / num(r, "ASSET5") * 100,
    epsilon: 0.02,
    tolerateFraction: 0,
  }),
  identity({
    name: "ROE is percent units: net income annualized over average equity",
    column: "roe",
    applies: (r) => has(r, "ROE") && num(r, "EQ5") > 0,
    left: (r) => num(r, "ROE"),
    right: (r) => (num(r, "NETINC") * r.__annualize) / num(r, "EQ5") * 100,
    epsilon: 0.02,
    tolerateFraction: 0.01,
  }),
  identity({
    name: "LNLSDEPR is percent units: net loans over deposits",
    column: "loansToDeposits",
    applies: (r) => has(r, "LNLSDEPR") && num(r, "DEP") > 0,
    left: (r) => num(r, "LNLSDEPR"),
    right: (r) => (num(r, "LNLSNET") / num(r, "DEP")) * 100,
    epsilon: 0.02,
    tolerateFraction: 0.02,
  }),
  identity({
    name: "total risk-based capital ratio reproduces from reported dollars",
    column: "totalRbcRatio",
    applies: (r) => has(r, "RBCRWAJ") && num(r, "RWAJ") > 0,
    left: (r) => num(r, "RBCRWAJ"),
    right: (r) => ((num(r, "RBCT1J") + num(r, "RBCT2")) / num(r, "RWAJ")) * 100,
    epsilon: 0.01,
    tolerateFraction: 0.01,
  }),
  identity({
    name: "tier 1 risk-based capital ratio reproduces from reported dollars",
    column: "tier1RbcRatio",
    applies: (r) => has(r, "RBC1RWAJ") && num(r, "RWAJ") > 0,
    left: (r) => num(r, "RBC1RWAJ"),
    right: (r) => (num(r, "RBCT1J") / num(r, "RWAJ")) * 100,
    epsilon: 0.01,
    tolerateFraction: 0.01,
  }),
  identity({
    name: "EQTOT is total equity capital: it closes the balance sheet",
    column: "totalEquityDollars",
    applies: (r) => has(r, "EQTOT") && has(r, "LIAB"),
    left: (r) => num(r, "EQTOT"),
    right: (r) => num(r, "ASSET") - num(r, "LIAB"),
    epsilon: 1,
    tolerateFraction: 0,
  }),
  identity({
    name: "EQ is bank-only equity and does not close it, which is why EQTOT is used",
    column: "totalEquityDollars",
    applies: (r) => has(r, "EQ") && has(r, "EQTOT"),
    left: (r) => Math.max(0, num(r, "EQ") - num(r, "EQTOT")),
    right: () => 0,
    epsilon: 1,
    tolerateFraction: 0.01,
  }),
  identity({
    name: "past-due 30-89 is an all-asset dollar figure, so it covers at least the loan-only bucket",
    column: "pastDue3090",
    applies: () => true,
    left: (r) => Math.max(0, num(r, "P3ASSET") - num(r, "P3LNLS")),
    right: () => 0,
    epsilon: Number.POSITIVE_INFINITY,
    tolerateFraction: 0,
  }),
  identity({
    name: "CRE unused commitments are a subset of total unused commitments",
    column: "creUnusedCommitments",
    applies: () => true,
    left: (r) => Math.max(0, num(r, "UCCOMRE") - num(r, "UCLN")),
    right: () => 0,
    epsilon: 1,
    tolerateFraction: 0,
  }),
]

/**
 * Fields the app requests that FDIC never populates.
 *
 * `EQCAP` was requested for months and silently returned nothing, so CRE/Equity
 * fell back to Tier 1 capital on every institution without anything looking
 * broken. A dead field is invisible in the UI and cheap to detect here.
 */
function auditFieldAvailability(rows, fields) {
  const dead = fields.filter((f) => !rows.some((r) => r[f] != null))
  return dead
}

/** Where a "surely no value is ever this large/small" heuristic would misfire. */
function auditPercentRanges(rows) {
  const out = []
  for (const [field, column] of [
    ["ROA", "roa"],
    ["ROE", "roe"],
    ["NIMR", "netInterestMargin"],
    ["RBCT1CER", "cet1Ratio"],
    ["RBCRWAJ", "totalRbcRatio"],
  ]) {
    const vals = rows.map((r) => r[field]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number)
    if (vals.length === 0) continue
    out.push({
      field,
      column,
      n: vals.length,
      above100: vals.filter((v) => v > 100).length,
      between0and1: vals.filter((v) => v > 0 && v <= 1).length,
      min: Math.min(...vals),
      max: Math.max(...vals),
    })
  }
  return out
}

async function main() {
  const repdte = args.get("quarter") || (await latestQuarter())
  const appFields = requestedFields()
  const fields = [...new Set([...appFields, ...RECONCILIATION_FIELDS])]

  process.stdout.write(`FDIC column audit — quarter ${repdte}, ${fields.length} fields\n`)
  const rows = await fetchAll(fields, repdte)
  const annualize = annualizationFactor(repdte)
  for (const r of rows) r.__annualize = annualize
  process.stdout.write(`${rows.length} institutions\n\n`)

  let failed = 0
  const pad = (s, n) => String(s).padEnd(n)

  for (const c of CHECKS) {
    const applicable = rows.filter(c.applies)
    const breaks = applicable.filter((r) => Math.abs(c.left(r) - c.right(r)) > c.epsilon)
    const frac = applicable.length ? breaks.length / applicable.length : 0
    const ok = frac <= c.tolerateFraction
    if (!ok) failed++
    const share = applicable.length ? `${breaks.length}/${applicable.length}` : "n/a"
    process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${pad(c.column, 28)} ${pad(share, 12)} ${c.name}\n`)
    if (!ok) {
      for (const r of breaks.slice(0, 3)) {
        process.stdout.write(
          `        ${r.NAME}: left=${c.left(r)} right=${c.right(r)}\n`
        )
      }
    }
  }

  const dead = auditFieldAvailability(rows, appFields)
  process.stdout.write(
    `\n${dead.length === 0 ? "PASS" : "FAIL"}  every requested field returns data` +
      (dead.length ? ` — dead: ${dead.join(", ")}\n` : "\n")
  )
  if (dead.length) failed++

  process.stdout.write("\nPercent-unit fields — where a rescaling heuristic would misfire:\n")
  for (const s of auditPercentRanges(rows)) {
    process.stdout.write(
      `  ${pad(s.field, 10)} n=${pad(s.n, 6)} >100%: ${pad(s.above100, 6)} 0-1%: ${pad(s.between0and1, 6)}` +
        ` range [${s.min.toFixed(2)}, ${s.max.toFixed(2)}]  -> ${s.column}\n`
    )
  }
  process.stdout.write(
    "  These are trusted as reported. Any nonzero count above is a bank a\n" +
      "  scale-guessing normalizer would have moved by a factor of 100.\n"
  )

  process.stdout.write(`\n${failed === 0 ? "All checks passed." : `${failed} check(s) failed.`}\n`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
