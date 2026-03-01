/**
 * CBRE deep-link builder.
 * Constructs best-guess CBRE links from structured query.
 * No scraping, no auth bypass. Links open on CBRE.com.
 */

import {
  type GeographyLevel,
  type PropertyType,
  type ReportType,
  type TimePreference,
  getGeographyOptions,
  MARKET_OPTIONS,
} from "./cbre-options"

export type CbreTab = "market-reports" | "insights"

export type CbreQuery = {
  tab: CbreTab
  geographyLevel: GeographyLevel
  geographyValue: string
  propertyType: PropertyType
  reportType: ReportType
  timePreference: TimePreference
  /** CBRE Market Reports / Insights filters */
  region: string
  country: string
  market: string
  topic: string
  keyword?: string
}

export type CbreLinkCandidate = {
  title: string
  url: string
  confidence: "High" | "Medium" | "Low"
}

const CBRE_BASE = "https://www.cbre.com"

/**
 * Geography → CBRE 2026 local market report slug.
 * From CBRE Local Markets: /insights/books/us-real-estate-market-outlook-2026/local-markets
 */
const GEO_TO_CBRE_LOCAL_SLUG: Record<string, string> = {
  // States → primary metro report
  Florida: "south-florida",
  Georgia: "atlanta",
  Texas: "dallas-fort-worth",
  California: "greater-los-angeles",
  "New York": "new-york-city",
  Illinois: "chicago",
  Massachusetts: "boston",
  Arizona: "phoenix",
  Colorado: "denver",
  Minnesota: "minneapolis",
  "North Carolina": "charlotte",
  Pennsylvania: "philadelphia",
  Virginia: "washington-d-c",
  Washington: "greater-los-angeles", // no Seattle; GLA is closest
  "District of Columbia": "washington-d-c",
  // Metros
  Miami: "south-florida",
  Tampa: "south-florida",
  Orlando: "south-florida",
  Jacksonville: "south-florida",
  Atlanta: "atlanta",
  Boston: "boston",
  Charlotte: "charlotte",
  Chicago: "chicago",
  Dallas: "dallas-fort-worth",
  "Fort Worth": "dallas-fort-worth",
  Denver: "denver",
  "Greater Los Angeles": "greater-los-angeles",
  "Los Angeles": "greater-los-angeles",
  Houston: "houston",
  Minneapolis: "minneapolis",
  "New York City": "new-york-city",
  Philadelphia: "philadelphia",
  Phoenix: "phoenix",
  Raleigh: "raleigh-durham",
  "Raleigh-Durham": "raleigh-durham",
  "San Francisco": "san-francisco",
  "Washington, D.C.": "washington-d-c",
  "Washington D.C.": "washington-d-c",
}

/** Market slug (e.g. "miami") → CBRE local report slug */
const MARKET_SLUG_TO_CBRE: Record<string, string> = {}
for (const [k, v] of Object.entries(GEO_TO_CBRE_LOCAL_SLUG)) {
  const slug = k.toLowerCase().replace(/\s+/g, "-").replace(/,/g, "")
  if (!MARKET_SLUG_TO_CBRE[slug]) MARKET_SLUG_TO_CBRE[slug] = v
}

function getGeographyLocalReportUrl(geographyLevel: string, geographyValue: string): string | null {
  if (geographyLevel === "national" || !geographyValue?.trim()) return null
  const validOptions = getGeographyOptions(geographyLevel as GeographyLevel)
  if (!validOptions.includes(geographyValue.trim())) return null
  const slug = GEO_TO_CBRE_LOCAL_SLUG[geographyValue.trim()]
  if (!slug) return null
  return `${CBRE_BASE}/insights/reports/${slug}-2026-u-s-real-estate-market-outlook`
}

function getMarketLocalReportUrl(market: string): string | null {
  if (!market?.trim()) return null
  const slug = MARKET_SLUG_TO_CBRE[market.trim().toLowerCase()]
  if (!slug) return null
  return `${CBRE_BASE}/insights/reports/${slug}-2026-u-s-real-estate-market-outlook`
}

/** Known CBRE paths - all direct CBRE.com URLs */
const CBRE_PATHS = {
  marketReports: "/insights#market-reports",
  insights: "/insights",
  reports: "/insights/reports",
  books: "/insights/books",
  figures: "/insights/figures",
  intelligentInvestment: "/insights/intelligent-investment",
  globalOfficeRentTracker: "/insights/global-office-rent-tracker",
  marketForecasts: "/services/invest-finance-and-value/market-forecasts-and-analytics",
} as const

/** Direct CBRE links by property type */
const PROPERTY_TYPE_LINKS: Partial<Record<Exclude<PropertyType, "all">, { title: string; url: string }>> = {
  office: { title: "Office", url: `${CBRE_BASE}/insights/global-office-rent-tracker` },
  "industrial-and-logistics": { title: "Industrial and logistics", url: `${CBRE_BASE}/insights/books/us-real-estate-market-outlook-2026/industrial` },
  retail: { title: "Retail", url: `${CBRE_BASE}/insights/reports/2025-retail-rent-dynamics` },
  hotel: { title: "Hotel", url: `${CBRE_BASE}/insights/figures` },
  multifamily: { title: "Multifamily", url: `${CBRE_BASE}/insights/books/us-real-estate-market-outlook-2026/multifamily` },
  residential: { title: "Residential", url: `${CBRE_BASE}/insights` },
  land: { title: "Land", url: `${CBRE_BASE}/insights` },
  healthcare: { title: "Healthcare", url: `${CBRE_BASE}/insights` },
  "life-sciences": { title: "Life Sciences", url: `${CBRE_BASE}/insights` },
  alternatives: { title: "Alternatives", url: `${CBRE_BASE}/insights` },
  "data-center": { title: "Data Center", url: `${CBRE_BASE}/insights` },
  "data-centre": { title: "Data Centre", url: `${CBRE_BASE}/insights` },
}

function reportTypeToPath(reportType: ReportType): string {
  const map: Record<ReportType, string> = {
    "market-outlook": CBRE_PATHS.books,
    "report": CBRE_PATHS.reports,
    "article": CBRE_PATHS.insights,
    "brief": CBRE_PATHS.insights,
    "book": CBRE_PATHS.books,
    "figures": CBRE_PATHS.figures,
    "podcast": CBRE_PATHS.insights,
  }
  return map[reportType] ?? CBRE_PATHS.insights
}

function getPropertyTypeLinks(propertyType: PropertyType): { title: string; url: string }[] {
  if (propertyType === "all") {
    return Object.values(PROPERTY_TYPE_LINKS).filter(Boolean) as { title: string; url: string }[]
  }
  const link = PROPERTY_TYPE_LINKS[propertyType]
  return link ? [link] : []
}

export type BuildCbreLinksOptions = {
  /** When provided (e.g. from a report card), this URL is the primary/best match */
  directReportUrl?: string | null
}

/**
 * Build CBRE links from query. Returns 3–6 candidates ordered by confidence.
 * If directReportUrl is provided, it is always first as the best match.
 */
function buildCbreSectionUrl(query: CbreQuery): { url: string; title: string } {
  const { tab, propertyType, region, country, market, topic } = query
  const hash = tab === "market-reports" ? "#market-reports" : "#insights"
  const params = new URLSearchParams()
  if (propertyType && propertyType !== "all") params.set("propertyType", propertyType)
  if (region) params.set("region", region)
  if (country) params.set("country", country)
  if (market) params.set("market", market)
  if (topic && tab === "insights") params.set("topic", topic)
  const qs = params.toString()
  const url = `${CBRE_BASE}/insights${qs ? `?${qs}` : ""}${hash}`
  const title = tab === "market-reports" ? "CBRE Market Reports" : "CBRE Insights"
  return { url, title }
}

export function buildCbreLinks(
  query: CbreQuery,
  options?: BuildCbreLinksOptions
): CbreLinkCandidate[] {
  const candidates: CbreLinkCandidate[] = []
  const { geographyLevel, geographyValue, propertyType, reportType, tab } = query
  const directReportUrl = options?.directReportUrl

  const hasGeo = geographyLevel !== "national" && geographyValue.trim().length > 0
  const geoLocalUrl = getGeographyLocalReportUrl(geographyLevel, geographyValue)
  const marketLocalUrl = getMarketLocalReportUrl(query.market)

  // 0a. Primary section link (Market Reports or Insights) with selected filters
  const section = buildCbreSectionUrl(query)
  candidates.push({
    title: section.title,
    url: section.url,
    confidence: "High",
  })

  // 0b. Market-specific local report (when user selected market with known CBRE report)
  const localReportUrl = marketLocalUrl ?? geoLocalUrl
  if (localReportUrl) {
    const label = query.market
      ? MARKET_OPTIONS.find((m) => m.value === query.market)?.label ?? query.market
      : geographyValue
    candidates.push({
      title: `${label} market report`,
      url: localReportUrl,
      confidence: "High",
    })
  }

  // 0c. Direct report URL (when opened from a specific CBRE report card)
  if (directReportUrl?.trim()) {
    candidates.push({
      title: "U.S. report (direct link)",
      url: directReportUrl,
      confidence: geoLocalUrl ? "Medium" : "High",
    })
  }

  // 1. Other section (if on Market Reports, also link to Insights and vice versa)
  const otherHash = tab === "market-reports" ? "#insights" : "#market-reports"
  candidates.push({
    title: tab === "market-reports" ? "CBRE Insights" : "CBRE Market Reports",
    url: `${CBRE_BASE}/insights${otherHash}`,
    confidence: "Medium",
  })

  // 2. Report-type specific section
  const reportPath = reportTypeToPath(reportType)
  candidates.push({
    title: `CBRE ${reportType.replace(/-/g, " ")}`,
    url: CBRE_BASE + reportPath,
    confidence: hasGeo ? "Medium" : "High",
  })

  // 3. Property-type specific links (all types when "all", else single type)
  const propLinks = getPropertyTypeLinks(propertyType)
  for (const { title, url } of propLinks) {
    candidates.push({
      title: `CBRE ${title}`,
      url,
      confidence: "Medium",
    })
  }

  // 4. Intelligent Investment
  candidates.push({
    title: "CBRE Intelligent Investment",
    url: CBRE_BASE + CBRE_PATHS.intelligentInvestment,
    confidence: "Medium",
  })

  // 5. Reports library
  candidates.push({
    title: "CBRE Reports & Insights",
    url: CBRE_BASE + CBRE_PATHS.reports,
    confidence: "Medium",
  })

  // 6. Market Forecasts
  candidates.push({
    title: "CBRE Market Forecasts",
    url: CBRE_BASE + CBRE_PATHS.marketForecasts,
    confidence: "Low",
  })

  // 7. Main Insights Hub
  candidates.push({
    title: "CBRE Insights Hub",
    url: CBRE_BASE + CBRE_PATHS.insights,
    confidence: "Low",
  })

  // Dedupe by URL, keep first (highest confidence) occurrence
  const seen = new Set<string>()
  const deduped = candidates.filter((c) => {
    if (seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })

  // Order: High first, then Medium, then Low
  const order = { High: 0, Medium: 1, Low: 2 }
  const sorted = deduped.sort((a, b) => order[a.confidence] - order[b.confidence])
  // Show more when "all" property types (7+ property links)
  const limit = propertyType === "all" ? 15 : 6
  return sorted.slice(0, limit)
}
