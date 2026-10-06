/**
 * What happened to a bank, from the FDIC's structure records.
 *
 * The Call Report says how a bank is doing; it does not say when the bank
 * stopped existing or who took it over. Two other BankFind endpoints do:
 *
 *  - `/history` — one row per structural event (merger, failure, charter
 *    change, name change, branch opening), with the acquirer on absorptions.
 *    Events in which a bank disappeared are filed under the *acquirer's* CERT,
 *    so they are found by `OUT_CERT`, not `CERT`.
 *  - `/failures` — one row per failure with the resolution type, the assuming
 *    institution, deposits and assets at failure, and the FDIC's estimated cost
 *    to the Deposit Insurance Fund.
 *
 * This module shapes raw rows from those endpoints into events the UI can list
 * and sentences it can print. It is import-free so the parsing is testable
 * against captured rows without a network.
 */

export type StructureEventKind = "failure" | "merger" | "closing" | "acquisition" | "other"

export type StructureEvent = {
  /** The bank the event happened to (the one that disappeared, for absorptions). */
  cert: string
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  kind: StructureEventKind
  /** FDIC change code, e.g. 211 failure, 223 merger without assistance. */
  code: number
  /** FDIC's own wording, e.g. "Merger -Without Assistance". */
  codeDescription: string
  /** The institution that absorbed the bank, where there was one. */
  acquirer?: { cert: string; name: string }
  /** The institution absorbed, on `acquisition` events seen from the acquirer's side. */
  absorbed?: { cert: string; name: string }
}

export type FailureRecord = {
  cert: string
  name: string
  /** ISO date. */
  failDate: string
  /** "FAILURE" or "ASSISTANCE". */
  resolutionType: string
  /** FDIC transaction code: PA/PI purchase & assumption, PO payout, etc. */
  transactionCode: string
  /** Plain-language reading of `transactionCode`. */
  transactionLabel: string
  acquirer?: { name: string; city?: string; state?: string }
  /** Dollars. */
  depositsAtFailure: number | null
  assetsAtFailure: number | null
  /** FDIC's estimated loss to the insurance fund, dollars; revised over time. */
  estimatedCost: number | null
  costAsOf?: string
}

/** Raw `/history` row, as the API returns it. Only the fields we read. */
export type RawHistoryRow = {
  CERT?: number | string
  EFFDATE?: string
  CHANGECODE?: number | string
  CHANGECODE_DESC?: string
  ACQ_CERT?: number | string
  ACQ_INSTNAME?: string
  OUT_CERT?: number | string
  OUT_INSTNAME?: string
}

/** Raw `/failures` row. Dollar fields are in thousands, as everywhere in BankFind. */
export type RawFailureRow = {
  CERT?: number | string
  NAME?: string
  FAILDATE?: string
  RESTYPE?: string
  RESTYPE1?: string
  BIDNAME?: string
  BIDCITY?: string
  BIDSTATE?: string
  QBFDEP?: number | string
  QBFASSET?: number | string
  COST?: number | string
  COSTMOSTRECENTASOF?: string
}

/** FDIC history field list for `/history` requests. */
export const HISTORY_FIELDS = [
  "CERT",
  "EFFDATE",
  "CHANGECODE",
  "CHANGECODE_DESC",
  "ACQ_CERT",
  "ACQ_INSTNAME",
  "OUT_CERT",
  "OUT_INSTNAME",
] as const

/** FDIC failures field list for `/failures` requests. */
export const FAILURE_FIELDS = [
  "CERT",
  "NAME",
  "FAILDATE",
  "RESTYPE",
  "RESTYPE1",
  "BIDNAME",
  "BIDCITY",
  "BIDSTATE",
  "QBFDEP",
  "QBFASSET",
  "COST",
  "COSTMOSTRECENTASOF",
] as const

/**
 * `2026-05-01T00:00:00` and `5/1/2026` both arrive from the FDIC; normalise to
 * `YYYY-MM-DD`. Anything else is returned as given, so a surprise format shows
 * up in the UI rather than vanishing.
 */
export function toIsoDate(value: string | undefined | null): string {
  if (!value) return ""
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
  return value
}

function num(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function str(value: number | string | undefined | null): string {
  return value == null ? "" : String(value).trim()
}

/** Title-case an FDIC upper-case name without flattening acronyms like "B&T". */
export function tidyName(name: string): string {
  if (!name) return ""
  if (name !== name.toUpperCase()) return name.trim()
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bB&t\b/g, "B&T")
    .replace(/\bNa\b/g, "NA")
    .replace(/\bFsb\b/g, "FSB")
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bOf\b/g, "of")
    .replace(/\bAnd\b/g, "and")
    .replace(/\bThe\b/g, "The")
    .trim()
}

/**
 * The FDIC's wording for the 200-series codes, captured from `/history` so a
 * code met on the `/institutions` endpoint (which carries only the number)
 * can still be described.
 */
export const CHANGE_CODE_DESCRIPTIONS: Record<number, string> = {
  211: "Failure - Whole Institution",
  213: "Merger - Assisted",
  215: "Failure Multiple Acquirer",
  216: "Bridge Bank Resolution",
  217: "Passthrough Receivership/Conservatorship Resolution",
  221: "Absorption - Without Assistance",
  222: "Consolidated - Without Assistance",
  223: "Merger - Without Assistance",
  224: "Affiliated Institution Merger (Corporate Reorganization)",
  225: "Partial Purchase & Assumption - Without Assistance",
  230: "Closing - Failure Payoff",
  235: "RTC Supervised Payoffs, Liquidations, and Closings",
  240: "Closing - Voluntary",
}

/**
 * The 200-series change codes are the ones in which an institution ceases to
 * exist: 210–219 and 230–239 failures, 220–229 mergers and consolidations,
 * 240 a voluntary closing (the charter surrendered, typically after selling
 * the business to a credit union or winding down). Everything else (charter
 * conversions, name changes, branch events) is `other`.
 */
export function kindForCode(code: number, description: string): StructureEventKind {
  if (code >= 210 && code <= 219) return "failure"
  if (code >= 220 && code <= 229) return "merger"
  if (code >= 230 && code <= 239) return "failure"
  if (code === 240) return "closing"
  if (/fail/i.test(description)) return "failure"
  if (/merger|consolidat|absorb/i.test(description)) return "merger"
  if (/closing|liquidat/i.test(description)) return "closing"
  return "other"
}

/** Raw `/institutions` row, the fields that say whether and how a charter ended. */
export type RawInstitutionStatusRow = {
  CERT?: number | string
  NAME?: string
  ACTIVE?: number | string
  /** `MM/DD/YYYY` date the charter ended. */
  ENDEFYMD?: string
  /** Change code of the ending event. */
  CHANGEC1?: number | string
}

/**
 * An exit event from the institution record alone. `/history` can lag a
 * closing by weeks; `/institutions` flips `ACTIVE` to 0 at once and carries
 * the code and date, so this is the fallback when no history row exists yet.
 * Returns `null` for an institution still active.
 */
export function toStructureEventFromStatus(row: RawInstitutionStatusRow): StructureEvent | null {
  if (String(row.ACTIVE ?? "1") !== "0") return null
  const cert = str(row.CERT)
  const code = num(row.CHANGEC1)
  if (!cert || code == null) return null
  const description = CHANGE_CODE_DESCRIPTIONS[code] ?? ""
  return {
    cert,
    date: toIsoDate(row.ENDEFYMD),
    kind: kindForCode(code, description),
    code,
    codeDescription: description,
  }
}

/**
 * Shape a `/history` row. `perspective` is the CERT the caller asked about: the
 * same row reads as a merger to the bank that vanished and as an acquisition
 * to the one that absorbed it.
 */
export function toStructureEvent(row: RawHistoryRow, perspective?: string): StructureEvent | null {
  const code = num(row.CHANGECODE)
  if (code == null) return null
  const outCert = str(row.OUT_CERT)
  const acqCert = str(row.ACQ_CERT)
  const description = str(row.CHANGECODE_DESC)
  const baseKind = kindForCode(code, description)

  const seenFromAcquirer = perspective != null && perspective === acqCert && outCert !== "" && outCert !== perspective
  const kind: StructureEventKind = seenFromAcquirer && baseKind !== "other" ? "acquisition" : baseKind
  const cert = seenFromAcquirer ? acqCert : outCert || str(row.CERT)

  const event: StructureEvent = {
    cert,
    date: toIsoDate(row.EFFDATE),
    kind,
    code,
    codeDescription: description,
  }
  if (acqCert && row.ACQ_INSTNAME && !seenFromAcquirer) {
    event.acquirer = { cert: acqCert, name: tidyName(str(row.ACQ_INSTNAME)) }
  }
  if (seenFromAcquirer && outCert) {
    event.absorbed = { cert: outCert, name: tidyName(str(row.OUT_INSTNAME)) }
  }
  return event
}

const TRANSACTION_LABELS: Record<string, string> = {
  PA: "purchase and assumption, all deposits",
  PI: "purchase and assumption, insured deposits",
  PO: "deposit payout",
  IDT: "insured deposit transfer",
  A: "open-bank assistance",
  REP: "reprivatisation",
  MGR: "FDIC-managed",
}

export function toFailureRecord(row: RawFailureRow): FailureRecord | null {
  const cert = str(row.CERT)
  if (!cert) return null
  const thousands = (v: number | string | undefined) => {
    const n = num(v)
    return n == null ? null : n * 1000
  }
  const transactionCode = str(row.RESTYPE1)
  const acquirerName = str(row.BIDNAME)
  const record: FailureRecord = {
    cert,
    name: tidyName(str(row.NAME)),
    failDate: toIsoDate(row.FAILDATE),
    resolutionType: str(row.RESTYPE) || "FAILURE",
    transactionCode,
    transactionLabel: TRANSACTION_LABELS[transactionCode] ?? (transactionCode ? transactionCode : "resolution"),
    depositsAtFailure: thousands(row.QBFDEP),
    assetsAtFailure: thousands(row.QBFASSET),
    estimatedCost: thousands(row.COST),
    costAsOf: toIsoDate(row.COSTMOSTRECENTASOF) || undefined,
  }
  if (acquirerName) {
    record.acquirer = {
      name: tidyName(acquirerName),
      city: tidyName(str(row.BIDCITY)) || undefined,
      state: str(row.BIDSTATE) || undefined,
    }
  }
  return record
}

/** `$97.3M`, `$1.2B`, `$296K`. */
export function formatMoney(dollars: number | null | undefined): string {
  if (dollars == null || !Number.isFinite(dollars)) return "—"
  const abs = Math.abs(dollars)
  if (abs >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(dollars / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(dollars / 1e3).toFixed(0)}K`
  return `$${dollars.toFixed(0)}`
}

/** `2026-05-01` → `1 May 2026`. */
export function formatEventDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

/**
 * One sentence saying why a bank left the cohort, for the Exits list. Failure
 * records are richer than history rows, so they take precedence.
 */
export function describeExit(event: StructureEvent | null, failure: FailureRecord | null): string {
  if (failure) {
    const parts: string[] = [`Failed ${formatEventDate(failure.failDate)}`]
    if (failure.acquirer) {
      const where = [failure.acquirer.city, failure.acquirer.state].filter(Boolean).join(", ")
      parts.push(`${failure.transactionLabel} by ${failure.acquirer.name}${where ? ` (${where})` : ""}`)
    } else {
      parts.push(failure.transactionLabel)
    }
    const figures: string[] = []
    if (failure.depositsAtFailure != null) figures.push(`${formatMoney(failure.depositsAtFailure)} deposits`)
    if (failure.assetsAtFailure != null) figures.push(`${formatMoney(failure.assetsAtFailure)} assets`)
    if (failure.estimatedCost != null) {
      const share =
        failure.assetsAtFailure && failure.assetsAtFailure > 0
          ? ` (${Math.round((failure.estimatedCost / failure.assetsAtFailure) * 100)}% of assets)`
          : ""
      figures.push(`estimated cost to the insurance fund ${formatMoney(failure.estimatedCost)}${share}`)
    }
    return `${parts.join("; ")}${figures.length ? `. ${figures.join(", ")}` : ""}.`
  }
  if (event) {
    const when = event.date ? ` ${formatEventDate(event.date)}` : ""
    if (event.kind === "merger") {
      return event.acquirer
        ? `Merged into ${event.acquirer.name}${when}.`
        : `Merged or consolidated${when} (${event.codeDescription || "FDIC structure event"}).`
    }
    if (event.kind === "failure") {
      return event.acquirer ? `Failed${when}; acquired by ${event.acquirer.name}.` : `Failed${when}.`
    }
    if (event.kind === "closing") {
      return `Closed voluntarily${when}; the charter was surrendered rather than failed or merged (FDIC code ${event.code}).`
    }
    return `${event.codeDescription || "Structure event"}${when}.`
  }
  return "Stopped filing; the FDIC has not yet recorded a structure event. Often a late filer."
}

/** One sentence for an acquisition made by the bank in view; the date can be left to the caller's layout. */
export function describeAcquisition(event: StructureEvent, { withDate = true } = {}): string {
  const when = withDate && event.date ? ` ${formatEventDate(event.date)}` : ""
  const who = event.absorbed?.name || `CERT ${event.absorbed?.cert ?? "?"}`
  if (event.code >= 210 && event.code <= 219) return `Acquired ${who} from the FDIC as receiver${when}.`
  return `Acquired ${who}${when}.`
}
