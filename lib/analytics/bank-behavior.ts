import { computeCreLoans } from "@/lib/fdic-cre"
import { formatQuarter, normalizeQuarter } from "@/lib/scoring/quarter"

/**
 * Bank behaviour: the Call Report items that show what a bank is *doing* about
 * its CRE book, as distinct from the condition items the rest of the tab
 * scores. This module is the ingestion layer only — it shapes raw BankFind
 * rows into typed quarters and derives the handful of values the Call Report
 * does not report directly. Signals, scores and the drawer panel are built on
 * top of it, not in it.
 *
 * Two rules govern everything here:
 *  - every value traces to a named BankFind field (`BEHAVIOR_FIELD_CATALOG`),
 *    and anything computed rather than reported is marked `derived`;
 *  - null means "not reported", never zero. A bank that files no RC-N figure
 *    for multifamily is not a bank with no late multifamily loans.
 *
 * Dollar figures are in thousands, as FDIC reports them.
 */

/** Nine quarters, matching the screening window; eight comparisons. */
export const BEHAVIOR_QUARTERS = 9

export type FieldBasis = "balance" | "ytd" | "quarter"
export type FieldKind = "reported" | "derived"

export type BehaviorQuarter = {
  /** `YYYYMMDD`. */
  quarter: string
  /** `Q2 2026`. */
  label: string
  totalAssets: number | null
  grossLoans: number | null

  // Schedule RC-C — CRE balances, the denominators for the category rates
  constructionLoans: number | null
  multifamilyLoans: number | null
  nonfarmNonresLoans: number | null
  nonfarmOwnerLoans: number | null
  nonfarmNonOwnerLoans: number | null
  /** Derived: the tab's CRE definition (`computeCreLoans`): construction + multifamily + non-owner-occupied nonfarm. */
  creLoans: number | null

  // Schedule RC line 4.a — loans and leases held for sale
  heldForSale: number | null
  heldForSaleNonaccrual: number | null
  heldForSalePastDue30: number | null
  heldForSalePastDue90: number | null

  // Schedule RI line 5.i — net gains (losses) on sales of loans
  loanSaleGainYtd: number | null
  loanSaleGainQ: number | null

  // Schedule RI-B Part I — charge-offs (col A) and recoveries (col B), year-to-date
  chargeOffsConstructionYtd: number | null
  recoveriesConstructionYtd: number | null
  netChargeOffsConstructionYtd: number | null
  netChargeOffsConstructionQ: number | null
  chargeOffsMultifamilyYtd: number | null
  recoveriesMultifamilyYtd: number | null
  netChargeOffsMultifamilyYtd: number | null
  netChargeOffsMultifamilyQ: number | null
  chargeOffsNonfarmNonresYtd: number | null
  recoveriesNonfarmNonresYtd: number | null
  netChargeOffsNonfarmNonresYtd: number | null
  netChargeOffsNonfarmNonresQ: number | null
  chargeOffsNonfarmNonOwnerYtd: number | null
  recoveriesNonfarmNonOwnerYtd: number | null
  netChargeOffsNonfarmNonOwnerYtd: number | null
  /** Derived: nonfarm nonresidential less its non-owner-occupied half. */
  netChargeOffsNonfarmOwnerYtd: number | null
  /** Derived by differencing year-to-date figures within a calendar year. */
  chargeOffsConstructionQ: number | null
  recoveriesConstructionQ: number | null
  chargeOffsMultifamilyQ: number | null
  recoveriesMultifamilyQ: number | null
  chargeOffsNonfarmNonresQ: number | null
  recoveriesNonfarmNonresQ: number | null
  chargeOffsNonfarmNonOwnerQ: number | null
  recoveriesNonfarmNonOwnerQ: number | null
  /** Derived: the sum of the four category charge-offs for the quarter. */
  chargeOffsCreQ: number | null

  // Schedule RC-M item 3 — other real estate owned
  oreoTotal: number | null
  oreoConstruction: number | null
  oreoMultifamily: number | null
  oreoNonfarmNonres: number | null
  oreoResidential: number | null
  oreoFarmland: number | null
  /** Derived: construction + multifamily + nonfarm nonresidential. */
  oreoCre: number | null

  // Schedule RC-N — past due and nonaccrual, by CRE category
  pastDue30Construction: number | null
  pastDue90Construction: number | null
  nonaccrualConstruction: number | null
  pastDue30Multifamily: number | null
  pastDue90Multifamily: number | null
  nonaccrualMultifamily: number | null
  pastDue30NonfarmNonres: number | null
  pastDue90NonfarmNonres: number | null
  nonaccrualNonfarmNonres: number | null
  pastDue30NonfarmNonOwner: number | null
  pastDue90NonfarmNonOwner: number | null
  nonaccrualNonfarmNonOwner: number | null
  /** Derived: nonfarm nonresidential less its non-owner-occupied half. */
  nonaccrualNonfarmOwner: number | null
  /** Derived: construction + multifamily + nonfarm nonresidential. */
  nonaccrualCre: number | null
  pastDue30Cre: number | null
  pastDue90Cre: number | null

  // Schedule RC-C Part I Memorandum 1 / RC-N Memorandum 1 — modifications to
  // borrowers experiencing financial difficulty
  modificationsTotal: number | null
  modificationsConstruction: number | null
  modificationsMultifamily: number | null
  modificationsNonfarmNonres: number | null
  modificationsCi: number | null
  modificationsResidential: number | null
  modificationsOther: number | null
  modificationsPastDue30: number | null
  modificationsPastDue90: number | null
  modificationsNonaccrual: number | null
  /** Derived: construction + multifamily + nonfarm nonresidential. */
  modificationsCre: number | null

  // Schedule RC-S
  servicedForOthers: number | null
}

export type BehaviorFieldSpec = {
  key: keyof BehaviorQuarter
  label: string
  /** The BankFind field, or the formula when `kind` is `derived`. */
  source: string
  /** Call Report schedule and line. */
  schedule: string
  basis: FieldBasis
  kind: FieldKind
}

type ReportedSpec = BehaviorFieldSpec & { kind: "reported" }

const reported = (
  key: keyof BehaviorQuarter,
  source: string,
  label: string,
  schedule: string,
  basis: FieldBasis
): ReportedSpec => ({ key, source, label, schedule, basis, kind: "reported" })

const derived = (
  key: keyof BehaviorQuarter,
  source: string,
  label: string,
  schedule: string,
  basis: FieldBasis
): BehaviorFieldSpec => ({ key, source, label, schedule, basis, kind: "derived" })

/**
 * Where every number comes from. Reported entries name the BankFind field;
 * derived entries give the formula in terms of other keys. This is the table
 * the drawer's "source" tooltips and the verify script read, so it is the
 * single place a field's provenance is written down.
 */
export const BEHAVIOR_FIELD_CATALOG: readonly BehaviorFieldSpec[] = [
  reported("totalAssets", "ASSET", "Total assets", "RC 12", "balance"),
  reported("grossLoans", "LNLSGR", "Gross loans and leases", "RC-C", "balance"),
  reported("constructionLoans", "LNRECONS", "Construction & land development loans", "RC-C 1.a", "balance"),
  reported("multifamilyLoans", "LNREMULT", "Multifamily loans", "RC-C 1.d", "balance"),
  reported("nonfarmNonresLoans", "LNRENRES", "Nonfarm nonresidential loans", "RC-C 1.e", "balance"),
  reported("nonfarmOwnerLoans", "LNRENROW", "Owner-occupied nonfarm nonresidential loans", "RC-C 1.e.(1)", "balance"),
  reported("nonfarmNonOwnerLoans", "LNRENROT", "Non-owner-occupied nonfarm nonresidential loans", "RC-C 1.e.(2)", "balance"),
  derived("creLoans", "computeCreLoans: constructionLoans + multifamilyLoans + nonfarmNonOwnerLoans (nonfarmNonresLoans when the split does not reconcile)", "CRE loans, tab definition", "RC-C 1.a + 1.d + 1.e.(2)", "balance"),

  reported("heldForSale", "LNLSSALE", "Loans held for sale", "RC 4.a (RCON5369)", "balance"),
  reported("heldForSaleNonaccrual", "NALNSALE", "Held for sale, nonaccrual", "RC-N 11 col C", "balance"),
  reported("heldForSalePastDue30", "P3LNSALE", "Held for sale, 30-89 days past due", "RC-N 11 col A", "balance"),
  reported("heldForSalePastDue90", "P9LNSALE", "Held for sale, 90+ days past due", "RC-N 11 col B", "balance"),

  reported("loanSaleGainYtd", "NETGNSLN", "Net gains (losses) on loan sales, YTD", "RI 5.i (RIAD5416)", "ytd"),
  reported("loanSaleGainQ", "NTGLLNQ", "Net gains (losses) on loan sales, quarter", "RI 5.i, quarter", "quarter"),

  reported("chargeOffsConstructionYtd", "DRRECONS", "Charge-offs, construction, YTD", "RI-B I 1.a col A", "ytd"),
  reported("recoveriesConstructionYtd", "CRRECONS", "Recoveries, construction, YTD", "RI-B I 1.a col B", "ytd"),
  reported("netChargeOffsConstructionYtd", "NTRECONS", "Net charge-offs, construction, YTD", "RI-B I 1.a", "ytd"),
  reported("netChargeOffsConstructionQ", "NTRECONQ", "Net charge-offs, construction, quarter", "RI-B I 1.a, quarter", "quarter"),
  reported("chargeOffsMultifamilyYtd", "DRREMULT", "Charge-offs, multifamily, YTD", "RI-B I 1.d col A", "ytd"),
  reported("recoveriesMultifamilyYtd", "CRREMULT", "Recoveries, multifamily, YTD", "RI-B I 1.d col B", "ytd"),
  reported("netChargeOffsMultifamilyYtd", "NTREMULT", "Net charge-offs, multifamily, YTD", "RI-B I 1.d", "ytd"),
  reported("netChargeOffsMultifamilyQ", "NTREMULQ", "Net charge-offs, multifamily, quarter", "RI-B I 1.d, quarter", "quarter"),
  reported("chargeOffsNonfarmNonresYtd", "DRRENRES", "Charge-offs, nonfarm nonresidential, YTD", "RI-B I 1.e col A", "ytd"),
  reported("recoveriesNonfarmNonresYtd", "CRRENRES", "Recoveries, nonfarm nonresidential, YTD", "RI-B I 1.e col B", "ytd"),
  reported("netChargeOffsNonfarmNonresYtd", "NTRENRES", "Net charge-offs, nonfarm nonresidential, YTD", "RI-B I 1.e", "ytd"),
  reported("netChargeOffsNonfarmNonresQ", "NTRENRSQ", "Net charge-offs, nonfarm nonresidential, quarter", "RI-B I 1.e, quarter", "quarter"),
  reported("chargeOffsNonfarmNonOwnerYtd", "DRRENROT", "Charge-offs, non-owner-occupied nonfarm, YTD", "RI-B I 1.e.(2) col A", "ytd"),
  reported("recoveriesNonfarmNonOwnerYtd", "CRRENROT", "Recoveries, non-owner-occupied nonfarm, YTD", "RI-B I 1.e.(2) col B", "ytd"),
  reported("netChargeOffsNonfarmNonOwnerYtd", "NTRENROT", "Net charge-offs, non-owner-occupied nonfarm, YTD", "RI-B I 1.e.(2)", "ytd"),
  derived("netChargeOffsNonfarmOwnerYtd", "netChargeOffsNonfarmNonresYtd - netChargeOffsNonfarmNonOwnerYtd", "Net charge-offs, owner-occupied nonfarm, YTD", "RI-B I 1.e.(1)", "ytd"),
  derived("chargeOffsConstructionQ", "YTD less prior quarter's YTD, same year", "Charge-offs, construction, quarter", "RI-B I 1.a col A", "quarter"),
  derived("recoveriesConstructionQ", "YTD less prior quarter's YTD, same year", "Recoveries, construction, quarter", "RI-B I 1.a col B", "quarter"),
  derived("chargeOffsMultifamilyQ", "YTD less prior quarter's YTD, same year", "Charge-offs, multifamily, quarter", "RI-B I 1.d col A", "quarter"),
  derived("recoveriesMultifamilyQ", "YTD less prior quarter's YTD, same year", "Recoveries, multifamily, quarter", "RI-B I 1.d col B", "quarter"),
  derived("chargeOffsNonfarmNonresQ", "YTD less prior quarter's YTD, same year", "Charge-offs, nonfarm nonresidential, quarter", "RI-B I 1.e col A", "quarter"),
  derived("recoveriesNonfarmNonresQ", "YTD less prior quarter's YTD, same year", "Recoveries, nonfarm nonresidential, quarter", "RI-B I 1.e col B", "quarter"),
  derived("chargeOffsNonfarmNonOwnerQ", "YTD less prior quarter's YTD, same year", "Charge-offs, non-owner-occupied nonfarm, quarter", "RI-B I 1.e.(2) col A", "quarter"),
  derived("recoveriesNonfarmNonOwnerQ", "YTD less prior quarter's YTD, same year", "Recoveries, non-owner-occupied nonfarm, quarter", "RI-B I 1.e.(2) col B", "quarter"),
  derived("chargeOffsCreQ", "chargeOffsConstructionQ + chargeOffsMultifamilyQ + chargeOffsNonfarmNonresQ", "Charge-offs, all CRE, quarter", "RI-B I 1.a + 1.d + 1.e", "quarter"),

  reported("oreoTotal", "ORE", "Other real estate owned", "RC-M 3 (RCON2150)", "balance"),
  reported("oreoConstruction", "ORECONS", "OREO, construction & land", "RC-M 3.a", "balance"),
  reported("oreoResidential", "ORERES", "OREO, 1-4 family", "RC-M 3.b", "balance"),
  reported("oreoMultifamily", "OREMULT", "OREO, multifamily", "RC-M 3.c", "balance"),
  reported("oreoNonfarmNonres", "ORENRES", "OREO, nonfarm nonresidential", "RC-M 3.d", "balance"),
  reported("oreoFarmland", "OREAG", "OREO, farmland", "RC-M 3.e", "balance"),
  derived("oreoCre", "oreoConstruction + oreoMultifamily + oreoNonfarmNonres", "OREO, all CRE", "RC-M 3.a + 3.c + 3.d", "balance"),

  reported("pastDue30Construction", "P3RECONS", "Construction, 30-89 days past due", "RC-N 1.a col A", "balance"),
  reported("pastDue90Construction", "P9RECONS", "Construction, 90+ days past due", "RC-N 1.a col B", "balance"),
  reported("nonaccrualConstruction", "NARECONS", "Construction, nonaccrual", "RC-N 1.a col C", "balance"),
  reported("pastDue30Multifamily", "P3REMULT", "Multifamily, 30-89 days past due", "RC-N 1.d col A", "balance"),
  reported("pastDue90Multifamily", "P9REMULT", "Multifamily, 90+ days past due", "RC-N 1.d col B", "balance"),
  reported("nonaccrualMultifamily", "NAREMULT", "Multifamily, nonaccrual", "RC-N 1.d col C", "balance"),
  reported("pastDue30NonfarmNonres", "P3RENRES", "Nonfarm nonresidential, 30-89 days past due", "RC-N 1.e col A", "balance"),
  reported("pastDue90NonfarmNonres", "P9RENRES", "Nonfarm nonresidential, 90+ days past due", "RC-N 1.e col B", "balance"),
  reported("nonaccrualNonfarmNonres", "NARENRES", "Nonfarm nonresidential, nonaccrual", "RC-N 1.e col C", "balance"),
  reported("pastDue30NonfarmNonOwner", "P3RENROT", "Non-owner-occupied nonfarm, 30-89 days past due", "RC-N 1.e.(2) col A", "balance"),
  reported("pastDue90NonfarmNonOwner", "P9RENROT", "Non-owner-occupied nonfarm, 90+ days past due", "RC-N 1.e.(2) col B", "balance"),
  reported("nonaccrualNonfarmNonOwner", "NARENROT", "Non-owner-occupied nonfarm, nonaccrual", "RC-N 1.e.(2) col C", "balance"),
  derived("nonaccrualNonfarmOwner", "nonaccrualNonfarmNonres - nonaccrualNonfarmNonOwner", "Owner-occupied nonfarm, nonaccrual", "RC-N 1.e.(1) col C", "balance"),
  derived("nonaccrualCre", "nonaccrualConstruction + nonaccrualMultifamily + nonaccrualNonfarmNonres", "All CRE, nonaccrual", "RC-N 1.a + 1.d + 1.e col C", "balance"),
  derived("pastDue30Cre", "pastDue30Construction + pastDue30Multifamily + pastDue30NonfarmNonres", "All CRE, 30-89 days past due", "RC-N 1.a + 1.d + 1.e col A", "balance"),
  derived("pastDue90Cre", "pastDue90Construction + pastDue90Multifamily + pastDue90NonfarmNonres", "All CRE, 90+ days past due", "RC-N 1.a + 1.d + 1.e col B", "balance"),

  reported("modificationsTotal", "RSLNLTOT", "Modified loans, total", "RC-C I M.1", "balance"),
  reported("modificationsConstruction", "RSCONS", "Modified loans, construction", "RC-C I M.1.a", "balance"),
  reported("modificationsResidential", "RSLNREFM", "Modified loans, 1-4 family", "RC-C I M.1.c", "balance"),
  reported("modificationsMultifamily", "RSMULT", "Modified loans, multifamily", "RC-C I M.1.d", "balance"),
  reported("modificationsNonfarmNonres", "RSNRES", "Modified loans, nonfarm nonresidential", "RC-C I M.1.e", "balance"),
  reported("modificationsCi", "RSCI", "Modified loans, commercial & industrial", "RC-C I M.1.f", "balance"),
  reported("modificationsOther", "RSOTHER", "Modified loans, all other", "RC-C I M.1.g", "balance"),
  reported("modificationsPastDue30", "P3RSLNLT", "Modified loans, 30-89 days past due", "RC-N M.1 col A (RCONHK26)", "balance"),
  reported("modificationsPastDue90", "P9RSLNLT", "Modified loans, 90+ days past due", "RC-N M.1 col B (RCONHK27)", "balance"),
  reported("modificationsNonaccrual", "NARSLNLT", "Modified loans, nonaccrual", "RC-N M.1 col C (RCONHK28)", "balance"),
  derived("modificationsCre", "modificationsConstruction + modificationsMultifamily + modificationsNonfarmNonres", "Modified loans, all CRE", "RC-C I M.1.a + 1.d + 1.e", "balance"),

  reported("servicedForOthers", "LNSERV", "Loans serviced for others", "RC-S M.2", "balance"),
]

/** The BankFind fields the catalogue reads, for building the request. */
export const BEHAVIOR_SOURCE_FIELDS: readonly string[] = BEHAVIOR_FIELD_CATALOG.filter(
  (s): s is ReportedSpec => s.kind === "reported"
).map((s) => s.source)

export type BehaviorHistory = {
  cert: string
  name: string
  state: string | null
  /** Oldest first, at most `BEHAVIOR_QUARTERS`, one per report date. */
  quarters: BehaviorQuarter[]
}

/** A reported number or null; never coerces a missing value to zero. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Sum that is null if any term is null, so a missing category is not read as zero. */
function sum(...terms: (number | null)[]): number | null {
  let total = 0
  for (const t of terms) {
    if (t === null) return null
    total += t
  }
  return total
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b
}

/** One raw BankFind `/financials` row to a typed quarter. Within-quarter derivations only. */
export function toBehaviorQuarter(raw: Record<string, unknown>): BehaviorQuarter {
  const quarter = normalizeQuarter(String(raw.REPDTE ?? ""))
  const q = { quarter, label: formatQuarter(quarter) } as BehaviorQuarter
  for (const spec of BEHAVIOR_FIELD_CATALOG) {
    if (spec.kind === "reported") (q as Record<string, unknown>)[spec.key] = num(raw[spec.source])
    else (q as Record<string, unknown>)[spec.key] = null
  }
  q.creLoans =
    q.constructionLoans === null || q.multifamilyLoans === null || q.nonfarmNonresLoans === null
      ? null
      : computeCreLoans({
          constructionLoans: q.constructionLoans,
          multifamilyLoans: q.multifamilyLoans,
          nonResidentialLoans: q.nonfarmNonresLoans,
          ownerOccupiedLoans: q.nonfarmOwnerLoans ?? 0,
          nonOwnerOccupiedLoans: q.nonfarmNonOwnerLoans ?? 0,
        })
  q.netChargeOffsNonfarmOwnerYtd = diff(q.netChargeOffsNonfarmNonresYtd, q.netChargeOffsNonfarmNonOwnerYtd)
  q.oreoCre = sum(q.oreoConstruction, q.oreoMultifamily, q.oreoNonfarmNonres)
  q.nonaccrualNonfarmOwner = diff(q.nonaccrualNonfarmNonres, q.nonaccrualNonfarmNonOwner)
  q.nonaccrualCre = sum(q.nonaccrualConstruction, q.nonaccrualMultifamily, q.nonaccrualNonfarmNonres)
  q.pastDue30Cre = sum(q.pastDue30Construction, q.pastDue30Multifamily, q.pastDue30NonfarmNonres)
  q.pastDue90Cre = sum(q.pastDue90Construction, q.pastDue90Multifamily, q.pastDue90NonfarmNonres)
  q.modificationsCre = sum(q.modificationsConstruction, q.modificationsMultifamily, q.modificationsNonfarmNonres)
  return q
}

const YTD_TO_QUARTER: readonly [ytd: keyof BehaviorQuarter, quarter: keyof BehaviorQuarter][] = [
  ["chargeOffsConstructionYtd", "chargeOffsConstructionQ"],
  ["recoveriesConstructionYtd", "recoveriesConstructionQ"],
  ["chargeOffsMultifamilyYtd", "chargeOffsMultifamilyQ"],
  ["recoveriesMultifamilyYtd", "recoveriesMultifamilyQ"],
  ["chargeOffsNonfarmNonresYtd", "chargeOffsNonfarmNonresQ"],
  ["recoveriesNonfarmNonresYtd", "recoveriesNonfarmNonresQ"],
  ["chargeOffsNonfarmNonOwnerYtd", "chargeOffsNonfarmNonOwnerQ"],
  ["recoveriesNonfarmNonOwnerYtd", "recoveriesNonfarmNonOwnerQ"],
]

function isFirstQuarter(quarter: string): boolean {
  return quarter.slice(4, 6) === "03"
}

/** The quarter end immediately before `quarter`, as `YYYYMMDD`. */
export function previousQuarterEnd(quarter: string): string {
  const year = Number(quarter.slice(0, 4))
  const month = Number(quarter.slice(4, 6))
  if (month === 3) return `${year - 1}1231`
  if (month === 6) return `${year}0331`
  if (month === 9) return `${year}0630`
  return `${year}0930`
}

/** The `count` quarter ends up to and including `latest`, oldest first. */
export function quarterEnds(latest: string, count: number): string[] {
  const out: string[] = []
  let q = normalizeQuarter(latest)
  for (let i = 0; i < count && /^\d{8}$/.test(q); i++) {
    out.unshift(q)
    q = previousQuarterEnd(q)
  }
  return out
}

/**
 * Schedule RI-B is year-to-date. The quarter's own gross charge-offs and
 * recoveries are the YTD figure in Q1 and the difference from the prior
 * quarter's YTD otherwise — but only when that prior quarter is actually in
 * the history. A gap leaves the quarter null rather than guessing.
 */
export function withQuarterlyFlows(quarters: BehaviorQuarter[]): BehaviorQuarter[] {
  const byQuarter = new Map(quarters.map((q) => [q.quarter, q]))
  return quarters.map((q) => {
    const prior = isFirstQuarter(q.quarter) ? null : byQuarter.get(previousQuarterEnd(q.quarter))
    const out = { ...q }
    for (const [ytdKey, qKey] of YTD_TO_QUARTER) {
      const ytd = q[ytdKey] as number | null
      let value: number | null
      if (isFirstQuarter(q.quarter)) value = ytd
      else if (prior) value = diff(ytd, prior[ytdKey] as number | null)
      else value = null
      ;(out as Record<string, unknown>)[qKey] = value
    }
    out.chargeOffsCreQ = sum(out.chargeOffsConstructionQ, out.chargeOffsMultifamilyQ, out.chargeOffsNonfarmNonresQ)
    return out
  })
}

/**
 * Raw rows for one CERT (any order, duplicates allowed) to an oldest-first
 * history of the newest `BEHAVIOR_QUARTERS`, with the quarterly flows derived.
 * Name and state come from the newest row.
 */
export function buildBehaviorHistory(cert: string, rows: Record<string, unknown>[]): BehaviorHistory {
  const byQuarter = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const q = normalizeQuarter(String(row.REPDTE ?? ""))
    if (/^\d{8}$/.test(q) && !byQuarter.has(q)) byQuarter.set(q, row)
  }
  const ordered = [...byQuarter.keys()].sort().slice(-BEHAVIOR_QUARTERS)
  const newest = ordered.length ? byQuarter.get(ordered[ordered.length - 1]) : undefined
  return {
    cert,
    name: String(newest?.NAME ?? ""),
    state: newest?.STNAME ? String(newest.STNAME) : null,
    quarters: withQuarterlyFlows(ordered.map((q) => toBehaviorQuarter(byQuarter.get(q)!))),
  }
}

/**
 * Many institutions' rows (as the cohort pull returns them, one request per
 * quarter) grouped into histories keyed by CERT.
 */
export function groupBehaviorHistories(rows: Record<string, unknown>[]): BehaviorHistory[] {
  const byCert = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const cert = String(row.CERT ?? "")
    if (!cert) continue
    const list = byCert.get(cert)
    if (list) list.push(row)
    else byCert.set(cert, [row])
  }
  return [...byCert.entries()].map(([cert, list]) => buildBehaviorHistory(cert, list))
}
