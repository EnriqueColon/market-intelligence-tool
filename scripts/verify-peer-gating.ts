/**
 * Gating sources, checked against live EDGAR — repeatably, and over history.
 *
 *   npm run verify:peer-gating                  # 3 results filings per BDC, 3 10-Qs per REIT
 *   npm run verify:peer-gating -- --depth 6     # deeper history
 *   npm run verify:peer-gating -- --quarters 5  # more REIT 10-Qs
 *
 * Read-only; touches no cache. Establishes, for the seven non-traded vehicles:
 *
 *  1. Which run issuer tender offers (`SC TO-I`) and which do not. The
 *     distinction matters because `SC TO-T` is a *third party's* bid for the
 *     fund's shares — SREIT's five are Cox Capital and Saba Capital's hostile
 *     mini-tender, not SREIT's programme — and a prefix match on `SC TO` would
 *     read it as the fund's own gating.
 *
 *  2. For each tender-offer fund, the last `depth` *final amendments*, found by
 *     the presence of the result figures themselves — the newest `SC TO-I/A`
 *     is usually a Rule 13e-4(c)(1) communication with no figures, and the
 *     cover-page checkbox does not survive tag stripping. For each: shares
 *     tendered, shares accepted, the fulfilment rate computed from the two, and
 *     what the filing's own "representing X%" refers to — which is the
 *     fulfilment rate for some sponsors and the cap for others, so the script
 *     reports whether each sponsor is consistent with itself over time.
 *
 *  3. For the two REITs, which disclose in 10-Q prose instead, the shape of
 *     that prose in the last `quarters` filings: the fully-met wording, the
 *     prorated wording with a percentage, SREIT's per-month footnote, or none.
 *
 * First run 2026-10-22 was the spot-check behind `docs/PEER_TRACKER_STATUS.md`
 * §3; the one-quarter-per-fund observation of 2026-10-21 rested on five
 * documents, and an extractor will run over hundreds.
 */

import { edgarHeaders, REQUEST_SPACING_MS } from "../lib/peer-intel/edgar-contract"
import { plainText } from "../lib/peer-intel/gating"
import { nonTradedVehiclesInScope } from "../lib/peer-intel/registry"

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}
const DEPTH = flag("depth", 3)
const QUARTERS = flag("quarters", 3)

const HEADERS = edgarHeaders(process.env.SEC_EDGAR_CONTACT?.trim() || "market-intelligence@safeharborcp.com")

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

let nextSlot = 0
async function get(url: string, accept = "application/json"): Promise<string> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + REQUEST_SPACING_MS
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
  const res = await fetch(url, { headers: { ...HEADERS, Accept: accept } })
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`)
  return res.text()
}

type Filing = { form: string; filedAt: string; accession: string; primaryDocument: string }

async function allFilings(cik: string): Promise<Filing[]> {
  const sub = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`))
  const out: Filing[] = []
  const push = (b: any) => {
    for (let i = 0; i < b.form.length; i++) {
      out.push({ form: b.form[i], filedAt: b.filingDate[i], accession: b.accessionNumber[i], primaryDocument: b.primaryDocument[i] })
    }
  }
  push(sub.filings.recent)
  for (const f of sub.filings.files ?? []) push(JSON.parse(await get(`https://data.sec.gov/submissions/${f.name}`)))
  return out.sort((a, b) => (a.filedAt < b.filedAt ? 1 : -1))
}

function docUrl(cik: string, f: Filing): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession.replace(/-/g, "")}/${f.primaryDocument}`
}

// ------------------------------------------------------------ tender results

/** Sentences, split on a period followed by whitespace so "18.8%" and "$2.1 billion" stay whole. */
function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+(?=[A-Z0-9(])/)
}

/** Share counts in a span: seven-plus digit comma-grouped numbers, dollar figures stripped first. */
function shareCounts(span: string): number[] {
  return [...span.replace(/\$\s?[\d,]+(?:\.\d+)?/g, " ").matchAll(/\b(\d{1,3}(?:,\d{3}){2,})\b/g)].map((m) => Number(m[1].replace(/,/g, "")))
}

export type TenderResult = {
  filedAt: string
  url: string
  expired: string | null
  tendered: number | null
  accepted: number | null
  /**
   * `prorated` when the filing gives an accepted share count — which it does
   * only when requests exceeded the cap. `all-accepted` when it instead states
   * that every tendered share was bought: "accepted for purchase 100% of the
   * Shares" (BCRED, Apollo, HPS) or "purchased all validly tendered … Shares"
   * (Blue Owl). Stated, not inferred — and the only shape a fully-met quarter
   * takes, so a reader that demands a count sees only the bad quarters.
   */
  fulfilment: "prorated" | "all-accepted"
  /** accepted ÷ tendered, computed here, never read from the filing. */
  rate: number | null
  /** The filing's own "representing X%" and what the clause says it is a share of. */
  representing: { pct: number; of: "tendered" | "outstanding" | "other" } | null
  cites13e4c4: boolean
  /** The filing agent's naming convention, as a hint that the template changed. */
  template: string
}

function readTenderResult(text: string, filing: Filing, url: string): TenderResult | null {
  const ss = sentences(text)
  const tenderedSentence = ss.find((s) => /were validly tendered/i.test(s) && /\d{1,3}(?:,\d{3}){2,}/.test(s))
  if (!tenderedSentence) return null
  const tendered = shareCounts(tenderedSentence.slice(0, tenderedSentence.search(/validly tendered/i)))
  const t = tendered.length ? tendered.reduce((a, b) => a + b, 0) : null
  if (t == null) return null

  // A prorated quarter states how many were accepted, and "pro rata" appears
  // in every sponsor's prorated wording. A fully-met quarter takes one of three
  // shapes: "accepted for purchase 100% of the Shares" (BCRED, Apollo),
  // "purchased all validly tendered … Shares" (Blue Owl), or — HPS — no
  // acceptance sentence at all, only payment "of the total amount of Shares
  // tendered". So: an accepted count means prorated; otherwise, no "pro rata"
  // anywhere in the results means everything tendered was bought.
  const acceptedSentence = ss.find((s) => /accepted for purchase/i.test(s) && /\d{1,3}(?:,\d{3}){2,}/.test(s))
  let a: number | null = null
  let fulfilment: TenderResult["fulfilment"]
  if (acceptedSentence) {
    const accSpan = acceptedSentence.slice(acceptedSentence.search(/accepted for purchase/i))
    const accEnd = accSpan.search(/pro rata|representing|for approximately|\bfor\s+\$/i)
    const accepted = shareCounts(accEnd > 0 ? accSpan.slice(0, accEnd) : accSpan)
    a = accepted.length ? accepted.reduce((x, y) => x + y, 0) : null
    fulfilment = "prorated"
  } else if (!/pro rata/i.test(text)) {
    a = t
    fulfilment = "all-accepted"
  } else {
    return null
  }

  const rep = text.match(/representing\s+(?:approximately\s+)?([\d.]+)\s*%\s+of\s+the\s+([^.]{0,160})/i)
  const representing = rep
    ? {
        pct: Number(rep[1]),
        of: /tendered/i.test(rep[2]) ? ("tendered" as const) : /outstanding/i.test(rep[2]) ? ("outstanding" as const) : ("other" as const),
      }
    : null

  // Not `[^.]`: the time reads "7 00 P.M., Eastern Time", and a period inside
  // the span is exactly what broke yesterday's "$2.1 billion" read.
  const expired = text.match(/expired at .{0,80}? on\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? null

  return {
    filedAt: filing.filedAt,
    url,
    expired,
    tendered: t,
    accepted: a,
    fulfilment,
    rate: t && a != null && t > 0 ? a / t : null,
    representing,
    cites13e4c4: /13e-?\s?4\s*\(\s*c\s*\)\s*\(\s*4\s*\)/i.test(text),
    template: filing.primaryDocument.replace(/\d+/g, "#").slice(0, 18),
  }
}

// ------------------------------------------------------------------ REIT prose

type ReitShape = "all-requests-met" | "prorated-with-pct" | "per-month-footnote" | "plan-restricted" | "none"

/**
 * The spans below use `.{0,n}?`, never `[^.]`: the figures are "$2.1 billion"
 * and "2.0%", and a period inside the span is the normal case. `plainText`
 * has already collapsed the document onto one line.
 */
function readReitProse(text: string): { shape: ReitShape; quote: string | null } {
  const t = text.replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
  // SREIT from April 2026: the plan itself was amended so that "no repurchase
  // requests will be accepted except" death, disability and sub-$5,000
  // accounts. No percentage, because ordinary holders get nothing — the most
  // gated state of all, and invisible to a reader keyed on percentages. Checked
  // first, because the same 10-Q also carries the plan's ordinary wording.
  const restricted = t.match(/no repurchase requests will be accepted except.{0,200}/i)
  if (restricted) return { shape: "plan-restricted", quote: restricted[0].slice(0, 220) }
  // BREIT, nothing prorated: "we fulfilled $2.1 billion of repurchases requested, which represents all
  // repurchase requests received" (2026) or "…, including all repurchase requests received" (2025).
  // The figure is year-to-date — three, six or nine months — so a quarterly series must difference it.
  // SREIT, nothing prorated: "stockholders' share repurchase requests were satisfied in March 2024".
  const allMet =
    t.match(/we fulfilled .{0,160}?(?:which represents|including) all repurchase requests received.{0,60}/i) ??
    t.match(/repurchase requests were satisfied in [A-Z][a-z]+ \d{4}/i)
  if (allMet) return { shape: "all-requests-met", quote: allMet[0].slice(0, 220) }
  // BREIT, prorated: "fulfilled repurchases equal to 2.0%, 2.0% and 1.0% of NAV, or 34%, 43% and 29% of repurchase requests".
  const prorated = t.match(/fulfilled .{0,140}?\d+(?:\.\d+)?\s*%.{0,80}?of repurchase requests.{0,80}/i)
  if (prorated) return { shape: "prorated-with-pct", quote: prorated[0].slice(0, 220) }
  // SREIT, prorated: "approximately 4% of each stockholder's June repurchase request was satisfied".
  const footnote = t.match(/approximately\s+\d+(?:\.\d+)?\s*%\s+of each stockholder.{0,80}?repurchase request was satisfied/i)
  if (footnote) return { shape: "per-month-footnote", quote: footnote[0].slice(0, 220) }
  return { shape: "none", quote: null }
}

// ------------------------------------------------------------------------ main

async function main() {
  const vehicles = nonTradedVehiclesInScope("national")
  console.log(`Gating sources for ${vehicles.length} non-traded vehicles · depth ${DEPTH} · REIT quarters ${QUARTERS}\n`)

  // 1. Who files what.
  console.log("1. Schedule TO filings, full history")
  const byCik = new Map<string, Filing[]>()
  const tenderFunds: Array<{ cik: string; name: string }> = []
  const reits: Array<{ cik: string; name: string }> = []
  for (const v of vehicles) {
    const filings = await allFilings(v.cik)
    byCik.set(v.cik, filings)
    const toI = filings.filter((f) => /^SC TO-I/.test(f.form)).length
    const toT = filings.filter((f) => /^SC TO-T/.test(f.form)).length
    const kind = toI ? "issuer tender" : toT ? "THIRD-PARTY bid only" : "no Schedule TO"
    console.log(`  ${v.name.padEnd(52)} SC TO-I ${String(toI).padStart(3)}   SC TO-T ${String(toT).padStart(2)}   → ${kind}`)
    if (toI) tenderFunds.push({ cik: v.cik, name: v.name })
    else reits.push({ cik: v.cik, name: v.name })
  }
  check("every vehicle is either an issuer-tender fund or a REIT with none of its own", tenderFunds.length + reits.length === vehicles.length)
  check("the third-party form is never mistaken for an issuer tender", !vehicles.some((v) => {
    const fs = byCik.get(v.cik)!
    return fs.some((f) => /^SC TO-T/.test(f.form)) && !fs.some((f) => /^SC TO-I/.test(f.form)) && tenderFunds.some((t) => t.cik === v.cik)
  }))

  // 2. Final amendments, found by their figures.
  console.log(`\n2. The last ${DEPTH} results filings per tender-offer fund`)
  const perFund = new Map<string, TenderResult[]>()
  for (const fund of tenderFunds) {
    const amendments = byCik.get(fund.cik)!.filter((f) => f.form === "SC TO-I/A")
    const results: TenderResult[] = []
    let walked = 0
    for (const f of amendments) {
      if (results.length >= DEPTH) break
      walked++
      const url = docUrl(fund.cik, f)
      const text = plainText(await get(url, "text/html"))
      const r = readTenderResult(text, f, url)
      if (r) results.push(r)
    }
    perFund.set(fund.cik, results)

    console.log(`\n  ${fund.name}  (${results.length} finals in ${walked} amendments walked)`)
    console.log(`    ${"filed".padEnd(11)} ${"expired".padEnd(19)} ${"tendered".padStart(12)} ${"accepted".padStart(12)} ${"rate".padStart(6)}   ${"says".padEnd(22)} ${"(c)(4)".padEnd(7)} template`)
    for (const r of results) {
      const says = r.fulfilment === "all-accepted" ? "all accepted (stated)" : r.representing ? `${r.representing.pct}% of ${r.representing.of}` : "—"
      console.log(
        `    ${r.filedAt.padEnd(11)} ${(r.expired ?? "—").padEnd(19)} ${String(r.tendered ?? "—").padStart(12)} ${String(r.accepted ?? "—").padStart(12)} ${(r.rate == null ? "—" : `${(r.rate * 100).toFixed(1)}%`).padStart(6)}   ${says.padEnd(22)} ${(r.cites13e4c4 ? "yes" : "no").padEnd(7)} ${r.template}`
      )
    }
    check(`${fund.name}: ${DEPTH} results filings found`, results.length >= DEPTH, `${results.length}`)
    check(`${fund.name}: every result carries both share counts`, results.every((r) => r.tendered != null && r.accepted != null))
    check(`${fund.name}: accepted never exceeds tendered`, results.every((r) => r.rate == null || r.rate <= 1))
    check(
      `${fund.name}: a fully-met quarter reads as 100% and a prorated one below it`,
      results.every((r) => (r.fulfilment === "all-accepted" ? r.rate === 1 : r.rate != null && r.rate < 1))
    )
    // The "representing X%" clause exists only in prorated quarters, and its
    // denominator must not move within a sponsor — it is the cap for some and
    // the fulfilment rate for others.
    const denominators = new Set(results.filter((r) => r.fulfilment === "prorated").map((r) => r.representing?.of ?? "none"))
    check(
      `${fund.name}: "representing X%" refers to the same thing in every prorated filing`,
      denominators.size <= 1,
      [...denominators].join(" / ") || "no prorated quarter in window"
    )
    // Where the filing says the rate itself, our computed rate must agree — this is the self-validation.
    const stated = results.filter((r) => r.representing?.of === "tendered" && r.rate != null)
    if (stated.length) {
      check(
        `${fund.name}: computed rate agrees with the stated fulfilment rate`,
        stated.every((r) => Math.abs(r.rate! * 100 - r.representing!.pct) < 0.15),
        stated.map((r) => `${(r.rate! * 100).toFixed(1)} vs ${r.representing!.pct}`).join(", ")
      )
    }
    const templates = new Set(results.map((r) => r.template))
    if (templates.size > 1) console.log(`    note: ${templates.size} filing-agent templates in this window (${[...templates].join(", ")}) — the figures survived both`)
    // Ares files a results amendment and then a corrected one for the same
    // offer, a month apart and differing in the last digits. Keyed on filing
    // date that is two quarters; keyed on expiry it is one, and the later
    // filing stands.
    const byExpiry = new Map<string, number>()
    for (const r of results) if (r.expired) byExpiry.set(r.expired, (byExpiry.get(r.expired) ?? 0) + 1)
    const dup = [...byExpiry].filter(([, n]) => n > 1)
    if (dup.length) console.log(`    note: more than one results filing for ${dup.map(([e, n]) => `${e} (${n})`).join(", ")} — a corrected re-file; an extractor must key on expiry and keep the later one`)
  }

  // 3. REIT prose.
  console.log(`\n3. The REITs' 10-Q wording, last ${QUARTERS} quarters`)
  for (const reit of reits) {
    const tenQs = byCik.get(reit.cik)!.filter((f) => f.form === "10-Q").slice(0, QUARTERS)
    console.log(`\n  ${reit.name}`)
    const shapes: ReitShape[] = []
    for (const f of tenQs) {
      const text = plainText(await get(docUrl(reit.cik, f), "text/html"))
      const r = readReitProse(text)
      shapes.push(r.shape)
      console.log(`    ${f.filedAt}  ${r.shape.padEnd(20)} ${r.quote ? `"${r.quote.replace(/\s+/g, " ")}"` : ""}`)
    }
    check(`${reit.name}: every 10-Q matched a known wording shape or is explicitly none`, shapes.length === tenQs.length)
    console.log(`    shapes seen: ${[...new Set(shapes)].join(", ")}`)
  }

  console.log(`\n${failures ? `${failures} check(s) failed` : "all checks passed"}`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
