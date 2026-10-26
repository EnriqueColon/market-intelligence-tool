/**
 * The Market Analytics data API: the pure parts.
 *
 * Other tools (today, the AMO Tracker dashboard) render this tab's data in
 * their own layout. Rather than copying the scoring and signal code into them,
 * they read the same cached objects the tab reads, over `/api/analytics/v1/*`.
 * One computation, several front ends: the numbers cannot disagree.
 *
 * This module holds the decisions a route makes before touching data — is the
 * caller allowed, what scope did it ask for — so they can be unit-tested
 * without Next. The routes themselves are in `app/api/analytics/v1/`.
 */

import { timingSafeEqual } from "node:crypto"

export const ANALYTICS_API_VERSION = "v1"

/**
 * Bump when the shape of any response changes in a way a consumer could not
 * ignore (a renamed or removed field, a changed unit). Adding fields does not
 * count. Consumers read this from `/meta` and from every response's `meta`.
 */
export const ANALYTICS_CONTRACT_VERSION = "2026-10-07"

export type AuthDecision = "ok" | "unconfigured" | "unauthorized"

/**
 * `Authorization: Bearer <ANALYTICS_API_KEY>`, compared in constant time.
 *
 * Unlike the cron routes, an unset key does not open the door: the API is
 * reachable from outside the login wall, so "not configured" means closed.
 */
export function authorize(authorizationHeader: string | null, configuredKey: string | undefined): AuthDecision {
  const key = configuredKey?.trim()
  if (!key) return "unconfigured"
  const presented = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!presented) return "unauthorized"
  const a = Buffer.from(presented)
  const b = Buffer.from(key)
  if (a.length !== b.length) return "unauthorized"
  return timingSafeEqual(a, b) ? "ok" : "unauthorized"
}

/**
 * Vercel's cap on a serverless function's response body, on every plan.
 *
 * Crossing it does not truncate — the function fails and the consumer gets an
 * error with no indication that the shape of its request was the cause.
 */
export const RESPONSE_BYTE_LIMIT = 4_500_000

/**
 * Where we refuse rather than risk it.
 *
 * Vercel states the ceiling as "4.5 MB" without saying whether that is
 * 4,500,000 bytes or 4,718,592, so `RESPONSE_BYTE_LIMIT` takes the lower
 * reading and the refusal sits below it. Anything sent is then safe whichever
 * the platform means.
 *
 * It was 4.0 MB until 2026-10-26. The whole-scope national response measured
 * 3.9 MB when the API shipped, 4.02 MB once Seller Likelihood was added, and
 * **4,318,145 bytes (4.12 MB) on 2026-10-26** — over the old refusal, which
 * would have broken AMO Tracker, the one consumer that requests the whole
 * scope in one call. Raised to 4,480,000, the highest value safe under either
 * reading, which leaves that request about 160 KB of room. That is a bridge,
 * not a fix: the response grows as FDIC data arrives, and the durable answer is
 * the consumer requesting by `band=`. `npm run measure:signals-response`
 * reports the live figure against these thresholds.
 */
export const RESPONSE_REFUSE_BYTES = 4_480_000

/** Where it is worth telling a consumer the ceiling is coming. */
export const RESPONSE_WARN_BYTES = 3.5 * 1024 * 1024

export type SizeVerdict = "ok" | "near-limit" | "too-large"

/**
 * Whether a response of this size should be sent.
 *
 * Measured on the serialised body, because that is what the platform limits —
 * a count of rows is not a proxy for it, and the figure that matters is bytes.
 */
export function responseSizeVerdict(bytes: number): SizeVerdict {
  if (bytes >= RESPONSE_REFUSE_BYTES) return "too-large"
  if (bytes >= RESPONSE_WARN_BYTES) return "near-limit"
  return "ok"
}

/** How much of the platform ceiling a response uses, 0–1. */
export function responseSizeShare(bytes: number): number {
  return bytes / RESPONSE_BYTE_LIMIT
}

export function describeBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`
}

export const NATIONAL_SCOPE = "National"

/**
 * The tab passes scope as `"National"` or a state name in title case
 * (`"Florida"`), and that string is part of every cache key. Consumers may
 * send a postal code or any casing; this maps them onto the exact string the
 * tab uses, so a consumer request and a tab visit share one cache entry.
 * Returns null for anything that is not a US state.
 */
export function normalizeScope(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim()
  if (!s || /^(national|us|usa|united states)$/i.test(s)) return NATIONAL_SCOPE
  const byCode = STATE_BY_CODE[s.toUpperCase()]
  if (byCode) return byCode
  const key = s.toLowerCase().replace(/\s+/g, " ")
  return STATE_NAMES.find((n) => n.toLowerCase() === key) ?? null
}

/** FDIC certificate numbers are positive integers; anything else is rejected before any fetch. */
export function normalizeCert(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim()
  return /^\d{1,7}$/.test(s) ? String(Number(s)) : null
}

export const STATE_BY_CODE: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
}

export const STATE_NAMES: readonly string[] = Object.values(STATE_BY_CODE)

/** The envelope every data response carries, so a consumer can label what it shows. */
export type ApiMeta = {
  apiVersion: typeof ANALYTICS_API_VERSION
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION
  /** The FDIC quarter the cached object was computed for, `YYYYMMDD`. */
  quarter: string
  /** Exactly the scope string used in the cache key, when the endpoint is scoped. */
  scope?: string
  /** When this response was assembled; the cached object itself may be up to seven days older. */
  servedAt: string
  source: "FDIC BankFind Call Report data, computed by Market Intelligence"
}

export function buildMeta(quarter: string, scope?: string): ApiMeta {
  return {
    apiVersion: ANALYTICS_API_VERSION,
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    quarter,
    ...(scope ? { scope } : {}),
    servedAt: new Date().toISOString(),
    source: "FDIC BankFind Call Report data, computed by Market Intelligence",
  }
}
