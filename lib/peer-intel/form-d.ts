/**
 * Form D: the fundraising half of the peer tracker.
 *
 * Any manager raising from US investors under Regulation D must file a Form D
 * within 15 days of first sale, and must amend it annually while the offering
 * is open. That makes it the one fundraising dataset that is mandatory, free,
 * authoritative and current — no survey, no subscription, no self-reporting.
 *
 * One fund's filing trail answers the whole "fundraising activity" ask. Safe
 * Harbor Equity Distressed Debt Fund 4 (CIK 2017189), the control case this
 * module is tested against:
 *
 *   2024-03-28  D    target $500,000,000  sold          $0   0 investors
 *   2025-07-22  D/A  target $300,000,000  sold $52,918,863  30 investors
 *   2026-07-23  D/A  target $300,000,000  sold $64,168,863  40 investors
 *
 * From which: fund size, progress (21.4% of target), pace (+$11.25M and +10
 * investors in twelve months), average ticket ($1.60M), and a target cut from
 * $500M to $300M — which is the kind of thing a competitor does not put in a
 * press release.
 *
 * This module is pure: XML in, records and arithmetic out.
 */

/**
 * `null` means "not reported", never zero — the same discipline as
 * `lib/analytics/bank-behavior.ts`. A fund that reports no investor count is
 * not a fund with no investors.
 */
/**
 * A broker-dealer paid to sell the offering, from Form D's sales compensation
 * list.
 *
 * The most useful thing in the filing that is not a dollar figure. Form D never
 * says who *bought* — investor identities are confidential by design, and the
 * form reports only a count — but it does say who was paid to *sell*. For a
 * firm raising its own fund, a competitor's distribution tells you how they
 * raise: a book of 232 investors at a $1.13M average through accredited-retail
 * platforms is a different strategy from 40 investors placed direct.
 */
export type SalesRecipient = {
  name: string
  /** FINRA Central Registration Depository number, zero-padded as filed. */
  crd: string | null
  /** The broker-dealer this recipient is associated with, where one is named. */
  associatedBrokerDealer: string | null
  /** `City, ST` of the recipient's own address. */
  location: string | null
  /** States solicited; the literal "All States" is kept as filed. */
  states: string[]
  foreignSolicitation: boolean | null
}

/** An officer, director or promoter of the issuer. Not an investor. */
export type RelatedPerson = {
  /** Either a person's name or, commonly for a fund, the GP entity. */
  name: string
  relationships: string[]
}

export type OfferingRecord = {
  cik: string
  accession: string
  /** `D` for an original, `D/A` for an amendment. */
  formType: string
  /** `YYYY-MM-DD`, the filing date. */
  filedAt: string
  entityName: string
  /** Business address as `City, ST`, when given. */
  location: string | null
  jurisdiction: string | null
  /**
   * The offering target in dollars, or `"indefinite"`.
   *
   * Evergreen and open-ended vehicles routinely file `totalOfferingAmount` as
   * the literal string `Indefinite` rather than a number. That is a real
   * answer, not missing data, so it gets its own value: a percentage of an
   * indefinite target is meaningless and must not be computed.
   */
  offeringAmount: number | "indefinite" | null
  totalSold: number | null
  /** What the filer says is still available. Also `"indefinite"`. */
  remaining: number | "indefinite" | null
  investorCount: number | null
  minimumInvestment: number | null
  /** `YYYY-MM-DD`. The start of the raise, and so the launch signal. */
  dateOfFirstSale: string | null
  /** e.g. `Pooled Investment Fund`. */
  industryGroup: string | null
  /** e.g. `Other Investment Fund`, `Private Equity Fund`, `Hedge Fund`. */
  fundType: string | null
  /** True only where the issuer says it accepted non-accredited investors. */
  hasNonAccreditedInvestors: boolean | null
  /** Who was paid to sell the offering. Empty where the issuer sold it itself. */
  salesRecipients: SalesRecipient[]
  /** Officers, directors and promoters — never investors. */
  relatedPersons: RelatedPerson[]
}

/**
 * XML character entities, decoded after tags are stripped.
 *
 * Fund names carry them routinely — "R &amp; R Capital", "SEGLO PRIVATE
 * CREDIT &amp; OPPORTUNITY FUND" — and an undecoded name reaches the screen
 * looking like markup and fails any name comparison against another source.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))
  if (!m) return null
  const v = decodeEntities(m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).trim()
  return v.length ? v : null
}

/** Dollar fields arrive as digits, as `Indefinite`, or absent. */
function money(raw: string | null): number | "indefinite" | null {
  if (raw == null) return null
  if (/indefinite/i.test(raw)) return "indefinite"
  const n = Number(raw.replace(/[^0-9.-]/g, ""))
  return Number.isFinite(n) ? n : null
}

function count(raw: string | null): number | null {
  if (raw == null) return null
  const n = Number(raw.replace(/[^0-9-]/g, ""))
  return Number.isFinite(n) ? n : null
}

function isoDate(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? m[0] : null
}

function tagIn(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))
  if (!m) return null
  const v = decodeEntities(m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).trim()
  return v.length ? v : null
}

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => m[1])
}

function boolOf(raw: string | null): boolean | null {
  if (raw == null) return null
  if (/^true$/i.test(raw)) return true
  if (/^false$/i.test(raw)) return false
  return null
}

/**
 * Placeholders issuers write into optional string fields.
 *
 * Form D's own convention is "None", but filers also write "N/A", "NA", a
 * dash, or a pair of them. Treating these as values produced a broker-dealer
 * called "N/A" appearing on sixteen funds and $28.9B of associated raises,
 * which would have led the agent table.
 */
const PLACEHOLDERS = /^(none|n\/a|na|n\.a\.|not applicable|-{1,2}|\.)$/i

function notNone(raw: string | null): string | null {
  return raw == null || PLACEHOLDERS.test(raw.trim()) ? null : raw
}

function parseSalesRecipients(xml: string): SalesRecipient[] {
  const list = blocks(xml, "salesCompensationList")[0]
  if (!list) return []
  const out: SalesRecipient[] = []
  for (const block of blocks(list, "recipient")) {
    const name = notNone(tagIn(block, "recipientName"))
    if (!name) continue
    const address = blocks(block, "recipientAddress")[0] ?? ""
    const city = tagIn(address, "city")
    const state = tagIn(address, "stateOrCountry")
    const statesBlock = blocks(block, "statesOfSolicitationList")[0] ?? ""
    out.push({
      name,
      crd: notNone(tagIn(block, "recipientCRDNumber")),
      associatedBrokerDealer: notNone(tagIn(block, "associatedBDName")),
      location: city && state ? `${city}, ${state}` : city ?? null,
      states: [...statesBlock.matchAll(/<value>([\s\S]*?)<\/value>/gi)]
        .map((m) => decodeEntities(m[1].trim()))
        .filter(Boolean),
      foreignSolicitation: boolOf(tagIn(block, "foreignSolicitation")),
    })
  }
  return out
}

function parseRelatedPersons(xml: string): RelatedPerson[] {
  const list = blocks(xml, "relatedPersonsList")[0]
  if (!list) return []
  const out: RelatedPerson[] = []
  for (const block of blocks(list, "relatedPersonInfo")) {
    const nameBlock = blocks(block, "relatedPersonName")[0] ?? block
    const first = tagIn(nameBlock, "firstName")
    const last = tagIn(nameBlock, "lastName")
    // A fund usually files its GP entity here, which arrives with "--" in the
    // first-name field; keeping both parts and trimming the placeholder gives
    // the entity name rather than "-- Silverview Credit Partners LP".
    const name = [first, last]
      .map((part) => (part && part !== "--" ? part : null))
      .filter(Boolean)
      .join(" ")
      .trim()
    if (!name) continue
    const relBlock = blocks(block, "relatedPersonRelationshipList")[0] ?? block
    out.push({
      name,
      relationships: [...relBlock.matchAll(/<relationship>([\s\S]*?)<\/relationship>/gi)]
        .map((m) => decodeEntities(m[1].trim()))
        .filter(Boolean),
    })
  }
  return out
}

/**
 * Parse a Form D `primary_doc.xml`.
 *
 * `dateOfFirstSale` is nested inside a wrapper element that also carries a
 * "yet to occur" flag, so the date is pulled by pattern rather than by reading
 * the wrapper's text — which would otherwise come back as the whole subtree.
 */
export function parseFormD(
  xml: string,
  context: { cik: string; accession: string; formType: string; filedAt: string; location?: string | null }
): OfferingRecord {
  return {
    cik: String(Number(context.cik.replace(/\D/g, ""))),
    accession: context.accession,
    formType: context.formType,
    filedAt: context.filedAt,
    entityName: tag(xml, "entityName") ?? "",
    location: context.location ?? null,
    jurisdiction: tag(xml, "jurisdictionOfInc") ?? tag(xml, "stateOrCountry"),
    offeringAmount: money(tag(xml, "totalOfferingAmount")),
    totalSold: (() => {
      const v = money(tag(xml, "totalAmountSold"))
      return typeof v === "number" ? v : null
    })(),
    remaining: money(tag(xml, "totalRemaining")),
    investorCount: count(tag(xml, "totalNumberAlreadyInvested")),
    minimumInvestment: count(tag(xml, "minimumInvestmentAccepted")),
    dateOfFirstSale: isoDate(tag(xml, "dateOfFirstSale")),
    industryGroup: tag(xml, "industryGroupType"),
    fundType: tag(xml, "investmentFundType"),
    hasNonAccreditedInvestors: boolOf(tag(xml, "hasNonAccreditedInvestors")),
    salesRecipients: parseSalesRecipients(xml),
    relatedPersons: parseRelatedPersons(xml),
  }
}

/**
 * One fund's offering history and what it implies, oldest filing first.
 *
 * A "raise" is the filing trail of a single CIK: the original Form D plus its
 * amendments. Managers file a new CIK per fund vintage, so a CIK is a fund and
 * the trail is that fund's raise.
 */
export type Raise = {
  cik: string
  fundName: string
  location: string | null
  layerHint: string | null
  filings: OfferingRecord[]
  /** From the newest filing. */
  target: number | "indefinite" | null
  sold: number | null
  investorCount: number | null
  minimumInvestment: number | null
  firstSale: string | null
  firstFiled: string | null
  lastFiled: string | null
  /**
   * Sold as a share of target, 0–1. Null when the target is indefinite or
   * either side is missing — never a number computed against `"indefinite"`.
   */
  progress: number | null
  /** Sold per investor, from the newest filing. */
  averageTicket: number | null
  /** Change in sold and investors since the filing closest to twelve months earlier. */
  soldLastYear: number | null
  investorsLastYear: number | null
  /** True when any amendment reduced the stated target. */
  targetCut: boolean
  /** The largest target the fund ever stated, when it has since been cut. */
  targetHigh: number | null
  /** Quarters since the last filing, as a staleness measure for the stall signal. */
  quartersSinceFiling: number | null
  /** Who is paid to sell it, from the newest filing. */
  salesRecipients: SalesRecipient[]
  /** Officers, directors and promoters, from the newest filing. Not investors. */
  relatedPersons: RelatedPerson[]
  /** Whether the issuer accepted non-accredited investors, per the newest filing. */
  hasNonAccreditedInvestors: boolean | null
}

function numericTarget(v: number | "indefinite" | null): number | null {
  return typeof v === "number" && v > 0 ? v : null
}

/** Whole months between two ISO dates, positive when `b` is later. */
function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0)
}

/**
 * Build the raise from one CIK's filings.
 *
 * `asOf` is the date the view is being computed for; it decides staleness, and
 * is passed in rather than read from the clock so the result is testable and
 * so a cached entry does not change meaning between reads.
 */
export function buildRaise(filings: OfferingRecord[], asOf: string): Raise | null {
  const ordered = [...filings]
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.filedAt))
    .sort((a, b) => (a.filedAt < b.filedAt ? -1 : a.filedAt > b.filedAt ? 1 : a.accession < b.accession ? -1 : 1))
  if (!ordered.length) return null

  const newest = ordered[ordered.length - 1]
  const oldest = ordered[0]

  const targets = ordered.map((f) => numericTarget(f.offeringAmount)).filter((n): n is number => n != null)
  const high = targets.length ? Math.max(...targets) : null
  const current = numericTarget(newest.offeringAmount)
  const targetCut = high != null && current != null && current < high

  const sold = newest.totalSold
  const progress = current != null && sold != null && current > 0 ? sold / current : null
  const averageTicket = sold != null && newest.investorCount ? sold / newest.investorCount : null

  // The filing closest to a year before the newest, so pace is measured over a
  // real interval rather than between whichever two filings happen to exist.
  let prior: OfferingRecord | null = null
  for (const f of ordered.slice(0, -1)) {
    const months = monthsBetween(f.filedAt, newest.filedAt)
    if (months >= 9) prior = f
  }
  const soldLastYear = prior && sold != null && prior.totalSold != null ? sold - prior.totalSold : null
  const investorsLastYear =
    prior && newest.investorCount != null && prior.investorCount != null
      ? newest.investorCount - prior.investorCount
      : null

  const months = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? monthsBetween(newest.filedAt, asOf) : null

  return {
    cik: newest.cik,
    fundName: newest.entityName || oldest.entityName,
    location: newest.location ?? oldest.location,
    layerHint: null,
    filings: ordered,
    target: newest.offeringAmount,
    sold,
    investorCount: newest.investorCount,
    minimumInvestment: newest.minimumInvestment,
    firstSale: ordered.map((f) => f.dateOfFirstSale).find((d) => d) ?? null,
    firstFiled: oldest.filedAt,
    lastFiled: newest.filedAt,
    progress,
    averageTicket,
    soldLastYear,
    investorsLastYear,
    targetCut,
    targetHigh: targetCut ? high : null,
    quartersSinceFiling: months == null ? null : Math.floor(months / 3),
    salesRecipients: newest.salesRecipients,
    relatedPersons: newest.relatedPersons,
    hasNonAccreditedInvestors: newest.hasNonAccreditedInvestors,
  }
}

/**
 * Is this raise still open?
 *
 * A fund that has stopped filing amendments has almost always stopped raising,
 * but Form D carries no "closed" flag — the absence of a filing is the only
 * signal. Four quarters is the threshold because the annual amendment is
 * mandatory while the offering is open, so a year of silence means it is not.
 */
export function isLikelyOpen(raise: Raise): boolean {
  if (raise.quartersSinceFiling == null) return true
  return raise.quartersSinceFiling < 4
}

/** New if its first sale, or failing that its first filing, falls inside the window. */
export function isNewLaunch(raise: Raise, windowStart: string): boolean {
  const start = raise.firstSale ?? raise.firstFiled
  return start != null && start >= windowStart
}
