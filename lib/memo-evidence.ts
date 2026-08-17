/**
 * Evidence guardrail for the AI-generated industry outlook memo.
 *
 * The memo is written by a model with a hosted web-search tool. Two failure
 * modes produce fabricated statistics in an investment memo:
 *
 *  1. The model states a figure it never read (e.g. "Miami-Dade lis pendens
 *     filings averaging 180-220 per week"), sometimes attaching whatever
 *     citation happens to be nearby.
 *  2. Web search surfaces an SEO content farm, and the model treats it as a
 *     citable authority.
 *
 * A prompt instruction cannot prevent either one. This module is the actual
 * enforcement: any bullet that states a statistic must attribute it to a
 * recognized publisher, or the bullet is removed before the memo is cached.
 *
 * Deliberately dependency-free so it can be unit tested with
 * `node --test --experimental-strip-types lib/memo-evidence.test.ts`.
 */

export const MEMO_HEADINGS = [
  "Executive Summary",
  "U.S. commercial real estate outlook (CRE debt & distress)",
  "Miami-specific CRE and distressed-debt outlook",
  "How this shapes distressed-debt investing",
  "Key sources (for further reading)",
]

const SOURCES_HEADING = "Key sources (for further reading)"

/**
 * Publishers whose figures we are willing to print. Default-deny: anything not
 * listed is treated as unverified, which is the intended bias — a bullet with
 * no statistic is better than a bullet with an invented one.
 */
export const TRUSTED_PUBLISHER_DOMAINS = [
  // CRE data, ratings and research
  "trepp.com",
  "spglobal.com",
  "moodys.com",
  "moodysanalytics.com",
  "fitchratings.com",
  "kbra.com",
  "morningstar.com",
  "greenstreet.com",
  "costar.com",
  "attomdata.com",
  "attom.com",
  "corelogic.com",
  "realtytrac.com",
  "msci.com",
  "rcanalytics.com",
  "cred-iq.com",
  "credaily.com",
  "yardimatrix.com",
  "lightboxre.com",
  // CRE trade press
  "bisnow.com",
  "commercialobserver.com",
  "therealdeal.com",
  "globest.com",
  "connectcre.com",
  "cpexecutive.com",
  "commercialsearch.com",
  "multihousingnews.com",
  "rebusinessonline.com",
  "wealthmanagement.com",
  "crenews.com",
  "commercialmortgage.com",
  // Brokerages and lenders
  "cbre.com",
  "jll.com",
  "cushmanwakefield.com",
  "colliers.com",
  "newmark.com",
  "marcusmillichap.com",
  "avisonyoung.com",
  "savills.us",
  "berkadia.com",
  "walkerdunlop.com",
  // Associations, GSEs and regulators
  "mba.org",
  "nareit.com",
  "nar.realtor",
  "urban.org",
  "freddiemac.com",
  "fanniemae.com",
  "newyorkfed.org",
  "stlouisfed.org",
  "dallasfed.org",
  "philadelphiafed.org",
  "richmondfed.org",
  "atlantafed.org",
  // General business and financial press
  "wsj.com",
  "bloomberg.com",
  "reuters.com",
  "ft.com",
  "cnbc.com",
  "barrons.com",
  "forbes.com",
  "businessinsider.com",
  "axios.com",
  "marketwatch.com",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",
  "apnews.com",
  "fortune.com",
  // Florida / South Florida
  "miamiherald.com",
  "bizjournals.com",
  "sun-sentinel.com",
  "floridatrend.com",
  "thenextmiami.com",
  "miamitodaynews.com",
  "wlrn.org",
  "local10.com",
  "nbcmiami.com",
  "floridarealtors.org",
  "miamidade.gov",
]

/** Publisher names as a model is likely to write them in "(Publisher, Month Year)". */
export const TRUSTED_PUBLISHER_NAMES = [
  "trepp",
  "s&p global",
  "s&p",
  "standard & poor",
  "moody's",
  "moodys",
  "fitch",
  "kbra",
  "morningstar",
  "green street",
  "costar",
  "attom",
  "corelogic",
  "realtytrac",
  "msci",
  "real capital analytics",
  "cred iq",
  "cred-iq",
  "cre daily",
  "yardi",
  "lightbox",
  "bisnow",
  "commercial observer",
  "the real deal",
  "globest",
  "globe st",
  "connect cre",
  "commercial property executive",
  "multi-housing news",
  "cbre",
  "jll",
  "cushman",
  "colliers",
  "newmark",
  "marcus & millichap",
  "avison young",
  "savills",
  "berkadia",
  "walker & dunlop",
  "mortgage bankers association",
  "nareit",
  "national association of realtors",
  "urban institute",
  "freddie mac",
  "fannie mae",
  "federal reserve",
  "new york fed",
  "st. louis fed",
  "fdic",
  "occ",
  "u.s. treasury",
  "census bureau",
  "bureau of labor statistics",
  "wall street journal",
  "bloomberg",
  "reuters",
  "financial times",
  "cnbc",
  "barron's",
  "forbes",
  "business insider",
  "axios",
  "marketwatch",
  "new york times",
  "washington post",
  "the economist",
  "associated press",
  "fortune",
  "miami herald",
  "business journal",
  "sun sentinel",
  "sun-sentinel",
  "florida trend",
  "the next miami",
  "miami today",
  "wlrn",
  "florida realtors",
  "miami-dade clerk",
  "miami-dade county clerk",
]

const DOMAIN_RE = /\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi

/** Exact host or subdomain of a trusted domain; plus any .gov / .edu host. */
export function isTrustedDomain(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "").trim()
  if (!h) return false
  if (/\.(gov|edu|mil)$/.test(h)) return true
  return TRUSTED_PUBLISHER_DOMAINS.some((d) => h === d || h.endsWith("." + d))
}

function mentionsTrustedName(text: string): boolean {
  const t = text.toLowerCase()
  return TRUSTED_PUBLISHER_NAMES.some((name) => {
    let from = 0
    for (;;) {
      const idx = t.indexOf(name, from)
      if (idx === -1) return false
      from = idx + 1
      // Require a word boundary so "mba" does not match inside "columbia",
      // but tolerate a plural or possessive ("Business Journals", "Reuters'").
      const before = idx === 0 ? " " : t[idx - 1]
      let end = idx + name.length
      if (t[end] === "s") end += 1
      if (t[end] === "'") end += 1
      const after = end >= t.length ? " " : t[end]
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    }
  })
}

/**
 * True when the text credits a recognized publisher — either a cited domain
 * (web search leaves these as "(trepp.com)") or a named one ("(Trepp, July 2026)").
 */
export function hasTrustedAttribution(text: string): boolean {
  DOMAIN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DOMAIN_RE.exec(text))) {
    if (isTrustedDomain(match[1])) return true
  }
  return mentionsTrustedName(text)
}

/**
 * Blanks out anything date-shaped so a calendar reference is never mistaken
 * for a statistic. "Q1 2026", "July 2026", "2025-2026" carry no numeric claim.
 */
function maskDates(text: string): string {
  return text
    .replace(/\bQ[1-4]\s*(?:of\s*)?(?:'|FY)?\s*(?:19|20)?\d{2}\b/gi, " ")
    .replace(/\bQ[1-4]\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{0,2},?\s*(?:19|20)\d{2}\b/gi,
      " "
    )
    .replace(/\b(?:19|20)\d{2}\s*(?:–|—|-|to|through)\s*(?:19|20)?\d{2}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
}

const STAT_PATTERNS: RegExp[] = [
  // Money: $930 billion, $2M, $1.4 trillion
  /\$\s?\d/,
  // Rates: 6.1%, 43 percent, 6 basis points, 25 bps
  /\d[\d,.]*\s*(?:%|percent\b|percentage\s+points?\b|pct\b|basis\s+points?\b|bps\b)/i,
  // Magnitudes: 930 billion, 2.4 million
  /\d[\d,.]*\s*(?:trillion|billion|million|thousand)\b/i,
  // Ranges (years already masked out): 180-220, 15 to 20
  /\b\d[\d,]*(?:\.\d+)?\s*(?:–|—|-|to)\s*\d[\d,]*(?:\.\d+)?\b/,
  // Thousands-separated counts: 1,200
  /\b\d{1,3}(?:,\d{3})+\b/,
  // Counted things: 420 filings, 37 loans, 1.2 msf
  /\b\d[\d,.]*\s*(?:filings?|loans?|notes?|mortgages?|properties|assets?|units?|deals?|transactions?|foreclosures?|auctions?|buildings?|keys\b|beds\b|acres?|square\s+feet|sf\b|msf\b|sq\.?\s?ft)/i,
]

/** True when the text asserts a quantitative claim (dates and bare years excluded). */
export function containsStatistic(text: string): boolean {
  const masked = maskDates(text)
  return STAT_PATTERNS.some((re) => re.test(masked))
}

export type MemoSanitizeResult = {
  text: string
  /** Bullets removed for stating an unverifiable figure — logged, not shown. */
  dropped: string[]
  /** Bullets removed as restatements of an earlier bullet. */
  duplicates: string[]
}

const NO_DATA_LINE =
  "- No independently sourced figures were available for this section in today's run."

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "to", "for", "on", "at", "by", "with",
  "is", "are", "was", "were", "has", "have", "had", "as", "that", "this", "these",
  "from", "its", "it", "which", "while", "also", "been", "be",
])

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z0-9.%$\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  )
}

/**
 * The model frequently restates the same finding several times in one section
 * — sometimes looping the identical sentence — which reads as padding in a
 * memo. Two bullets sharing most of their content words are the same point.
 */
function isRestatement(candidate: Set<string>, seen: Set<string>[]): boolean {
  if (candidate.size === 0) return false
  for (const prior of seen) {
    let shared = 0
    for (const word of candidate) if (prior.has(word)) shared += 1
    const overlap = shared / Math.min(candidate.size, prior.size)
    if (overlap >= 0.8) return true
  }
  return false
}

/**
 * Removes every bullet that states a statistic without crediting a recognized
 * publisher. Section headings and the "Key sources" URL list pass through
 * untouched — a link is not a claim, and dropping links would strip the memo's
 * audit trail.
 */
export function sanitizeMemoEvidence(memo: string): MemoSanitizeResult {
  const dropped: string[] = []
  const duplicates: string[] = []
  const out: string[] = []
  const seenPoints: Set<string>[] = []
  const sourceLines: string[] = []
  let section = ""
  let bulletsInSection = 0

  const flushSection = () => {
    if (section && section !== SOURCES_HEADING && bulletsInSection === 0) {
      out.push(NO_DATA_LINE)
    }
  }

  for (const line of memo.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (section !== SOURCES_HEADING) out.push("")
      continue
    }

    const heading = MEMO_HEADINGS.find((h) => trimmed.toLowerCase() === h.toLowerCase())
    if (heading) {
      flushSection()
      section = heading
      bulletsInSection = 0
      out.push(trimmed)
      continue
    }

    if (section === SOURCES_HEADING) {
      sourceLines.push(trimmed)
      continue
    }

    const body = trimmed.replace(/^(?:[-•*]\s*)+/, "")
    if (containsStatistic(body) && !hasTrustedAttribution(body)) {
      dropped.push(body)
      continue
    }

    const words = contentWords(body)
    if (isRestatement(words, seenPoints)) {
      duplicates.push(body)
      continue
    }
    seenPoints.push(words)

    bulletsInSection += 1
    out.push(trimmed)
  }
  flushSection()

  if (sourceLines.length) out.push(...filterSourceLines(sourceLines))

  return {
    text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    dropped,
    duplicates,
  }
}

/**
 * A link is not a claim, so the reading list is kept generously: untrusted URLs
 * are dropped only when enough recognized publishers remain to still give the
 * reader somewhere to verify the memo.
 */
function filterSourceLines(lines: string[]): string[] {
  const trusted = lines.filter((l) => {
    const url = l.match(/https?:\/\/[^\s)]+/)?.[0]
    if (!url) return false
    try {
      return isTrustedDomain(new URL(url).hostname)
    } catch {
      return false
    }
  })
  return trusted.length >= 3 ? trusted : lines
}
