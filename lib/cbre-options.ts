/**
 * Curated options for CBRE deep-link selector.
 * Aligned with CBRE insights filters: Property Type, Region, Country, Market, Topic.
 * Options curated from CRE taxonomy (CBRE does not expose filter API).
 */

export const CBRE_INSIGHTS_HUB = "https://www.cbre.com/insights"
export const CBRE_MARKET_REPORTS = "https://www.cbre.com/insights#market-reports"
export const CBRE_INSIGHTS = "https://www.cbre.com/insights#insights"

/** Regions – aligned with CBRE Market Reports filters */
export const REGIONS = [
  { value: "", label: "All regions" },
  { value: "americas", label: "Americas" },
  { value: "apac", label: "APAC" },
  { value: "europe", label: "Europe" },
  { value: "nordics", label: "Nordics" },
  { value: "menat", label: "MENAT" },
  { value: "global", label: "Global" },
] as const

/** Countries – aligned with CBRE Market Reports (Coveo facet data-value) */
export const COUNTRIES = [
  { value: "", label: "All countries" },
  { value: "United States", label: "United States" },
  { value: "Australia", label: "Australia" },
  { value: "New Zealand", label: "New Zealand" },
  { value: "Poland", label: "Poland" },
  { value: "Mainland China", label: "Mainland China" },
  { value: "Canada", label: "Canada" },
  { value: "Japan", label: "Japan" },
  { value: "Spain", label: "Spain" },
  { value: "Thailand", label: "Thailand" },
  { value: "Ireland", label: "Ireland" },
  { value: "South Eastern Europe", label: "South Eastern Europe" },
  { value: "Vietnam", label: "Vietnam" },
  { value: "India", label: "India" },
  { value: "Pan Asia", label: "Pan Asia" },
  { value: "Czech Republic", label: "Czech Republic" },
  { value: "France", label: "France" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "Germany", label: "Germany" },
  { value: "Sweden", label: "Sweden" },
  { value: "Hungary", label: "Hungary" },
  { value: "United Arab Emirates", label: "United Arab Emirates" },
  { value: "Belgium", label: "Belgium" },
  { value: "Slovakia", label: "Slovakia" },
  { value: "Romania", label: "Romania" },
  { value: "Denmark", label: "Denmark" },
  { value: "Baltics", label: "Baltics" },
  { value: "Luxembourg", label: "Luxembourg" },
  { value: "Norway", label: "Norway" },
  { value: "Switzerland", label: "Switzerland" },
  { value: "Finland", label: "Finland" },
  { value: "Bulgaria", label: "Bulgaria" },
  { value: "Croatia", label: "Croatia" },
  { value: "Serbia", label: "Serbia" },
  { value: "Mexico", label: "Mexico" },
  { value: "Austria", label: "Austria" },
  { value: "Singapore", label: "Singapore" },
  { value: "Saudi Arabia", label: "Saudi Arabia" },
  { value: "Slovenia", label: "Slovenia" },
  { value: "Bahrain", label: "Bahrain" },
  { value: "Netherlands", label: "Netherlands" },
  { value: "Pan Europe", label: "Pan Europe" },
  { value: "Portugal", label: "Portugal" },
  { value: "Turkey", label: "Turkey" },
  { value: "Hong Kong", label: "Hong Kong" },
  { value: "Philippines", label: "Philippines" },
  { value: "Taiwan", label: "Taiwan" },
  { value: "Korea", label: "Korea" },
  { value: "Chile", label: "Chile" },
  { value: "Argentina", label: "Argentina" },
  { value: "Israel", label: "Israel" },
  { value: "Italy", label: "Italy" },
] as const

/** Insights topics – CBRE thematic sections on cbre.com/insights */
export const INSIGHTS_TOPICS = [
  { value: "", label: "All topics" },
  { value: "intelligent-investment", label: "Intelligent Investment" },
  { value: "future-cities", label: "Future Cities" },
  { value: "adaptive-spaces", label: "Adaptive Spaces" },
  { value: "evolving-workforces", label: "Evolving Workforces" },
  { value: "creating-resilience", label: "Creating Resilience" },
  { value: "workplace-occupancy", label: "Workplace & Occupancy" },
] as const

export const GEOGRAPHY_LEVELS = [
  { value: "national", label: "National" },
  { value: "state", label: "State" },
  { value: "metro", label: "Metro" },
  { value: "county", label: "County" },
] as const

export type GeographyLevel = (typeof GEOGRAPHY_LEVELS)[number]["value"]

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming", "District of Columbia",
] as const

export const MAJOR_METROS = [
  "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio",
  "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville", "Fort Worth", "Columbus",
  "Charlotte", "San Francisco", "Indianapolis", "Seattle", "Denver", "Boston", "Miami",
  "Nashville", "Detroit", "Portland", "Las Vegas", "Atlanta", "Tampa", "Orlando",
  "Minneapolis", "Cleveland", "Raleigh", "Sacramento", "St. Louis", "Pittsburgh",
  "Cincinnati", "Kansas City", "Milwaukee", "Baltimore", "Salt Lake City",
] as const

/** Market options (metros) for CBRE Region/Country filters */
export const MARKET_OPTIONS = [
  { value: "", label: "All markets" },
  ...MAJOR_METROS.map((m) => ({ value: m.toLowerCase().replace(/\s+/g, "-"), label: m })),
] as const

export const FLORIDA_COUNTIES = [
  "Miami-Dade", "Broward", "Palm Beach", "Hillsborough", "Orange", "Pinellas",
  "Duval", "Lee", "Polk", "Volusia", "Brevard", "Seminole", "Osceola",
  "Manatee", "Sarasota", "Escambia", "Alachua", "Leon", "Clay", "St. Lucie",
] as const

/** Curated counties from major CRE markets (FL, TX, CA, NY, IL, AZ, NV, GA, NC, MN) */
export const COUNTIES = [
  ...FLORIDA_COUNTIES,
  "Harris", "Dallas", "Tarrant", "Bexar", "Travis",
  "Los Angeles", "San Diego", "Santa Clara", "San Francisco",
  "New York", "Kings", "Queens", "Bronx", "Nassau", "Suffolk",
  "Cook", "Maricopa", "Clark", "Fulton", "Mecklenburg", "Hennepin",
] as const

/** Get geography options by level */
export function getGeographyOptions(level: GeographyLevel): readonly string[] {
  switch (level) {
    case "state":
      return US_STATES
    case "metro":
      return MAJOR_METROS
    case "county":
      return [...new Set(COUNTIES)]
    default:
      return []
  }
}

/** Property types – aligned with CBRE Market Reports filters */
export const PROPERTY_TYPES = [
  { value: "all", label: "All properties" },
  { value: "office", label: "Office" },
  { value: "industrial-and-logistics", label: "Industrial and logistics" },
  { value: "retail", label: "Retail" },
  { value: "residential", label: "Residential" },
  { value: "hotel", label: "Hotel" },
  { value: "multifamily", label: "Multifamily" },
  { value: "land", label: "Land" },
  { value: "healthcare", label: "Healthcare" },
  { value: "life-sciences", label: "Life Sciences" },
  { value: "alternatives", label: "Alternatives" },
  { value: "data-center", label: "Data Center" },
  { value: "data-centre", label: "Data Centre" },
] as const

export type PropertyType = (typeof PROPERTY_TYPES)[number]["value"]

/** Report/content types – CBRE Market Reports & Insights format filters */
export const REPORT_TYPES = [
  { value: "market-outlook", label: "Market Outlook" },
  { value: "report", label: "Report" },
  { value: "article", label: "Article" },
  { value: "brief", label: "Brief" },
  { value: "book", label: "Book" },
  { value: "figures", label: "Figures" },
  { value: "podcast", label: "Podcast" },
] as const

export type ReportType = (typeof REPORT_TYPES)[number]["value"]

export const TIME_PREFERENCES = [
  { value: "most-recent", label: "Most Recent" },
  { value: "past-12-months", label: "Past 12 Months" },
] as const

export type TimePreference = (typeof TIME_PREFERENCES)[number]["value"]
