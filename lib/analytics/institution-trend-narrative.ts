/**
 * The analyst reading under the drawer's eight-quarter panels: the prompt that
 * asks for it, and the guard that decides whether the answer may be shown.
 *
 * The model sees exactly the table the panels plot — nothing from outside the
 * eight quarters — and is asked to explain what the numbers mean: which moves
 * are denominators rather than lending, which improvements did not hold, what
 * looks like a one-off. It is not asked for facts, and the guard makes sure it
 * did not supply any: every number in the reply must be a figure from the
 * table (at any rounding), a quarter or year label, or a small count. A reply
 * that fails is replaced by a deterministic reading built from the signals, so
 * the drawer never shows an invented figure.
 *
 * Import-free so the bare Node test runner can load it.
 */

import type { InstitutionTrend, TrendPoint } from "./institution-trend"

export const NARRATIVE_WORD_LIMIT = 140

type Column = { key: keyof TrendPoint; header: string; decimals: number }

const COLUMNS: Column[] = [
  { key: "noncurrentPct", header: "noncurrent/loans %", decimals: 2 },
  { key: "nplPct", header: "nonaccrual/loans %", decimals: 2 },
  { key: "leveragePct", header: "leverage %", decimals: 2 },
  { key: "cet1Pct", header: "CET1 %", decimals: 2 },
  { key: "totalRbcPct", header: "total RBC %", decimals: 2 },
  { key: "creToCapitalPct", header: "CRE/(T1+T2) %", decimals: 1 },
  { key: "constructionToCapitalPct", header: "construction/(T1+T2) %", decimals: 1 },
  { key: "reservePct", header: "allowance/loans %", decimals: 2 },
  { key: "roaPct", header: "ROA %", decimals: 2 },
  { key: "nimPct", header: "NIM %", decimals: 2 },
]

function cell(point: TrendPoint, col: Column): string {
  const v = point[col.key]
  return typeof v === "number" ? v.toFixed(col.decimals) : "—"
}

/** "Elizabethton, Tennessee" — whatever of city and state the filing carries, or "" if neither. */
export function locationOf(trend: Pick<InstitutionTrend, "city" | "state">): string {
  const city = trend.city?.trim() ? displayName(trend.city) : ""
  const state = trend.state?.trim() ? displayName(trend.state) : ""
  return [city, state].filter(Boolean).join(", ")
}

/** "COMMUNITY B&T WEST GEORGIA" → "Community B&T West Georgia". Tokens with "&" stay upper-case. */
export function displayName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (w.includes("&") ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
}

type Screen = { key: keyof TrendPoint; label: string; value: number; kind: "ceiling" | "floor" }

/** The published screens the prompt may cite, with the direction that is adverse. */
const SCREENS: Screen[] = [
  { key: "noncurrentPct", label: "noncurrent loans above 2%", value: 2, kind: "ceiling" },
  { key: "noncurrentPct", label: "noncurrent loans above 5%", value: 5, kind: "ceiling" },
  { key: "creToCapitalPct", label: "CRE to capital above 300%", value: 300, kind: "ceiling" },
  { key: "constructionToCapitalPct", label: "construction to capital above 100%", value: 100, kind: "ceiling" },
  { key: "reservePct", label: "allowance below the 1% floor", value: 1, kind: "floor" },
  { key: "leveragePct", label: "leverage below 5% (well capitalised)", value: 5, kind: "floor" },
]

/**
 * Which quarters sit on the wrong side of each screen, computed here so the
 * model is handed comparisons rather than asked to make them — it has called
 * 0.7% "above" a 1% floor and 2.5% "below" it.
 */
export function formatScreenFlags(trend: InstitutionTrend): string {
  return SCREENS.map((s) => {
    const hits = trend.points
      .filter((p) => {
        const v = p[s.key]
        return typeof v === "number" && (s.kind === "ceiling" ? v > s.value : v < s.value)
      })
      .map((p) => p.label)
    return `- ${s.label}: ${hits.length === 0 ? "no quarter" : hits.length === trend.points.length ? "every quarter" : hits.join(", ")}`
  }).join("\n")
}

/** The eight quarters as a pipe table, oldest first, plus the capital category. */
export function formatTrendTable(trend: InstitutionTrend): string {
  const header = ["quarter", ...COLUMNS.map((c) => c.header), "PCA category"].join(" | ")
  const rows = trend.points.map((p) =>
    [p.label, ...COLUMNS.map((c) => cell(p, c)), p.capital?.label ?? "not reported"].join(" | ")
  )
  return [header, ...rows].join("\n")
}

export const NARRATIVE_SYSTEM = `You are a bank credit analyst writing for a commercial real estate lender who has just opened one bank's eight-quarter record. Explain what the numbers mean, in plain prose, in at most two short paragraphs and ${NARRATIVE_WORD_LIMIT} words.

Rules:
- Use only the figures in the table. Quote them as they appear, to at most one decimal place; never round to a convenient number ("past 400%" for 425.6% is wrong — write 426%). Do not introduce any number that is not in the table, other than quarter and year labels and small counts such as "three quarters".
- Say what is driving a move. A jump in CRE-to-capital with flat lending is a shrinking denominator, not new exposure; say so when the capital columns show it. An improvement that reverses is worth calling temporary.
- Flag anomalies as such: a single-quarter earnings figure far from the others is "a one-off gain or a data issue", not a trend.
- If the CET1 and total RBC columns are blank, the bank files under the Community Bank Leverage Ratio and reports only leverage; say that once.
- Mention a published screen only where the "Screens" list says the bank is across it, and only as that list states it; do not compare figures to screens yourself. Ceilings, where higher is worse: 300% CRE to capital, 100% construction to capital, 2% and 5% noncurrent loans. Floors, where lower is worse: 1% allowance to loans, 5% leverage for well capitalised.
- Open by naming the bank and its location exactly as given ("Citizens Bank of Elizabethton, Tennessee, …" or "Citizens Bank (Elizabethton, Tennessee) …"): there are many banks with the same name, and the reader must know which one this is. Do not restate the name or location after that.
- No headings, bullets, bold, or preamble. Do not speculate about events outside the table (closures, mergers, enforcement); the most you may say is what a pattern "looks like".
- British spelling: capitalised, not capitalized.`

export function buildNarrativeUserPrompt(trend: InstitutionTrend): string {
  const where = locationOf(trend)
  const lines = [
    `Bank: ${displayName(trend.name)}${where ? `, ${where}` : ""} (FDIC CERT ${trend.cert}).`,
    `Quarters: ${trend.points.length}, oldest first. All values are percent.`,
    trend.leverageOnly ? "Files under the Community Bank Leverage Ratio: no risk-based ratios reported." : "",
    "",
    formatTrendTable(trend),
    "",
    "Screens — quarters on the adverse side of each published threshold:",
    formatScreenFlags(trend),
    "",
    `Automated verdict: ${trend.verdict.heading}. ${trend.verdict.text}`,
  ]
  return lines.filter((l) => l !== "").join("\n")
}

/** Every rounding a figure might be quoted at, as strings, with and without sign. */
function quotations(value: number): string[] {
  const out = new Set<string>()
  const abs = Math.abs(value)
  for (const d of [0, 1, 2]) {
    const fixed = abs.toFixed(d)
    out.add(fixed)
    // "12.0" may be written "12"; "0.50" may be written "0.5". Only a
    // fractional part is trimmed: "400" must stay "400", not become "4".
    if (fixed.includes(".")) out.add(fixed.replace(/\.?0+$/, ""))
  }
  // Rounding the other way at the boundary: 8.85 may be quoted as 8.9 or 8.8.
  out.add((Math.floor(abs * 10) / 10).toFixed(1))
  out.add((Math.ceil(abs * 10) / 10).toFixed(1))
  out.add(Math.floor(abs).toString())
  out.add(Math.ceil(abs).toString())
  return Array.from(out)
}

/** The set of strings a number in the narrative is allowed to match. */
export function allowedFigures(trend: InstitutionTrend): Set<string> {
  const allowed = new Set<string>()
  for (const p of trend.points) {
    for (const col of COLUMNS) {
      const v = p[col.key]
      if (typeof v === "number") quotations(v).forEach((q) => allowed.add(q))
    }
    const year = p.label.match(/\d{4}$/)?.[0]
    if (year) {
      allowed.add(year)
      allowed.add(year.slice(2))
    }
    const q = p.label.match(/^Q(\d)/)?.[1]
    if (q) allowed.add(q)
  }
  // Published screens the prompt permits, and small counts.
  for (const s of [1, 2, 5, 100, 300]) allowed.add(String(s))
  for (let n = 0; n <= 20; n++) allowed.add(String(n))
  return allowed
}

export type NarrativeCheck = { ok: true } | { ok: false; unsupported: string[]; reason: string }

/**
 * Accept a narrative only if every number in it is accounted for. Numbers are
 * matched as written, so "17.3%" needs 17.3 to be a rounding of some table
 * value and "710" needs 710 to be one.
 */
export function checkNarrative(text: string, trend: InstitutionTrend): NarrativeCheck {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) return { ok: false, unsupported: [], reason: "empty" }
  if (words > NARRATIVE_WORD_LIMIT * 1.4) return { ok: false, unsupported: [], reason: `too long (${words} words)` }
  if (/^\s*[#*-]/m.test(text)) return { ok: false, unsupported: [], reason: "markdown formatting" }

  const allowed = allowedFigures(trend)
  const unsupported: string[] = []
  // Quarter labels like Q1'26 or Q1 2026 are checked by their parts above;
  // strip them so the apostrophe form does not read as a bare number.
  const stripped = text.replace(/\bQ[1-4]\s?'?\s?(?:20)?\d{2}\b/g, " ").replace(/\b(?:19|20)\d{2}\b/g, " ")
  for (const m of stripped.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const raw = m[0].replace(/^-/, "")
    // Trim a fractional part's trailing zeros ("17.30" → "17.3"), never an
    // integer's: "400" is not the small count 4.
    const trimmed = raw.includes(".") ? raw.replace(/\.?0+$/, "") : raw
    if (!allowed.has(raw) && !allowed.has(trimmed)) unsupported.push(m[0])
  }
  if (unsupported.length > 0) {
    return { ok: false, unsupported, reason: `figures not in the table: ${Array.from(new Set(unsupported)).join(", ")}` }
  }
  return { ok: true }
}

/**
 * What the drawer shows when there is no model, or the model's answer failed
 * the check: the verdict and the signals, in sentences, with nothing invented.
 */
export function fallbackNarrative(trend: InstitutionTrend): string {
  const { points, verdict, leverageOnly } = trend
  if (points.length < 2) {
    const where = locationOf(trend)
    return `${displayName(trend.name)}${where ? ` (${where})` : ""}: ${verdict.text}`
  }
  const first = points[0]
  const last = points[points.length - 1]
  const where = locationOf(trend)
  const parts: string[] = [`${displayName(trend.name)}${where ? ` (${where})` : ""} — ${verdict.heading.toLowerCase()}: ${verdict.text}`]
  const move = (label: string, a: number | null, b: number | null, d = 2) =>
    a != null && b != null ? `${label} ${a.toFixed(d)}% to ${b.toFixed(d)}%` : null
  const moves = [
    move("noncurrent loans", first.noncurrentPct, last.noncurrentPct),
    move("leverage", first.leveragePct, last.leveragePct),
    move("CRE to capital", first.creToCapitalPct, last.creToCapitalPct, 0),
    move("ROA", first.roaPct, last.roaPct),
  ].filter((m): m is string => m != null)
  if (moves.length) parts.push(`Over ${first.label}–${last.label}: ${moves.join("; ")}.`)
  if (leverageOnly) parts.push("The bank files under the Community Bank Leverage Ratio and reports no risk-based capital ratios.")
  return parts.join(" ")
}
