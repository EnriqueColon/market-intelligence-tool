"use server"

import { classifyArticleAccess, type AccessStatus, KNOWN_PAYWALL_DOMAINS } from "@/app/actions/news-access"

export type NewsItem = {
  title: string
  url: string
  resolved_url?: string
  source: string
  date: string
  summary: string
  access_status?: AccessStatus
  http_status?: number
  content_length_chars?: number
  extracted_text_length_chars?: number
  detection_reason?: string
  summarization_mode?: "full_summary" | "intelligence_brief" | "paywall_signal"
  confidence_label?: "High" | "Medium" | "Low"
}

const MAX_NEWS_HEADLINES = 20
const MAX_AGE_DAYS = 7
const RSS_TIMEOUT_MS = 25_000
const GDELT_TIMEOUT_MS = 25_000
const MAX_CANDIDATES_PRE_CLASSIFY = 160
const MAX_CLASSIFY_INITIAL = 40
const MAX_CLASSIFY_HARD = 120
const CLASSIFY_CONCURRENCY = 4
const GDELT_MAX_RECORDS = 250

const MIN_OPENISH_TARGET = 10
const GDELT_ENABLE_IF_FEEDS_LT = 10
const GDELT_MAX_INCLUDE = 7

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

function domainMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

function isKnownPaywallUrl(url: string) {
  const host = hostOf(url)
  return (KNOWN_PAYWALL_DOMAINS as readonly string[]).some((d) => domainMatches(host, d))
}

function normalizeTitleForKey(title: string) {
  return (title || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function dayBucketFromDate(dateStr?: string) {
  const ms = parseDateToMs(dateStr)
  if (ms === null) return null
  return Math.floor(ms / 86400000)
}

function normalizeUrlForKey(url: string) {
  const raw = (url || "").trim()
  if (!raw) return ""
  try {
    const u = new URL(raw)
    u.hash = ""
    // Strip common tracking params to improve de-dupe.
    const dropPrefixes = ["utm_", "utm-", "fbclid", "gclid", "mc_cid", "mc_eid", "cmpid"]
    const keys = Array.from(u.searchParams.keys())
    for (const k of keys) {
      const lk = k.toLowerCase()
      if (dropPrefixes.some((p) => lk.startsWith(p))) u.searchParams.delete(k)
    }
    // Normalize host + trailing slash.
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase()
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1)
    return u.toString()
  } catch {
    return raw
  }
}

function dedupeKey(it: Pick<NewsItem, "url" | "resolved_url" | "title" | "source">) {
  const byUrl = normalizeUrlForKey(it.resolved_url || "") || normalizeUrlForKey(it.url || "")
  if (byUrl) return `u:${byUrl}`
  const t = normalizeTitleForKey(it.title || "")
  const s = (it.source || "").trim().toLowerCase()
  return `t:${s}:${t}`
}

function hasUsMarkerText(text: string) {
  const t = (text || "").toLowerCase()
  return (
    /\bu\.s\.\b|\bunited states\b|\bamerica\b|\bus\b|\busa\b|\bamerican\b/.test(t) ||
    /\bnew york\b|\bnyc\b|\bchicago\b|\blos angeles\b|\bmiami\b|\bflorida\b|\btexas\b|\bcalifornia\b/.test(t)
  )
}

function strongDistressKeyword(text: string) {
  const t = (text || "").toLowerCase()
  return /\bcmbs\b|special servicing|delinquen|default|nonaccrual|note sale|loan sale|receivership|workout|foreclos|commercial mortgage|maturity wall|refinanc/.test(
    t
  )
}

function hasNonLatinChars(title: string) {
  const s = (title || "").trim()
  if (!s) return false
  // Allow Latin-extended letters + common punctuation; reject other scripts.
  return /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/u.test(s)
}

function hasForeignCurrency(text: string) {
  const t = (text || "").toLowerCase()
  // Reject common foreign currency symbols/codes.
  return /£|€|₽|₩|¥|\bgbp\b|\beur\b|\brub\b|\bkrw\b|\bjpy\b|\bcny\b/.test(t)
}

function hasObviousNonUsGeo(text: string) {
  const t = (text || "").toLowerCase()
  // Strong non‑US geo markers (not exhaustive; intended to catch obvious leaks).
  return (
    /\bcanada\b|\bedmonton\b|\balberta\b|\bontario\b|\btoronto\b|\bvancouver\b|\bottawa\b|\bmontreal\b/.test(t) ||
    /\buk\b|\bunited kingdom\b|\bbritain\b|\bbritish\b|\bengland\b|\bscotland\b|\bwales\b|\bnorthern ireland\b|\blondon\b|\bmanchester\b|\bbirmingham\b/.test(
      t
    ) ||
    /\baustralia\b|\bsydney\b|\bmelbourne\b|\bperth\b|\bbrisbane\b/.test(t) ||
    /\bireland\b|\bdublin\b/.test(t) ||
    /\bgermany\b|\bberlin\b|\bfrance\b|\bparis\b|\bitaly\b|\brome\b|\bspain\b|\bmadrid\b/.test(t) ||
    /\bjapan\b|\btokyo\b|\bkorea\b|\bseoul\b|\brussia\b|\bmoscow\b|\bukraine\b|\bkyiv\b|\bchina\b|\bbeijing\b|\bshanghai\b|\bhong kong\b/.test(t)
  )
}

function hasCreKeyword(text: string) {
  const t = (text || "").toLowerCase()
  return (
    /\boffice\b|\bretail\b|\bindustrial\b|\bmultifamily\b|\bwarehouse\b|\bproperty\b|\breal estate\b|\bcre\b|\bcmbs\b|\bcommercial mortgage\b|\bcommercial real estate\b/.test(
      t
    )
  )
}

function hasConsumerPersonalContext(text: string) {
  const t = (text || "").toLowerCase()
  if (/gofundme|go fund me|animal rescue|pet rescue|fitness|workout plan|lifestyle|recipe|diet\b/.test(t)) return true
  if (/student loan|credit card|auto loan|car loan|personal loan|payday loan|medical debt|criminal debt\b/.test(t)) return true
  if (/pension|retirement fund|social security\b/.test(t)) return true
  if (/\btaxes?\b/.test(t) && !/property tax|real estate tax|transfer tax|stamp duty\b/.test(t)) return true
  if (/school|university|college|campus|education facility\b/.test(t)) return true
  // "foreclosure" can be consumer-focused; reject if clearly personal/residential.
  if (/foreclos/.test(t) && /homeowner|residential|single-family|family home|mortgage help|eviction\b/.test(t)) return true
  return false
}

function parseDateToMs(dateStr?: string) {
  const raw = (dateStr || "").trim()
  if (!raw) return null
  const s = raw.toLowerCase().trim()

  const now = Date.now()
  if (s === "today") return now
  if (s === "yesterday") return now - 1 * 86400000

  // GDELT timestamps: YYYYMMDDhhmmss or YYYYMMDD
  if (/^\d{14}$/.test(raw)) {
    const yyyy = Number(raw.slice(0, 4))
    const mm = Number(raw.slice(4, 6))
    const dd = Number(raw.slice(6, 8))
    const hh = Number(raw.slice(8, 10))
    const mi = Number(raw.slice(10, 12))
    const ss = Number(raw.slice(12, 14))
    if ([yyyy, mm, dd, hh, mi, ss].every((n) => Number.isFinite(n))) {
      const ms = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss)
      return Number.isNaN(ms) ? null : ms
    }
  }
  if (/^\d{8}$/.test(raw)) {
    const yyyy = Number(raw.slice(0, 4))
    const mm = Number(raw.slice(4, 6))
    const dd = Number(raw.slice(6, 8))
    if ([yyyy, mm, dd].every((n) => Number.isFinite(n))) {
      const ms = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0)
      return Number.isNaN(ms) ? null : ms
    }
  }
  // GDELT seendate format: YYYYMMDDThhmmssZ
  if (/^\d{8}t\d{6}z$/.test(s)) {
    const yyyy = Number(s.slice(0, 4))
    const mm = Number(s.slice(4, 6))
    const dd = Number(s.slice(6, 8))
    const hh = Number(s.slice(9, 11))
    const mi = Number(s.slice(11, 13))
    const ss = Number(s.slice(13, 15))
    if ([yyyy, mm, dd, hh, mi, ss].every((n) => Number.isFinite(n))) {
      const ms = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss)
      return Number.isNaN(ms) ? null : ms
    }
  }

  const rel = s.match(/^(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)(?:\s*ago)?$/)
  if (rel) {
    const n = Number(rel[1] || "0")
    const unit = rel[2]
    if (!Number.isFinite(n)) return null
    const mult =
      unit.startsWith("minute") ? 60_000 : unit.startsWith("hour") ? 3_600_000 : unit.startsWith("week") ? 7 * 86400000 : 86400000
    return now - n * mult
  }

  // Common formats: ISO date, RFC date, "Jan 10, 2026", etc.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ms = Date.parse(`${raw}T00:00:00Z`)
    return Number.isNaN(ms) ? null : ms
  }

  // "Jan 28" (no year) → assume current year.
  if (/^[a-z]{3,9}\s+\d{1,2}$/.test(s)) {
    const year = new Date().getUTCFullYear()
    const ms = Date.parse(`${raw} ${year}`)
    return Number.isNaN(ms) ? null : ms
  }

  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : ms
}

function isWithinLastDays(dateStr: string | undefined, days: number) {
  const ms = parseDateToMs(dateStr)
  if (ms === null) return false
  const now = Date.now()
  if (ms > now + 60_000) return false
  return now - ms <= days * 86400000
}

function relevanceScore(item: Pick<NewsItem, "title" | "summary" | "source">) {
  const text = `${item.title || ""} ${item.summary || ""} ${item.source || ""}`.toLowerCase()
  const rules: Array<[RegExp, number]> = [
    [/special servic/i, 5],
    [/delinquen|default|nonaccrual/i, 4],
    [/cmbs|bs note|bond/i, 4],
    [/foreclos|repossession/i, 4],
    [/distress|troubled|workout|restructur|recapital/i, 3],
    [/note sale|loan sale|debt sale/i, 3],
    [/maturity wall|refinanc/i, 2],
    [/office|retail|multifamily|industrial/i, 1],
  ]
  let score = 0
  for (const [re, w] of rules) {
    if (re.test(text)) score += w
  }
  return score
}

function pickTop(items: NewsItem[]) {
  // Prefer usable sources: open > partial > paywalled (signals).
  const withScore = items.map((x) => {
    const access = x.access_status || "paywalled"
    const accessRank = access === "open" ? 3 : access === "partial" ? 2 : 0
    const paywallPenalty = isKnownPaywallUrl(x.resolved_url || x.url) ? 1 : 0
    const score = accessRank * 100 + relevanceScore(x) - paywallPenalty * 5
    return { x, score, access }
  })

  const openish = withScore
    .filter((r) => r.access !== "paywalled")
    .sort((a, b) => b.score - a.score)
    .map((r) => r.x)

  const paywalled = withScore
    .filter((r) => r.access === "paywalled")
    .sort((a, b) => b.score - a.score)
    .map((r) => r.x)

  const out: NewsItem[] = []
  const seen = new Set<string>()

  const push = (arr: NewsItem[], max = MAX_NEWS_HEADLINES) => {
    for (const it of arr) {
      if (out.length >= max) break
      const key = dedupeKey(it)
      if (!key) continue
      if (seen.has(key)) continue
      seen.add(key)
      out.push(it)
    }
  }

  // Always prefer open/partial.
  push(openish)

  // If we couldn't get enough open/partial, fill remainder with paywalled signals.
  if (out.length < MIN_OPENISH_TARGET) push(paywalled, MAX_NEWS_HEADLINES)

  // Otherwise, we already have a strong open/partial set; optionally top-up to 20 with paywalled.
  if (out.length < MAX_NEWS_HEADLINES) push(paywalled, MAX_NEWS_HEADLINES)

  return out
}

function normalizeDate(date?: string) {
  if (!date) return ""
  const raw = String(date).trim()
  // Normalize GDELT timestamps to YYYY-MM-DD for consistent display.
  if (/^\d{14}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  if (/^\d{8}T\d{6}Z$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toISOString().slice(0, 10)
}

function extractTag(block: string, tag: string) {
  const pattern = `<(?:[a-zA-Z0-9]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`
  const match = block.match(new RegExp(pattern, "i"))
  if (!match) return ""
  return match[1].replace(/<!\\[CDATA\\[(.*?)\\]\\]>/g, "$1").trim()
}

function decodeHtmlEntities(value: string) {
  // Minimal, dependency-free decode for common RSS encodings.
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16))
      } catch {
        return ""
      }
    })
    .replace(/&#([0-9]+);/g, (_m, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10))
      } catch {
        return ""
      }
    })
}

function stripHtml(value?: string) {
  if (!value) return ""
  const decoded = decodeHtmlEntities(value)
  const withoutTags = decoded.replace(/<[^>]*>/g, " ")
  return withoutTags.replace(/\s+/g, " ").trim()
}

function stripHtmlToText(value?: string) {
  if (!value) return ""
  const decoded = decodeHtmlEntities(value)
  const withoutScripts = decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
  const withoutTags = withoutScripts.replace(/<[^>]*>/g, " ")
  return withoutTags.replace(/\s+/g, " ").trim()
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers((init as any)?.headers || undefined)
    // Some feeds block unknown user agents.
    if (!headers.has("User-Agent")) headers.set("User-Agent", "MarketIntelligence/1.0 (news-fetch@marketintel.local)")
    if (!headers.has("Accept")) headers.set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8")
    if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en-US,en;q=0.9")
    return await fetch(input, { ...init, headers, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

type FeedSpec = {
  name: string
  url: string
  kind: "rss" | "atom" | "guess"
  level: "national" | "florida" | "miami"
}

function isLikelyUkUrl(url: string) {
  const host = hostOf(url)
  if (!host) return false
  return (
    host.endsWith(".uk") ||
    host.endsWith(".co.uk") ||
    host.endsWith(".ac.uk") ||
    host.endsWith(".gov.uk") ||
    /(^|\.)bbc\.co\.uk$/.test(host) ||
    /(^|\.)ft\.com$/.test(host) // FT is heavily UK/EU-focused and paywalled anyway
  )
}

function isLikelyNonUsTldUrl(url: string) {
  const host = hostOf(url)
  if (!host) return false
  const nonUsTlds = [".ca", ".au", ".ie", ".nz", ".za", ".in", ".uk"] as const
  return nonUsTlds.some((tld) => host.endsWith(tld))
}

function passesNationalUsFilter(item: Pick<NewsItem, "title" | "summary" | "url" | "source">) {
  const title = (item.title || "").toLowerCase()
  const summary = (item.summary || "").toLowerCase()
  const source = (item.source || "").toLowerCase()
  const text = `${title} ${summary} ${source}`

  const hasUsMarker =
    /\bu\.s\.\b|\bunited states\b|\bamerica\b|\bus\b|\busa\b|\bamerican\b/.test(text) ||
    /\bnew york\b|\bnyc\b|\bchicago\b|\blos angeles\b|\bmiami\b|\bflorida\b|\btexas\b|\bcalifornia\b/.test(text)

  const hasNonUsMarker =
    /£|€|\bgbp\b|\beur\b/.test(text) ||
    /\bcanada\b|\bedmonton\b|\balberta\b|\bontario\b|\btoronto\b|\bvancouver\b/.test(text) ||
    /\baldemore\b|\buk mortgage\b/.test(text) ||
    /\baustralia\b|\bsydney\b|\bmelbourne\b|\bperth\b|\bbrisbane\b/.test(text)

  const hasUkMarker =
    /\buk\b|\bunited kingdom\b|\bbritain\b|\bbritish\b|\bengland\b|\bscotland\b|\bwales\b|\bnorthern ireland\b|\blondon\b|\bmanchester\b|\bbirmingham\b/.test(
      text
    )

  if (isLikelyUkUrl(item.url || "")) return hasUsMarker
  if (isLikelyNonUsTldUrl(item.url || "")) return hasUsMarker
  if (hasNonUsMarker && !hasUsMarker) return false
  if (hasUkMarker && !hasUsMarker) return false
  return true
}

function feedsForLevel(level: "national" | "florida" | "miami"): FeedSpec[] {
  const withWhen = (q: string) => `${q} when:7d`
  const googleQueries: Record<
    "national" | "florida" | "miami",
    Array<{ name: string; q: string }>
  > = {
    national: [
      {
        name: "Google: Distress/servicing",
        q: withWhen(
          '("special servicing" OR delinquency OR CMBS OR "note sale" OR "loan sale" OR foreclosure OR receivership OR workout OR "distressed debt") ("commercial real estate" OR CRE OR office OR retail OR multifamily OR industrial) ("United States" OR U.S. OR US) -UK -Britain -British -England -Scotland -Wales -London'
        ),
      },
      {
        name: "Google: CMBS/servicing indicators",
        q: withWhen(
          '("CMBS delinquency" OR "CMBS default" OR "special servicing" OR nonaccrual OR servicer OR "commercial mortgage") ("commercial real estate" OR "commercial mortgage" OR CRE OR office OR retail OR multifamily) ("United States" OR U.S. OR US) -UK -Britain -British -England -Scotland -Wales -London'
        ),
      },
      {
        name: "Google: Big landlord distress",
        q: withWhen(
          '(office OR retail OR multifamily) (distress OR "debt sale" OR "loan sale" OR foreclosure OR receivership) ("commercial real estate" OR CRE) ("United States" OR U.S. OR US) -UK -Britain -British -England -Scotland -Wales -London'
        ),
      },
    ],
    florida: [
      {
        name: "Google: FL distress/servicing",
        q: withWhen(
          '("special servicing" OR delinquency OR CMBS OR "note sale" OR "loan sale" OR foreclosure OR receivership OR workout OR "distressed debt") ("commercial real estate" OR CRE OR office OR retail OR multifamily OR industrial) (Florida OR Miami OR Tampa OR Orlando OR Jacksonville OR "Fort Lauderdale")'
        ),
      },
      {
        name: "Google: FL CMBS/servicing indicators",
        q: withWhen(
          '("CMBS delinquency" OR "CMBS default" OR "special servicing" OR nonaccrual OR servicer) (Florida OR Miami OR Tampa OR Orlando OR Jacksonville OR "Fort Lauderdale") ("commercial real estate" OR "commercial mortgage" OR CRE OR office OR retail OR multifamily)'
        ),
      },
    ],
    miami: [
      {
        name: "Google: Miami distress/servicing",
        q: withWhen(
          '("special servicing" OR delinquency OR CMBS OR "note sale" OR "loan sale" OR foreclosure OR receivership OR workout OR "distressed debt") ("commercial real estate" OR CRE OR office OR retail OR multifamily OR industrial) (Miami OR "Miami-Dade" OR Brickell OR "Miami Beach" OR "Fort Lauderdale" OR Broward OR Doral)'
        ),
      },
      {
        name: "Google: Miami CMBS/servicing indicators",
        q: withWhen(
          '("CMBS delinquency" OR "CMBS default" OR "special servicing" OR nonaccrual OR servicer) (Miami OR "Miami-Dade" OR Brickell OR "Miami Beach" OR "Fort Lauderdale" OR Broward OR Doral) ("commercial real estate" OR "commercial mortgage" OR CRE OR office OR retail OR multifamily)'
        ),
      },
    ],
  }
  const googleUrl = (q: string) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`

  const globest = {
    national: "https://feeds.feedblitz.com/globest/national",
    southeast: "https://feeds.feedblitz.com/globest/southeast",
    miami: "https://feeds.feedblitz.com/globest/miami",
  } as const

  const trd = "https://feeds.feedburner.com/trdnews?format=xml"
  const sfbj = "https://feeds.bizjournals.com/bizj_southflorida"

  const base: FeedSpec[] = [
    ...googleQueries[level].map((qq) => ({ name: qq.name, url: googleUrl(qq.q), kind: "rss" as const, level })),
    { name: "GlobeSt National", url: globest.national, kind: "rss", level },
    { name: "The Real Deal", url: trd, kind: "rss", level },
  ]

  if (level === "national") return base
  if (level === "florida") {
    return [
      { name: "GlobeSt Southeast", url: globest.southeast, kind: "rss", level },
      { name: "South Florida Business Journal", url: sfbj, kind: "rss", level },
      ...base,
    ]
  }
  return [
    { name: "GlobeSt Miami", url: globest.miami, kind: "rss", level },
    { name: "South Florida Business Journal", url: sfbj, kind: "rss", level },
    ...base,
  ]
}

function geoBoost(level: "national" | "florida" | "miami", item: Pick<NewsItem, "title" | "summary" | "url" | "source">) {
  if (level === "national") return 0
  const text = `${(item.title || "").toLowerCase()} ${(item.summary || "").toLowerCase()} ${(item.source || "").toLowerCase()} ${(item.url || "").toLowerCase()}`
  if (level === "florida") {
    return /florida|miami|tampa|orlando|jacksonville|fort lauderdale|broward|palm beach|west palm/i.test(text) ? 10 : 0
  }
  return /miami|miami-dade|brickell|miami beach|fort lauderdale|broward|palm beach|coral gables|doral/i.test(text) ? 12 : 0
}

function isGarbageItem(item: Pick<NewsItem, "title" | "summary" | "url" | "source">) {
  const url = (item.url || "").toLowerCase()
  const title = (item.title || "").toLowerCase()
  const summary = (item.summary || "").toLowerCase()
  const text = `${title} ${summary}`

  // Hard excludes: entertainment, generic stock-picking, FX/currency watchlists, etc.
  // We keep this short and targeted to avoid false negatives on real CRE stories.
  if (
    /\bimdb\b|box office|oscars|kollywood|bollywood|demon slayer|streaming|avatar:|movie|film\b/.test(text) ||
    /stocks to add to your watchlist|best retail stocks|electric vehicle stocks|defense world/.test(text) ||
    /\bfx\b|currency watchlist|won volatility|treasury fx watchlist/.test(text) ||
    /imdb\.com|defenseworld\.net|stocktitan\.net/.test(url)
  ) {
    return true
  }

  return false
}

function passesUsOnlyGate(level: "national" | "florida" | "miami", item: Pick<NewsItem, "title" | "summary" | "url" | "source">) {
  // Enforce US-only strictly for National.
  if (level === "national") return passesNationalUsFilter(item)
  // Florida/Miami: do NOT require explicit US markers; rely on currency/geo/TLD rejection inside hard prefilter.
  return true
}

function passesHardPreFilter(
  level: "national" | "florida" | "miami",
  item: Pick<NewsItem, "title" | "summary" | "url" | "source">,
  opts?: { origin?: "gdelt" | "rss" }
) {
  const origin = opts?.origin || "rss"
  const title = (item.title || "").trim()
  const summary = (item.summary || "").trim()
  const source = (item.source || "").trim()
  const url = (item.url || "").trim()
  const text = `${title} ${summary} ${source} ${url}`.toLowerCase()

  // 1) Language filter: reject non-Latin titles (especially for GDELT).
  if (title && hasNonLatinChars(title)) return false

  // 2) Geography filter: enforce US-only. Reject foreign currencies and obvious non‑US geo unless strong US markers exist.
  if (!passesUsOnlyGate(level, item)) return false
  const hasUs = hasUsMarkerText(text)
  if (hasForeignCurrency(text) && !hasUs) return false
  if (hasObviousNonUsGeo(text) && !hasUs) return false
  if (isLikelyNonUsTldUrl(url) && !hasUs) return false

  // 3) CRE filter:
  // - RSS: allow either CRE keywords OR strong distress/CMBS signals (many headlines omit "real estate" explicitly).
  // - GDELT: keep strict (CRE keyword required + strong distress below).
  if (origin === "rss") {
    if (!(hasCreKeyword(text) || strongDistressKeyword(text))) return false
  } else {
    if (!hasCreKeyword(text)) return false
  }

  // 4) Consumer/personal hard excludes.
  if (hasConsumerPersonalContext(text)) return false

  // Additional tightening for GDELT: require at least one distress/CRE-debt signal.
  if (origin === "gdelt") {
    if (!strongDistressKeyword(text)) {
      return false
    }
  }

  return true
}

function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string; source: string; description: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; source: string; description: string }> = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(xml))) {
    const block = m[1]
    const title = extractTag(block, "title") || "Untitled"
    const link = extractTag(block, "link") || ""
    const pubDate = extractTag(block, "pubDate") || ""
    const source = extractTag(block, "source") || ""
    const description = extractTag(block, "description") || ""
    items.push({ title, link, pubDate, source, description })
  }
  return items
}

function parseAtomItems(xml: string): Array<{ title: string; link: string; updated: string; source: string; summary: string }> {
  const out: Array<{ title: string; link: string; updated: string; source: string; summary: string }> = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = entryRegex.exec(xml))) {
    const block = m[1]
    const title = extractTag(block, "title") || "Untitled"
    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/i)
    const link = linkMatch ? linkMatch[1] : ""
    const updated = extractTag(block, "updated") || extractTag(block, "published") || ""
    const source = extractTag(block, "source") || ""
    const summary = extractTag(block, "summary") || extractTag(block, "content") || ""
    out.push({ title, link, updated, source, summary })
  }
  return out
}

async function fetchFeed(spec: FeedSpec): Promise<NewsItem[]> {
  try {
    const res = await fetchWithTimeout(spec.url, { next: { revalidate: 900 } } as unknown as RequestInit, RSS_TIMEOUT_MS)
    if (!res.ok) {
      console.warn("news_fetch: feed non-OK", { feed: spec.name, url: spec.url, status: res.status })
      return []
    }
    const xml = await res.text()
    if (!xml || xml.length < 50) {
      console.warn("news_fetch: feed empty body", { feed: spec.name, url: spec.url })
      return []
    }
    const lower = xml.slice(0, 400).toLowerCase()
    const kind =
      spec.kind !== "guess"
        ? spec.kind
        : lower.includes("<feed") && lower.includes("http://www.w3.org/2005/atom")
          ? "atom"
          : "rss"

    const items: NewsItem[] = []
    if (kind === "atom") {
      for (const e of parseAtomItems(xml)) {
        const dateRaw = e.updated || ""
        const date = normalizeDate(dateRaw) || ""
        if (!isWithinLastDays(dateRaw || date, MAX_AGE_DAYS)) continue
        items.push({
          title: stripHtmlToText(e.title) || "Untitled",
          url: (e.link || "").trim(),
          source: stripHtmlToText(e.source) || spec.name,
          date,
          summary: stripHtmlToText(e.summary) || "—",
        })
      }
    } else {
      for (const it of parseRssItems(xml)) {
        const dateRaw = it.pubDate || ""
        const date = normalizeDate(dateRaw) || ""
        if (!isWithinLastDays(dateRaw || date, MAX_AGE_DAYS)) continue
        items.push({
          title: stripHtmlToText(it.title) || "Untitled",
          url: (it.link || "").trim(),
          source: stripHtmlToText(it.source) || spec.name,
          date,
          summary: stripHtmlToText(it.description) || "—",
        })
      }
    }
    return items.filter((x) => x.url && x.title)
  } catch (err) {
    console.warn("news_fetch: feed fetch failed", { feed: spec.name, url: spec.url, err })
    return []
  }
}

async function fetchGdelt(level: "national" | "florida" | "miami"): Promise<NewsItem[]> {
  // GDELT DOC 2.0 API (open). NOTE: We keep query broad and rely on relevance scoring + dedupe.
  const q =
    level === "national"
      ? '("special servicing" OR delinquency OR CMBS OR "note sale" OR "loan sale" OR foreclosure OR receivership OR workout OR "distressed debt") ("commercial real estate" OR CRE OR office OR retail OR multifamily OR industrial)'
      : level === "florida"
        ? '("special servicing" OR delinquency OR CMBS OR "note sale" OR "loan sale" OR foreclosure OR receivership OR workout OR "distressed debt") ("commercial real estate" OR CRE OR office OR retail OR multifamily OR industrial) (Florida OR Miami OR Tampa OR Orlando OR Jacksonville OR "Fort Lauderdale")'
        : '("special servicing" OR delinquency OR CMBS OR "note sale" OR "loan sale" OR foreclosure OR receivership OR workout OR "distressed debt") ("commercial real estate" OR CRE OR office OR retail OR multifamily OR industrial) (Miami OR "Miami-Dade" OR Brickell OR "Miami Beach" OR "Fort Lauderdale" OR Broward OR Doral)'

  const end = new Date()
  const start = new Date(Date.now() - MAX_AGE_DAYS * 86400000)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(
      d.getUTCHours()
    ).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}${String(d.getUTCSeconds()).padStart(2, "0")}`

  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?" +
    new URLSearchParams({
      query: q,
      mode: "ArtList",
      format: "json",
      maxrecords: String(GDELT_MAX_RECORDS),
      startdatetime: fmt(start),
      enddatetime: fmt(end),
      // Bias towards US sources; still allows broader pickup.
      sourceCountry: "US",
      sort: "HybridRel",
    }).toString()

  try {
    const res = await fetchWithTimeout(url, { cache: "no-store" } as unknown as RequestInit, GDELT_TIMEOUT_MS)
    if (!res.ok) {
      console.warn("news_fetch: gdelt non-OK", { level, status: res.status })
      return []
    }
    const data = (await res.json()) as any
    const articles: any[] = Array.isArray(data?.articles) ? data.articles : []
    const out: NewsItem[] = []
    if (articles.length === 0) {
      console.warn("news_fetch: gdelt empty", { level })
    }
    for (const a of articles) {
      const title = typeof a?.title === "string" ? a.title : ""
      const link = typeof a?.url === "string" ? a.url : ""
      const source = typeof a?.sourceCollection === "string" ? a.sourceCollection : typeof a?.sourceCountry === "string" ? a.sourceCountry : ""
      const seendate = typeof a?.seendate === "string" ? a.seendate : ""
      const date = normalizeDate(seendate) || normalizeDate(a?.datetime) || ""
      const summary = typeof a?.summary === "string" ? a.summary : ""
      if (!title || !link) continue
      if (date && !isWithinLastDays(date, MAX_AGE_DAYS)) continue
      out.push({
        title: stripHtmlToText(title),
        url: link,
        source: stripHtmlToText(source) || "GDELT",
        date: date || "",
        summary: stripHtmlToText(summary) || "—",
      })
    }
    return out
  } catch (err) {
    console.warn("news_fetch: gdelt fetch failed", { level, err })
    return []
  }
}

export async function fetchNewsHeadlines(level: "national" | "florida" | "miami"): Promise<NewsItem[]> {
  try {
    const feeds = feedsForLevel(level)
    const feedLists = await Promise.all(feeds.map((f) => fetchFeed(f)))
    const feedItems = feedLists.flat()

    const normalizedFeeds = feedItems
      .map((x) => ({
        ...x,
        title: stripHtmlToText(x.title),
        summary: stripHtmlToText(x.summary),
        url: (x.url || "").trim(),
        source: (x.source || "").trim() || "Unknown",
      }))
      .filter((x) => x.url && x.title)

    // Build feedCandidates using hard prefilters BEFORE ranking.
    const feedSeen = new Set<string>()
    const feedCandidates: NewsItem[] = []
    for (const it of normalizedFeeds) {
      const k = dedupeKey(it)
      if (feedSeen.has(k)) continue
      if (it.date && !isWithinLastDays(it.date, MAX_AGE_DAYS)) continue
      if (isGarbageItem(it)) continue
      if (!passesHardPreFilter(level, it, { origin: "rss" })) continue
      feedSeen.add(k)
      feedCandidates.push(it)
      if (feedCandidates.length >= MAX_CANDIDATES_PRE_CLASSIFY) break
    }

    // Only include GDELT when feedCandidates are sparse (true fallback AFTER feed filtering).
    const gdeltRaw = feedCandidates.length < GDELT_ENABLE_IF_FEEDS_LT ? await fetchGdelt(level) : []
    const normalizedGdelt = gdeltRaw
      .map((x) => ({
        ...x,
        title: stripHtmlToText(x.title),
        summary: stripHtmlToText(x.summary),
        url: (x.url || "").trim(),
        source: (x.source || "").trim() || "GDELT",
      }))
      .filter((x) => x.url && x.title)
      .filter((x) => passesHardPreFilter(level, x, { origin: "gdelt" }))
      .slice(0, GDELT_MAX_INCLUDE)

    const flattened: NewsItem[] = [...feedCandidates, ...normalizedGdelt]

    console.info("news_fetch: stage counts", {
      level,
      feedParsed: normalizedFeeds.length,
      feedCandidates: feedCandidates.length,
      gdelt: normalizedGdelt.length,
      total: flattened.length,
    })

    console.info("news_fetch: gathered candidates", {
      level,
      gdelt: normalizedGdelt.length,
      feeds: normalizedFeeds.length,
      total: flattened.length,
    })

    const candidates = flattened.slice(0, MAX_CANDIDATES_PRE_CLASSIFY)

    // Never return empty unless there is truly no data after US-only + basic garbage filtering.
    if (candidates.length === 0) {
      console.warn("news_fetch: no candidates after basic filtering", { level, flattened: flattened.length })
      return []
    }

    // Rank first (CRE distress relevance), then classify, then select by level preference (geo boost).
    const scoreFor = (x: NewsItem, useGeo: boolean) => {
      const text = `${x.title || ""} ${x.summary || ""} ${x.source || ""}`.toLowerCase()
      const creHint = /\bcre\b|commercial real estate|commercial mortgage|office|retail|multifamily|industrial|hotel|hospitality/i.test(text) ? 1 : 0
      return relevanceScore(x) + creHint + (useGeo ? geoBoost(level, x) : 0)
    }
    const rank = (useGeo: boolean) =>
      candidates
        .map((x) => ({ x, score: scoreFor(x, useGeo) }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.x)

    // Classify in bounded batches. If we don't get enough open/partial, classify deeper.
    const classifyRanked = async (ranked: NewsItem[]) => {
      const classifiedAll: NewsItem[] = []
      let openishCount = 0
      for (let offset = 0; offset < Math.min(MAX_CLASSIFY_HARD, ranked.length); offset += MAX_CLASSIFY_INITIAL) {
        const batch = ranked.slice(offset, offset + MAX_CLASSIFY_INITIAL)
        if (!batch.length) break
        const classifiedBatch = await classifyItems(batch)
        classifiedAll.push(...classifiedBatch)
        openishCount = classifiedAll.filter((x) => x.access_status !== "paywalled").length
        // If first slices yield <10 usable (open/partial), classify deeper (bounded).
        if (openishCount >= MIN_OPENISH_TARGET) break
      }
      return classifiedAll
    }

    // Prefer geo-local items for FL/Miami via ranking boost, but don't hard-exclude non-local.
    const rankedPrimary = rank(true)
    let classifiedAll = await classifyRanked(rankedPrimary)

    // If final results are still thin, relax geo preference entirely (still US-only + distress relevance).
    let selected = pickTop(classifiedAll)
    if ((level === "florida" || level === "miami") && selected.length < 10) {
      const rankedRelaxed = rank(false)
      classifiedAll = await classifyRanked(rankedRelaxed)
      selected = pickTop(classifiedAll)
    }

    // Final selection + near-duplicate de-dupe (same normalized title, same day or ±1 day).
    const out: NewsItem[] = []
    const byTitleDay = new Set<string>()
    for (const it of selected) {
      const t = normalizeTitleForKey(it.title || "")
      const b = dayBucketFromDate(it.date || "")
      if (t && b !== null) {
        const k0 = `${t}:${b}`
        const k1 = `${t}:${b - 1}`
        const k2 = `${t}:${b + 1}`
        if (byTitleDay.has(k0) || byTitleDay.has(k1) || byTitleDay.has(k2)) continue
        byTitleDay.add(k0)
      }
      out.push(it)
    }
    // Never return empty unless candidates are truly empty (handled above).
    if (out.length === 0) return candidates.slice(0, Math.min(10, candidates.length))
    return out
  } catch (error) {
    console.error("Error fetching news from open sources:", error)
    return []
  }
}

async function classifyItems(items: NewsItem[]): Promise<NewsItem[]> {
  const limit = CLASSIFY_CONCURRENCY
  let idx = 0
  const out: NewsItem[] = new Array(items.length)

  const treatAsPartialWhenUnverifiable = (opts: {
    item: NewsItem
    url: string
    resolved_url?: string
    reason: string
  }) => {
    const finalUrl = normalizeUrlForKey(opts.resolved_url || opts.item.resolved_url || opts.url)
    // If we cannot verify access due to fetch/network limitations, default to "partial"
    // unless it’s a known paywall domain (keep those as paywalled).
    if (isKnownPaywallUrl(finalUrl)) {
      return {
        ...opts.item,
        access_status: "paywalled" as const,
        resolved_url: finalUrl,
        http_status: 0,
        content_length_chars: 0,
        extracted_text_length_chars: 0,
        detection_reason: opts.reason,
        summarization_mode: "paywall_signal" as const,
        confidence_label: "Low" as const,
      }
    }
    return {
      ...opts.item,
      access_status: "partial" as const,
      resolved_url: finalUrl,
      http_status: 0,
      content_length_chars: 0,
      extracted_text_length_chars: 0,
      detection_reason: opts.reason,
      summarization_mode: "intelligence_brief" as const,
      confidence_label: "Low" as const,
    }
  }

  const worker = async () => {
    while (idx < items.length) {
      const i = idx
      idx += 1
      const item = items[i]
      const url = (item?.url || "").trim()
      if (!url) {
        out[i] = {
          ...item,
          access_status: "partial",
          http_status: 0,
          content_length_chars: 0,
          extracted_text_length_chars: 0,
          detection_reason: "missing_url",
          summarization_mode: "intelligence_brief",
          confidence_label: "Medium",
        }
        continue
      }
      try {
        const c = await classifyArticleAccess({ url, title: item.title, includeExtractedText: false })
        // If we cannot fetch/inspect the page (network blocked, bot challenge, etc),
        // downgrade to "partial" so we still surface headlines.
        if (
          c.access_status === "paywalled" &&
          ["fetch_error", "http_error", "bot_challenge", "classify_error"].includes(String(c.detection_reason || ""))
        ) {
          out[i] = treatAsPartialWhenUnverifiable({
            item,
            url,
            resolved_url: c.resolved_url,
            reason: `unverifiable_access:${c.detection_reason || "unknown"}`,
          })
          continue
        }

        const access_status = c.access_status
        const summarization_mode =
          access_status === "open"
            ? "full_summary"
            : access_status === "partial"
              ? "intelligence_brief"
              : "paywall_signal"
        const confidence_label =
          access_status === "open" ? "High" : access_status === "partial" ? "Medium" : "Low"
        out[i] = {
          ...item,
          access_status,
          resolved_url: normalizeUrlForKey(c.resolved_url || item.resolved_url || item.url),
          http_status: c.http_status,
          content_length_chars: c.content_length_chars,
          extracted_text_length_chars: c.extracted_text_length_chars,
          detection_reason: c.detection_reason,
          summarization_mode,
          confidence_label,
        }
      } catch (err) {
        console.warn("news_access: classification failed", { url, err })
        out[i] = treatAsPartialWhenUnverifiable({
          item,
          url,
          resolved_url: item.resolved_url,
          reason: "unverifiable_access:exception",
        })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

// Intentionally no mock/fallback headlines: this view should only show real articles.
