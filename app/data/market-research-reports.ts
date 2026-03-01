/**
 * Curated industry reports for the Market Research tab.
 * These are published PDFs/web pages from MBA, MHN, CommercialSearch, CBRE, and JLL.
 * URLs can be added when known.
 */

export type ReportEntry = {
  id: string
  title: string
  source: string
  asOf: string
  /** Link to open report in new tab */
  url?: string
  /** Direct PDF URL when known (manual override for sources that block automated access) */
  pdfUrl?: string
  keyTakeaways: string[]
  rankings?: { label: string; firms: string[] }
}

export type ReportSection = {
  id: string
  title: string
  reports: ReportEntry[]
}

export const MARKET_RESEARCH_SECTIONS: ReportSection[] = [
  {
    id: "mortgage-broker-reports",
    title: "Mortgage Broker / Originator Reports",
    reports: [
      {
        id: "mba-commercial-multifamily-2024-2025",
        title: "MBA Commercial/Multifamily Mortgage Firm Rankings",
        source: "Mortgage Bankers Association (MBA)",
        asOf: "2024–2025 Data (March 2025)",
        url: "https://mba.org/news-and-research/research-and-economics/commercial-multifamily-research/annual-originations-rankings",
        keyTakeaways: [
          "JLL ranked #1 overall for the 12th consecutive year, arranging $73.9B across 1,745 debt originations in 2024.",
          "Top 5 overall originators: JLL, CBRE, Newmark, JPMorgan Chase, Eastdil Secured.",
          "Top third-party originators by dollar volume: JLL, CBRE, Newmark, Eastdil Secured, JPMorgan Chase.",
          "Top lenders: JPMorgan Chase, Wells Fargo, Bank of America, Goldman Sachs, Berkadia.",
          "Report covers 140+ categories by investor group: CMBS, life insurance, Fannie/Freddie, FHA/Ginnie Mae, depositories, debt funds.",
        ],
      },
      {
        id: "mhn-multifamily-2026",
        title: "MHN Top Multifamily Finance Firms",
        source: "Multi-Housing News (MHN)",
        asOf: "2026 (based on 2025 performance)",
        url: "https://www.multihousingnews.com/top-multifamily-mortgage-lenders-and-brokerage-firms/",
        keyTakeaways: [
          "Walker & Dunlop leads Fannie Mae YTD 2025 with 83 loans ($1.7B); CBRE Multifamily Capital and Berkadia round out top 3.",
          "Newmark and JLL Real Estate Capital rank in top 5 for Fannie Mae multifamily originations.",
          "Market features abundant capital but limited deal volume; tightening credit spreads drive lender competition.",
          "Lenders are offering creative structuring and flexible prepayment terms to win transactions.",
        ],
      },
      {
        id: "mba-servicer-rankings-2025",
        title: "MBA Year-End Servicer Rankings",
        source: "Mortgage Bankers Association (MBA)",
        asOf: "2025 (released February 2026)",
        url: "https://mba.org/news-and-research/research-and-economics/commercial-multifamily-research/commercial-multifamily-mortgage-servicing",
        keyTakeaways: [
          "Trimont leads with $680B in master/primary servicing; PNC/Midland ($568B) and KeyBank ($468B) follow.",
          "Top 5 servicers: Trimont, PNC Real Estate/Midland, KeyBank, CBRE Loan Services, Berkadia.",
          "Trimont displaced Wells Fargo from #1; leads in CMBS/CDO/ABS and credit company/pension/REIT/fund loans.",
          "Fannie Mae servicing leaders: Walker & Dunlop, Berkadia, CBRE Loan Services. Freddie Mac: KeyBank, PNC/Midland, Trimont.",
          "FHA/Ginnie Mae: Lument, Greystone, Berkadia lead.",
        ],
      },
    ],
  },
  {
    id: "industry-outlooks",
    title: "Industry Outlooks (CBRE & JLL)",
    reports: [
      {
        id: "cbre-us-outlook-2026",
        title: "CBRE U.S. Real Estate Market Outlook 2026 (Capital Markets)",
        source: "CBRE",
        asOf: "2026",
        url: "https://www.cbre.com/insights/books/us-real-estate-market-outlook-2026",
        keyTakeaways: [
          "2026 investment driven by income; 3PL, data centers, and specialized housing lead sectors.",
          "Increased investment activity expected with deeper bidder pools and improved liquidity.",
          "Capital markets normalization as rates stabilize and transaction volume rebounds.",
        ],
      },
      {
        id: "jll-global-outlook-2026",
        title: "JLL Global Real Estate Outlook 2026",
        source: "JLL",
        asOf: "2026",
        url: "https://www.jll.com/en-us/insights/global-real-estate-outlook",
        keyTakeaways: [
          "'AI strategy reckoning'—firms must integrate AI into operations and asset strategy.",
          "'Experience' as a value driver—physical space quality and tenant experience matter more.",
          "'Democratization of real estate investing'—new capital sources and structures broaden access.",
          "Global capital flows and sector rotation themes.",
        ],
      },
      {
        id: "cbre-cap-rate-h2-2025",
        title: "CBRE U.S. Cap Rate Survey H2 2025",
        source: "CBRE",
        asOf: "H2 2025",
        url: "https://www.cbre.com/insights/reports/us-cap-rate-survey-h2-2025",
        keyTakeaways: [
          "Cap rates held steady in H2 2025; volatility easing as market transitions toward stability.",
          "Most CBRE professionals believe market has reached cyclical peak in yields.",
          "Retail and multifamily pricing viewed as appropriate; office sentiment improving.",
          "Financing conditions improved with increased lender participation and pricing clarity.",
          "Transaction activity rebounded amid improved buyer-seller alignment.",
        ],
      },
      {
        id: "jll-debt-spotlight-2025-2026",
        title: "JLL Debt in the Spotlight",
        source: "JLL",
        asOf: "2025/2026",
        url: "https://www.jll.com/en-us/insights/debt-in-the-spotlight",
        keyTakeaways: [
          "~$3.1T in global real estate assets have maturing debt by end-2025; ~$2.1T in actual loans; ~77% in US (~$1.5T for US landlords).",
          "Living/multifamily ~25% of maturities; office ~23%; US apartments ~40% of maturing debt.",
          "Assets financed 2019–2021 at peak valuations face greatest refinancing risk; new equity required for many.",
          "Begin refinancing discussions 9+ months before maturity; loans typically take 6 months to close.",
          "Debt funds, insurance, agencies offer alternatives beyond CMBS; credit strategies outperformed by ~15 basis points since Fed tightening.",
        ],
      },
    ],
  },
]
