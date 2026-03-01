 "use server"
 
export type ResearchPoint = {
  date: string
  value: number
}

export type ResearchMetric = {
  id: string
  label: string
  unit: "percent" | "index" | "units" | "currency"
  value?: number
  date?: string
  change?: number
  changePct?: number
  history?: ResearchPoint[]
  source: string
  note?: string
  category?: "Demand" | "Pricing" | "Supply" | "Capital" | "Other"
}

export type ResearchSection = {
  id: string
  title: string
  description: string
  subsectors?: string[]
  national: ResearchMetric[]
  miamiDade: ResearchMetric[]
}

export type MarketReportMetric = {
  id: string
  label: string
  unit: ResearchMetric["unit"]
  value: number
  note?: string
  history?: ResearchPoint[]
}

export type MarketReportSegment = {
  id: string
  label: string
  metrics: MarketReportMetric[]
}

export type MarketReport = {
  id: string
  title: string
  market: string
  asOf: string
  source: string
  highlights: string[]
  keyStats: MarketReportMetric[]
  segments: MarketReportSegment[]
  construction: MarketReportMetric[]
  sales: MarketReportMetric[]
  economy: MarketReportMetric[]
  rentVacancy: MarketReportMetric[]
}
 
 type SeriesConfig = {
  id: string
  metricId?: string
   label: string
   unit: ResearchMetric["unit"]
   note?: string
  historyPoints?: number
  yoyPeriods?: number
  category?: ResearchMetric["category"]
 }
 
const SFR_NATIONAL_SERIES: SeriesConfig[] = [
  {
    id: "USSTHPI",
    metricId: "sfr_hpi_fhfa_us",
    label: "FHFA House Price Index (US)",
    unit: "index",
    historyPoints: 24,
    yoyPeriods: 4,
    category: "Pricing",
  },
  {
    id: "CSUSHPINSA",
    metricId: "sfr_hpi_case_shiller_us",
    label: "Case-Shiller Home Price Index (US)",
    unit: "index",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Pricing",
  },
  {
    id: "MSPUS",
    metricId: "sfr_median_sales_price_us",
    label: "Median Sales Price (US)",
    unit: "currency",
    note: "Dollars, not seasonally adjusted.",
    historyPoints: 24,
    yoyPeriods: 4,
    category: "Pricing",
  },
  {
    id: "MORTGAGE30US",
    metricId: "sfr_mortgage_rate_30y_us",
    label: "30Y Mortgage Rate (US)",
    unit: "percent",
    historyPoints: 24,
    category: "Capital",
  },
  {
    id: "HOUST1F",
    metricId: "sfr_starts_1f_us",
    label: "Housing Starts (Single-Family, US)",
    unit: "units",
    note: "Thousands of units, SAAR.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Supply",
  },
  {
    id: "PERMIT1",
    metricId: "sfr_permits_1f_us",
    label: "Building Permits (Single-Family, US)",
    unit: "units",
    note: "Thousands of units, SAAR.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Supply",
  },
  {
    id: "HSN1F",
    metricId: "sfr_new_home_sales_us",
    label: "New One-Family Houses Sold (US)",
    unit: "units",
    note: "Thousands of units, SAAR.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Demand",
  },
]
 
const INDUSTRIAL_NATIONAL_SERIES: SeriesConfig[] = [
  {
    id: "INDPRO",
    metricId: "industrial_production_us",
    label: "Industrial Production Index (US)",
    unit: "index",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Demand",
  },
  {
    id: "USPRIV",
    metricId: "industrial_payrolls_proxy_us",
    label: "Private Payrolls (US, demand proxy)",
    unit: "units",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Demand",
    note: "Broad labor proxy when sector-specific series are limited.",
  },
]

const RETAIL_NATIONAL_SERIES: SeriesConfig[] = [
  {
    id: "RRSFS",
    metricId: "retail_sales_us",
    label: "Retail Sales (US)",
    unit: "currency",
    note: "Millions of dollars, SA.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Demand",
  },
  {
    id: "USRTTR",
    metricId: "retail_employment_us",
    label: "Retail Trade Employment (US)",
    unit: "units",
    note: "Thousands of persons, SA.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Demand",
  },
  {
    id: "PCEPI",
    metricId: "retail_inflation_proxy_us",
    label: "PCE Price Index (US, pricing proxy)",
    unit: "index",
    note: "Pricing pressure proxy.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Pricing",
  },
]

const HOSPITALITY_NATIONAL_SERIES: SeriesConfig[] = [
  {
    id: "USLEH",
    metricId: "hospitality_employment_us",
    label: "Leisure & Hospitality Employment (US)",
    unit: "units",
    note: "Thousands of persons, SA.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Demand",
  },
  {
    id: "CUSR0000SEHC",
    metricId: "hospitality_lodging_cpi_us",
    label: "Lodging Away From Home CPI (US)",
    unit: "index",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Pricing",
  },
]

const OFFICE_NATIONAL_SERIES: SeriesConfig[] = [
  {
    id: "USPBS",
    metricId: "office_professional_jobs_us",
    label: "Professional & Business Services Employment (US)",
    unit: "units",
    note: "Thousands of persons, SA.",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Demand",
  },
  {
    id: "BOGZ1FL075035503Q",
    metricId: "office_price_index_proxy_us",
    label: "Commercial Property Price Index (US, proxy)",
    unit: "index",
    historyPoints: 24,
    yoyPeriods: 4,
    category: "Pricing",
    note: "Public proxy series.",
  },
]

const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv?id="
const CENSUS_BASE = "https://api.census.gov/data"
const MIAMI_STATE = "12"
const MIAMI_COUNTY = "086"
const CENSUS_YEAR = 2022

type CensusConfig = {
  id: string
  label: string
  unit: ResearchMetric["unit"]
  note?: string
  dataset?: string
  category?: ResearchMetric["category"]
}

const MIAMI_ACS_SERIES: Record<"industrial" | "retail" | "hospitality" | "office", CensusConfig[]> = {
  industrial: [
    {
      id: "DP03_0033E",
      label: "Manufacturing Employment (ACS)",
      unit: "units",
      note: "Proxy for industrial demand (ACS 5-year).",
      dataset: "profile",
      category: "Demand",
    },
    {
      id: "DP03_0032E",
      label: "Construction Employment (ACS)",
      unit: "units",
      note: "Proxy for industrial pipeline (ACS 5-year).",
      dataset: "profile",
      category: "Supply",
    },
  ],
  retail: [
    {
      id: "DP03_0049E",
      label: "Retail Trade Employment (ACS)",
      unit: "units",
      note: "Proxy for retail demand (ACS 5-year).",
      dataset: "profile",
      category: "Demand",
    },
  ],
  hospitality: [
    {
      id: "DP03_0054E",
      label: "Hospitality Employment (ACS)",
      unit: "units",
      note: "Arts, entertainment, recreation, accommodation & food services (ACS 5-year).",
      dataset: "profile",
      category: "Demand",
    },
  ],
  office: [
    {
      id: "DP03_0025E",
      label: "White-Collar Employment (ACS)",
      unit: "units",
      note: "Proxy for office demand (ACS 5-year).",
      dataset: "profile",
      category: "Demand",
    },
  ],
}

const MIAMI_FRED_SERIES: SeriesConfig[] = [
  {
    id: "ATNHPIUS33124Q",
    metricId: "sfr_hpi_fhfa_miami_msad",
    label: "FHFA House Price Index (Miami MSAD)",
    unit: "index",
    note: "Proxy for Miami-Dade home prices (FHFA all-transactions).",
    historyPoints: 24,
    yoyPeriods: 4,
    category: "Pricing",
  },
  {
    id: "MIXRNSA",
    metricId: "sfr_hpi_case_shiller_miami",
    label: "Case-Shiller Home Price Index (Miami)",
    unit: "index",
    historyPoints: 24,
    yoyPeriods: 12,
    category: "Pricing",
  },
  {
    id: "MORTGAGE30US",
    metricId: "sfr_mortgage_rate_30y_us_proxy_miami",
    label: "30Y Mortgage Rate (US, proxy for Miami-Dade)",
    unit: "percent",
    historyPoints: 24,
    note: "National series (local mortgage-rate series not available via free public APIs here).",
    category: "Capital",
  },
  {
    id: "PERMIT1",
    metricId: "sfr_permits_1f_us_proxy_miami",
    label: "Building Permits (Single-Family, US proxy)",
    unit: "units",
    historyPoints: 24,
    yoyPeriods: 12,
    note: "National series used as a proxy (local permits series not available via free public APIs here).",
    category: "Supply",
  },
]
 
 function parseFredCsv(csv: string) {
   const lines = csv.trim().split("\n")
   if (lines.length < 2) return []
   const rows = lines.slice(1)
     .map((line) => line.split(","))
     .map(([date, value]) => ({ date, value }))
     .filter((row) => row.value && row.value !== ".")
   return rows
 }
 
 async function fetchSeries(series: SeriesConfig): Promise<ResearchMetric> {
   try {
     const response = await fetch(`${FRED_BASE}${series.id}`, { next: { revalidate: 3600 } })
     if (!response.ok) {
       return { ...series, source: "FRED", note: "Series unavailable" }
     }
     const csv = await response.text()
     const rows = parseFredCsv(csv)
     const latest = rows[rows.length - 1]
    const previous = rows[rows.length - 2]
    const yoyCompare =
      series.yoyPeriods && rows.length > series.yoyPeriods
        ? rows[rows.length - 1 - series.yoyPeriods]
        : undefined
    const history = rows.slice(-(series.historyPoints ?? 12)).map((row) => ({
      date: row.date,
      value: Number(row.value),
    }))
 
     const value = latest ? Number(latest.value) : undefined
    const prevValueRaw = (yoyCompare ?? previous) ? Number((yoyCompare ?? previous).value) : undefined
    const prevValue = prevValueRaw
     const change = value !== undefined && prevValue !== undefined ? value - prevValue : undefined
     const changePct =
       value !== undefined && prevValue !== undefined && prevValue !== 0
         ? (change! / prevValue) * 100
         : undefined
 
     return {
      id: series.metricId ?? series.id,
       label: series.label,
       unit: series.unit,
       value,
       date: latest?.date,
       change,
       changePct,
      history,
       source: "FRED",
       note: series.note,
      category: series.category,
     }
   } catch {
     return { ...series, source: "FRED", note: "Series unavailable" }
   }
 }
 
async function fetchCensusMetric(config: CensusConfig): Promise<ResearchMetric> {
  try {
    const dataset = config.dataset ? `acs/acs5/${config.dataset}` : "acs/acs5"
    const currentUrl = `${CENSUS_BASE}/${CENSUS_YEAR}/${dataset}?get=NAME,${config.id}&for=county:${MIAMI_COUNTY}&in=state:${MIAMI_STATE}`
    const previousUrl = `${CENSUS_BASE}/${CENSUS_YEAR - 1}/${dataset}?get=NAME,${config.id}&for=county:${MIAMI_COUNTY}&in=state:${MIAMI_STATE}`

    const [currentRes, previousRes] = await Promise.all([
      fetch(currentUrl, { next: { revalidate: 3600 } }),
      fetch(previousUrl, { next: { revalidate: 3600 } }),
    ])

    if (!currentRes.ok || !previousRes.ok) {
      return { ...config, source: "Census ACS", note: config.note || "Series unavailable" }
    }

    const currentData = await currentRes.json()
    const previousData = await previousRes.json()
    const currentValue = Number(currentData?.[1]?.[1])
    const previousValue = Number(previousData?.[1]?.[1])
    const value = Number.isNaN(currentValue) ? undefined : currentValue
    const prevValue = Number.isNaN(previousValue) ? undefined : previousValue
    const change = value !== undefined && prevValue !== undefined ? value - prevValue : undefined
    const changePct =
      value !== undefined && prevValue !== undefined && prevValue !== 0
        ? (change! / prevValue) * 100
        : undefined
    const history =
      value !== undefined && prevValue !== undefined
        ? [
            { date: String(CENSUS_YEAR - 1), value: prevValue },
            { date: String(CENSUS_YEAR), value },
          ]
        : []

    return {
      id: config.id,
      label: config.label,
      unit: config.unit,
      value,
      date: String(CENSUS_YEAR),
      change,
      changePct,
      history,
      source: "Census ACS",
      note: config.note,
      category: config.category,
    }
  } catch {
    return { ...config, source: "Census ACS", note: config.note || "Series unavailable" }
  }
}

type CensusProfileResult = {
  current: Record<string, number | undefined>
  previous: Record<string, number | undefined>
}

async function fetchCensusProfile(ids: string[]): Promise<CensusProfileResult> {
  const dataset = "acs/acs5/profile"
  const query = ids.join(",")
  const currentUrl = `${CENSUS_BASE}/${CENSUS_YEAR}/${dataset}?get=NAME,${query}&for=county:${MIAMI_COUNTY}&in=state:${MIAMI_STATE}`
  const previousUrl = `${CENSUS_BASE}/${CENSUS_YEAR - 1}/${dataset}?get=NAME,${query}&for=county:${MIAMI_COUNTY}&in=state:${MIAMI_STATE}`

  try {
    const [currentRes, previousRes] = await Promise.all([
      fetch(currentUrl, { next: { revalidate: 3600 } }),
      fetch(previousUrl, { next: { revalidate: 3600 } }),
    ])

    if (!currentRes.ok || !previousRes.ok) {
      return { current: {}, previous: {} }
    }

    const currentData = (await currentRes.json()) as string[][]
    const previousData = (await previousRes.json()) as string[][]

    const extract = (data: string[][]) => {
      if (!Array.isArray(data) || data.length < 2) return {}
      const headers = data[0]
      const values = data[1]
      return headers.reduce<Record<string, number | undefined>>((acc, header, index) => {
        if (header === "NAME" || header === "state" || header === "county") return acc
        const value = Number(values[index])
        acc[header] = Number.isNaN(value) ? undefined : value
        return acc
      }, {})
    }

    return {
      current: extract(currentData),
      previous: extract(previousData),
    }
  } catch {
    // Network/DNS failures should not break the entire Market Research panel.
    return { current: {}, previous: {} }
  }
}

function buildCensusMetric({
  id,
  label,
  unit,
  value,
  prevValue,
  note,
  category,
}: {
  id: string
  label: string
  unit: ResearchMetric["unit"]
  value?: number
  prevValue?: number
  note?: string
  category?: ResearchMetric["category"]
}): ResearchMetric {
  const change = value !== undefined && prevValue !== undefined ? value - prevValue : undefined
  const changePct =
    value !== undefined && prevValue !== undefined && prevValue !== 0 ? (change! / prevValue) * 100 : undefined
  const history =
    value !== undefined && prevValue !== undefined
      ? [
          { date: String(CENSUS_YEAR - 1), value: prevValue },
          { date: String(CENSUS_YEAR), value },
        ]
      : []

  return {
    id,
    label,
    unit,
    value,
    date: String(CENSUS_YEAR),
    change,
    changePct,
    history,
    source: "Census ACS",
    note,
    category,
  }
}

export async function fetchMarketResearch(): Promise<ResearchSection[]> {
  const [sfrNational, industrialNational, retailNational, hospitalityNational, officeNational] =
    await Promise.all([
      Promise.all(SFR_NATIONAL_SERIES.map(fetchSeries)),
      Promise.all(INDUSTRIAL_NATIONAL_SERIES.map(fetchSeries)),
      Promise.all(RETAIL_NATIONAL_SERIES.map(fetchSeries)),
      Promise.all(HOSPITALITY_NATIONAL_SERIES.map(fetchSeries)),
      Promise.all(OFFICE_NATIONAL_SERIES.map(fetchSeries)),
    ])

  const [miamiFred, miamiIndustrial, miamiRetail, miamiHospitality, miamiOffice] = await Promise.all([
    Promise.all(MIAMI_FRED_SERIES.map(fetchSeries)),
    Promise.all((MIAMI_ACS_SERIES.industrial ?? []).map(fetchCensusMetric)),
    Promise.all((MIAMI_ACS_SERIES.retail ?? []).map(fetchCensusMetric)),
    Promise.all((MIAMI_ACS_SERIES.hospitality ?? []).map(fetchCensusMetric)),
    Promise.all((MIAMI_ACS_SERIES.office ?? []).map(fetchCensusMetric)),
  ])

  const miamiResProfile = await fetchCensusProfile([
    "DP04_0001E",
    "DP04_0002E",
    "DP04_0003E",
    "DP04_0046E",
    "DP04_0089E",
    "DP04_0134E",
  ])
  const current = miamiResProfile.current
  const previous = miamiResProfile.previous
  const totalUnits = current.DP04_0001E
  const prevTotalUnits = previous.DP04_0001E
  const occupiedUnits = current.DP04_0002E
  const prevOccupiedUnits = previous.DP04_0002E
  const vacantUnits = current.DP04_0003E
  const prevVacantUnits = previous.DP04_0003E
  const ownerOccupiedUnits = current.DP04_0046E
  const prevOwnerOccupiedUnits = previous.DP04_0046E
  const vacancyRate =
    totalUnits && vacantUnits !== undefined ? (vacantUnits / totalUnits) * 100 : undefined
  const prevVacancyRate =
    prevTotalUnits && prevVacantUnits !== undefined ? (prevVacantUnits / prevTotalUnits) * 100 : undefined
  const ownerOccupiedShare =
    occupiedUnits && ownerOccupiedUnits !== undefined ? (ownerOccupiedUnits / occupiedUnits) * 100 : undefined
  const prevOwnerOccupiedShare =
    prevOccupiedUnits && prevOwnerOccupiedUnits !== undefined
      ? (prevOwnerOccupiedUnits / prevOccupiedUnits) * 100
      : undefined

  const miamiResidentialACS = [
    buildCensusMetric({
      id: "sfr_miami_dade_median_home_value_acs",
      label: "Median Home Value (Miami-Dade)",
      unit: "currency",
      value: current.DP04_0089E,
      prevValue: previous.DP04_0089E,
      note: "ACS 5-year estimate.",
      category: "Pricing",
    }),
    buildCensusMetric({
      id: "sfr_miami_dade_median_rent_acs",
      label: "Median Gross Rent (Miami-Dade)",
      unit: "currency",
      value: current.DP04_0134E,
      prevValue: previous.DP04_0134E,
      note: "ACS 5-year estimate.",
      category: "Pricing",
    }),
    buildCensusMetric({
      id: "sfr_miami_dade_housing_units_acs",
      label: "Housing Units (Miami-Dade)",
      unit: "units",
      value: totalUnits,
      prevValue: prevTotalUnits,
      note: "ACS 5-year estimate.",
      category: "Supply",
    }),
    buildCensusMetric({
      id: "sfr_miami_dade_vacancy_rate_acs",
      label: "Housing Vacancy Rate (Miami-Dade)",
      unit: "percent",
      value: vacancyRate,
      prevValue: prevVacancyRate,
      note: "Computed from ACS housing units and vacant units.",
      category: "Demand",
    }),
    buildCensusMetric({
      id: "sfr_miami_dade_owner_occupied_units_acs",
      label: "Owner-Occupied Units (Miami-Dade)",
      unit: "units",
      value: ownerOccupiedUnits,
      prevValue: prevOwnerOccupiedUnits,
      note: "ACS 5-year estimate.",
      category: "Demand",
    }),
    buildCensusMetric({
      id: "sfr_miami_dade_owner_occupied_share_acs",
      label: "Owner-Occupied Share (Miami-Dade)",
      unit: "percent",
      value: ownerOccupiedShare,
      prevValue: prevOwnerOccupiedShare,
      note: "Computed from ACS occupied units.",
      category: "Demand",
    }),
  ]

  return [
    {
      id: "singleFamily",
      title: "Single-Family Residential (Public Data)",
      description: "CoStar-style single-family pricing, affordability, and supply indicators using public/free sources (no narrative).",
      subsectors: [
        "SFR",
        "Build-to-Rent",
        "Townhomes",
        "Duplex/Triplex/Fourplex",
        "Manufactured Housing",
      ],
      national: sfrNational,
      miamiDade: [...miamiFred, ...miamiResidentialACS],
    },
    {
      id: "industrial",
      title: "Industrial Real Estate (Public Data)",
      description: "Production and labor indicators tied to industrial demand, using public proxies.",
      subsectors: [
        "Warehouse/Distribution",
        "Logistics/Last-Mile",
        "Manufacturing",
        "Flex Industrial",
        "Cold Storage",
      ],
      national: industrialNational,
      miamiDade: miamiIndustrial,
    },
    {
      id: "retail",
      title: "Retail Market (Public Data)",
      description: "Consumer demand and employment signals for retail activity.",
      subsectors: ["Neighborhood Retail", "Community Retail", "Regional Mall", "Power Centers", "Single-Tenant Net Lease"],
      national: retailNational,
      miamiDade: miamiRetail,
    },
    {
      id: "hospitality",
      title: "Hospitality (Public Data)",
      description: "Travel demand and pricing proxies from public sources.",
      subsectors: ["Limited Service", "Full Service", "Luxury", "Resorts", "Extended Stay"],
      national: hospitalityNational,
      miamiDade: miamiHospitality,
    },
    {
      id: "office",
      title: "Office Buildings (Public Data)",
      description: "Office-using employment and pricing proxies from public sources.",
      subsectors: ["CBD Office", "Suburban Office", "Medical Office", "Creative/Flex Office"],
      national: officeNational,
      miamiDade: miamiOffice,
    },
  ]
 }

export async function fetchMiamiIndustrialReport(): Promise<MarketReport> {
  return {
    id: "miami-industrial-2025-11-21",
    title: "Industrial Market Report",
    market: "Miami, FL",
    asOf: "11/21/2025",
    source: "CoStar Industrial Market Report",
    highlights: [
      "12-month net absorption contracted by 1.4M SF as tenants vacated older logistics space.",
      "Vacancy rose to 6.6% from 2022 lows but remains below the U.S. average.",
      "Market asking rent growth moderated to 2.1% over the past 12 months.",
    ],
    keyStats: [
      { id: "inventory", label: "Inventory (SF)", unit: "units", value: 278_622_452 },
      { id: "vacancy", label: "Vacancy Rate", unit: "percent", value: 6.6 },
      { id: "availability", label: "Availability Rate", unit: "percent", value: 9.0 },
      { id: "rent", label: "Market Asking Rent", unit: "currency", value: 20.6, note: "$/SF" },
      { id: "rent-growth", label: "Asking Rent Growth (YoY)", unit: "percent", value: 2.1 },
      { id: "deliveries", label: "12 Mo Deliveries (SF)", unit: "units", value: 3_100_000 },
      { id: "absorption", label: "12 Mo Net Absorption (SF)", unit: "units", value: -1_400_000 },
      { id: "under-construction", label: "Under Construction (SF)", unit: "units", value: 4_382_130 },
    ],
    segments: [
      {
        id: "logistics",
        label: "Logistics",
        metrics: [
          { id: "rent", label: "Asking Rent", unit: "currency", value: 19.83, note: "$/SF" },
          { id: "vacancy", label: "Vacancy Rate", unit: "percent", value: 7.2 },
          { id: "availability", label: "Availability Rate", unit: "percent", value: 9.7 },
          { id: "net-absorption", label: "Net Absorption (SF)", unit: "units", value: -767_836 },
          { id: "inventory", label: "Inventory (SF)", unit: "units", value: 229_297_142 },
          { id: "under-construction", label: "Under Construction (SF)", unit: "units", value: 3_814_403 },
        ],
      },
      {
        id: "specialized",
        label: "Specialized Industrial",
        metrics: [
          { id: "rent", label: "Asking Rent", unit: "currency", value: 22, note: "$/SF" },
          { id: "vacancy", label: "Vacancy Rate", unit: "percent", value: 3.8 },
          { id: "availability", label: "Availability Rate", unit: "percent", value: 6.1 },
          { id: "net-absorption", label: "Net Absorption (SF)", unit: "units", value: 11_257 },
          { id: "inventory", label: "Inventory (SF)", unit: "units", value: 33_416_989 },
          { id: "under-construction", label: "Under Construction (SF)", unit: "units", value: 567_727 },
        ],
      },
      {
        id: "flex",
        label: "Flex",
        metrics: [
          { id: "rent", label: "Asking Rent", unit: "currency", value: 28.98, note: "$/SF" },
          { id: "vacancy", label: "Vacancy Rate", unit: "percent", value: 4.3 },
          { id: "availability", label: "Availability Rate", unit: "percent", value: 5.1 },
          { id: "net-absorption", label: "Net Absorption (SF)", unit: "units", value: -24_520 },
          { id: "inventory", label: "Inventory (SF)", unit: "units", value: 15_908_321 },
          { id: "under-construction", label: "Under Construction (SF)", unit: "units", value: 0 },
        ],
      },
      {
        id: "market",
        label: "Market Total",
        metrics: [
          { id: "rent", label: "Asking Rent", unit: "currency", value: 20.6, note: "$/SF" },
          { id: "vacancy", label: "Vacancy Rate", unit: "percent", value: 6.6 },
          { id: "availability", label: "Availability Rate", unit: "percent", value: 9.0 },
          { id: "net-absorption", label: "Net Absorption (SF)", unit: "units", value: -781_099 },
          { id: "inventory", label: "Inventory (SF)", unit: "units", value: 278_622_452 },
          { id: "under-construction", label: "Under Construction (SF)", unit: "units", value: 4_382_130 },
        ],
      },
    ],
    construction: [
      { id: "properties", label: "Under Construction Properties", unit: "units", value: 19 },
      { id: "sf", label: "Under Construction SF", unit: "units", value: 4_532_130 },
      { id: "pct-inventory", label: "% of Inventory", unit: "percent", value: 1.7 },
      { id: "preleased", label: "Pre-Leased", unit: "percent", value: 17.0 },
    ],
    sales: [
      { id: "volume", label: "Sales Volume (Past 12 Mo)", unit: "currency", value: 2_300_000_000 },
      { id: "sale-comps", label: "Sale Comparables", unit: "units", value: 516 },
      { id: "cap-rate", label: "Avg Cap Rate", unit: "percent", value: 5.8 },
      { id: "price-sf", label: "Avg Price / SF", unit: "currency", value: 235, note: "$/SF" },
      { id: "vacancy-sale", label: "Avg Vacancy at Sale", unit: "percent", value: 7.6 },
    ],
    economy: [
      { id: "population", label: "Population", unit: "units", value: 2_854_100 },
      { id: "labor-force", label: "Labor Force", unit: "units", value: 1_440_830 },
      { id: "income", label: "Median Household Income", unit: "currency", value: 76_919 },
      { id: "unemployment", label: "Unemployment Rate", unit: "percent", value: 2.7 },
    ],
    rentVacancy: [
      {
        id: "rent-trend",
        label: "Market Asking Rent",
        unit: "currency",
        value: 20.6,
        note: "$/SF",
        history: [
          { date: "2016", value: 10.34 },
          { date: "2017", value: 10.91 },
          { date: "2018", value: 11.6 },
          { date: "2019", value: 12.4 },
          { date: "2020", value: 13.29 },
          { date: "2021", value: 15.15 },
          { date: "2022", value: 17.47 },
          { date: "2023", value: 19.37 },
          { date: "2024", value: 20.27 },
          { date: "2025 YTD", value: 20.6 },
        ],
      },
      {
        id: "vacancy-trend",
        label: "Vacancy Rate",
        unit: "percent",
        value: 6.6,
        history: [
          { date: "2016", value: 3.4 },
          { date: "2017", value: 3.6 },
          { date: "2018", value: 3.8 },
          { date: "2019", value: 4.0 },
          { date: "2020", value: 4.3 },
          { date: "2021", value: 2.9 },
          { date: "2022", value: 2.1 },
          { date: "2023", value: 3.0 },
          { date: "2024", value: 5.3 },
          { date: "2025 YTD", value: 6.6 },
        ],
      },
    ],
  }
}
