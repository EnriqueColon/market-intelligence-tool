# Market Intelligence Tool — Simple Overview

This document explains how the Market Intelligence tool works in plain language, what each tab shows, and what each card means. It is written for non‑technical audiences.

## 1) How the tool works (simple flow)
1. You open the Market Intelligence page in the browser.
2. The tool loads different tabs (News, Market Analytics, Market Research, Competitor Analysis, Legal Landscape).
3. Each card pulls data from public sources, internal databases, or AI summaries.
4. The page shows the latest available data and updates the display when you switch tabs or regions.

### Region selector (National / Florida / Miami Metro)
The dropdown in the header controls which region is used for:
- Market Analytics (FDIC bank data and Market Research proxies)
- News tab (Public Mentions and Investing Business filtering)
- Region labels shown in cards

Miami Metro uses Miami‑Dade proxies where local data is not available.

---

## 2) News Tab — What it shows

### A) Industry Outlook
**What it is:**  
A short memo‑style outlook focused on distressed commercial real estate (CRE) debt.  

**How it’s created:**  
- The tool sends a prompt to the LLM (Perplexity) when the page opens.  
- The LLM returns a memo with regional outlook and sources.  
- The UI formats it into readable sections with sources at the bottom.

**LLM prompt (verbatim):**  
I would like the current and projected industry outlook for the commercial real estate sector for Miami, Florida, and the US level as it pertains to investing in distressed debt. Provide sources.  
Time window: recent and current conditions.  
Topic scope (national): distressed COMMERCIAL REAL ESTATE DEBT (CMBS stress, special servicing, delinquencies/defaults, refinancing stress, note/loan sales, workouts, receiverships, foreclosures).  
Topic scope (Florida/Miami): use Florida/Miami-specific sources. If thin, include regional CRE signals tied to debt stress.  
Tone: professional, concise, investment-committee memo. No casual language. No markdown headings. No extra commentary.  
  
Return a single plain-text memo in this structure using bullet points for each section:  
1) A short executive summary comparing U.S. vs Miami/Florida (2–4 bullets).  
2) “U.S. commercial real estate outlook (CRE debt & distress)” section with 3–6 bullets.  
3) “Miami-specific CRE and distressed-debt outlook” section with 3–6 bullets.  
4) “How this shapes distressed-debt investing” section with 3–6 bullets.  
5) “Key sources (for further reading)” section with 5–10 lines, each line: Title — https://url.  
No JSON. No markdown.

**What to look for:**  
- National vs Florida/Miami differences  
- Distress trends, liquidity, refinancing  
- Sources list

---

### B) Investing Business
**What it is:**  
A separate news feed focused on investing and capital activity: private equity, REITs, capital raises, fund raising, and CRE investment firms.

**What it shows:**  
- Title, source, date, topic, access, link, brief  
- Region tag (National / Florida / Miami Metro)  
- Topics: Private Equity/Credit, REIT, Capital Markets, Investment Firms, Debt/Financing

**How it's built:**  
- Uses investing-focused Google News RSS queries  
- Same publisher feeds as Public Mentions (GlobeSt, Bisnow, Commercial Observer, South Florida Business Journal)  
- Filters for investing-related keywords  
- Supports Brief dialog for AI summaries

**Investing queries (examples):**  
- `"private equity" OR "private credit" OR "debt fund" OR "credit fund"`  
- `"REIT" OR "real estate investment trust"`  
- `"capital raise" OR "fund raising" OR "fundraising"`  
- `"investment firm" OR "asset manager"`  
- `"commercial real estate investment" OR "CRE capital markets"`

---

### C) Public Mentions
**What it is:**  
A list of real articles pulled from public sources (RSS + Google News) about CRE debt and distress.

**What it shows:**  
- Title, source, date, topic, access, link, brief  
- Region tag (National / Florida / Miami Metro)

**How it’s built:**  
- Fetches public RSS/News sources  
- Filters for real estate context  
- Tags topics (Debt/Financing, Foreclosure/Distress, Development, etc.)  
- Deduplicates similar items

**Google News RSS keywords (queries):**  
Base distressed‑debt queries (always included):  
- `"special servicing"`  
- `"CMBS delinquency" OR "CMBS default"`  
- `"maturity wall" OR refinancing`  
- `"loan sale" OR "note sale"`  
- `"receivership" OR "foreclosure" OR "workout" OR "restructuring" OR "nonaccrual" OR "commercial mortgage"`

Local/market coverage expansion (always included):  
- `"commercial real estate" OR "real estate" OR CRE OR "office market" OR "retail market" OR "multifamily market" OR "industrial market"`  
- `"waterfront" OR "coastal" OR "beachfront" OR "oceanfront" OR "intracoastal" OR "bayfront" OR "waterfront estate" OR "oceanfront estate"`  
- `"luxury home" OR "mansion" OR "penthouse" OR "estate sale" OR "record sale"`  
- `"debt fund" OR "private equity" OR "private credit" OR "credit fund" OR "bridge loan" OR "mezzanine" OR "recapitalization"`  
- `"refinancing" OR "loan extension" OR "maturity extension" OR "lender" OR "financing"`  
- `"auction" OR "UCC" OR "note sale" OR "loan sale" OR "foreclosure" OR "receivership" OR "distressed"`

Region strings added to every query:  
- National: `United States OR U.S. OR US`  
- Florida: `Florida OR Miami OR Tampa OR Orlando OR Jacksonville OR Fort Lauderdale`  
- Miami: `Miami OR Miami‑Dade OR Brickell OR Miami Beach OR Fort Lauderdale OR Broward OR Doral`

---

### D) Article Digest
**What it is:**  
A quick digest of selected articles with summaries.

**What it shows:**  
- Short summaries and key points  
- Uses AI where available

---

## 3) Market Research Tab — What it shows

This tab displays **curated industry reports** from MBA, MHN, CommercialSearch, CBRE, and JLL. These are not live APIs; they are published reports with key takeaways and rankings summarized for quick reference.

### Mortgage Broker / Originator Reports
- **MBA Commercial/Multifamily Rankings (2024–2025):** JLL, CBRE, Eastdil Secured, Newmark, Walker & Dunlop  
- **MHN Top Multifamily Finance Firms (2026):** Newmark, CBRE, Walker & Dunlop, Berkadia  
- **CommercialSearch Top Commercial Mortgage Brokers (2025):** Newmark, CBRE, Walker & Dunlop  
- **MBA Year-End Servicer Rankings (2025):** Trimont, PNC Real Estate/Midland, KeyBank, CBRE Loan Services  

### Industry Outlooks (CBRE & JLL)
- **CBRE U.S. Real Estate Market Outlook 2026:** Income-driven; 3PL, data centers, specialized housing; deeper bidder pools  
- **JLL Global Real Estate Outlook 2026:** AI strategy reckoning; experience as value driver; democratization of RE investing  
- **CBRE U.S. Cap Rate Survey H2 2025:** Cap rates peaked; retail/industrial highest interest; stabilization  
- **JLL Debt in the Spotlight:** $3.1T maturing global debt; refinancing shortfall; high brokerage activity  

### Sector Rankings (2024–2025)
- **Overall:** JLL, CBRE, Newmark, Eastdil Secured, Walker & Dunlop  
- **Life Insurance:** JLL, Apollo, CBRE, PGIM Real Estate  
- **Fannie Mae:** Walker & Dunlop, Berkadia, CBRE, Greystone  
- **Freddie Mac:** Berkadia, JLL, CBRE, Walker & Dunlop  
- **CMBS:** Eastdil Secured, Wells Fargo, Goldman Sachs, JLL  

**Data source:**  
Static curated content in `app/data/market-research-reports.ts`. Report URLs can be added when known.

---

## 4) Market Analytics Tab — What it shows

This tab focuses on **bank and market signals** tied to CRE credit risk.

### A) Distress Opportunity Brief (Card)
**What it is:**  
A snapshot of credit stress based on FDIC call reports.

**What it measures:**  
Aggregate indicators of CRE credit stress across banks in the selected region.

**Key data shown:**  
- Institutions screened  
- Avg NPL ratio  
- Avg charge‑off ratio  
- Avg reserve coverage  
- Avg CRE concentration

**Data source:**  
FDIC call report data (quarterly, lagged)

**How it pulls data:**  
Calls the FDIC public API via server actions, filters to the selected region, and uses the latest 1–4 quarters.

**Why it matters:**  
Shows whether bank credit stress is rising or stabilizing, which affects distressed‑debt opportunity timing.

**How calculations work:**  
- **Institutions screened** = count of unique banks with a latest‑quarter record in the selected region.  
- **Avg NPL ratio** = average of `nonaccrual loans / total loans` across the latest records.  
- **Avg charge‑off ratio** = average of `net charge‑offs / total loans`.  
- **Avg reserve coverage** = average of `loan loss allowance / total loans`.  
- **Avg CRE concentration** = average of `CRE loans / total assets`.

---

### B) Top 10 Focus (Card)
**What it is:**  
A summary of the highest “opportunity score” institutions.

**What it measures:**  
Which banks appear most exposed to CRE stress based on a composite score.

**Key data shown:**  
- Count of institutions in top 10  
- Rising NPLs  
- Avg CRE concentration and NPL ratio

**Data source:**  
FDIC call reports (latest quarter)

**How it pulls data:**  
Ranks institutions using the Opportunity Score formula applied to FDIC data.

**Why it matters:**  
Helps identify likely sellers of loans or stress‑driven counterparties.

**How calculations work:**  
- **Top 10** = highest Opportunity Score (see formula below).  
- **Rising NPL (4Q)** = count of top‑10 banks where NPL ratio increased from the first to the last of the last 4 quarters.  
- **Avg CRE / Avg NPL** = average of top‑10 banks’ latest‑quarter values.

---

### C) Definitions (Card)
**What it is:**  
Plain‑English definitions of each metric and the Opportunity Score.

**What it measures:**  
N/A (reference content).

**Data source:**  
Internal definitions based on FDIC field meanings.

**How it pulls data:**  
Static text in the UI.

**Why it matters:**  
Ensures non‑technical users understand the metrics.

---

### D) Controls (Card)
**What it is:**  
Region selector for analytics (National / Florida / Miami Metro).

**What it measures:**  
N/A (control only).

**Data source:**  
N/A.

**How it pulls data:**  
Changes the region filter applied to FDIC and Market Research data.

**Why it matters:**  
Keeps analytics consistent with the selected geography.

---

### E) Target Screening List (Table)
**What it is:**  
A ranked list of banks based on credit stress and CRE exposure.

**What it measures:**  
Bank‑level exposure and stress signals to highlight potential sellers or distressed opportunities.

**Key data shown:**  
- Total assets  
- CRE concentration  
- NPL ratio  
- Charge‑off ratio  
- Reserve coverage  
- Capital ratios  
- 4‑quarter trends

**Data source:**  
FDIC call reports

**How it pulls data:**  
Uses the FDIC API, groups by bank, and ranks by Opportunity Score.

**Why it matters:**  
Provides a concrete shortlist for outreach, diligence, and monitoring.

**How Opportunity Score is calculated (core formula):**  
1) For each bank, take the **latest quarter** and compute these metrics:  
   - **CRE concentration**  
   - **NPL ratio**  
   - **Charge‑off ratio**  
   - **Reserve coverage**  
   - **Capital ratio** (CET1 if available, otherwise Leverage)
2) For each metric, perform **min‑max normalization** within the selected region:  
   - `score = (value - min) / (max - min)`  
   - Reserve coverage is **inverted** (lower reserve = higher stress)  
   - Capital is **inverted** (lower capital = higher stress)
3) Apply fixed weights (CRE Stress Watch scenario):  
   - CRE concentration **30%**  
   - NPL ratio **30%**  
   - Charge‑off ratio **20%**  
   - Reserve coverage **10%**  
   - Capital ratio **10%**
4) Opportunity Score = weighted sum × 100.

**4‑Quarter trend columns:**  
- Shows CRE concentration and NPL ratio for the last 4 quarters (within the region).

---

### F) Market Research (Public Data)
**What it is:**  
Public economic indicators used as proxies for CRE conditions.

**What it measures:**  
Macro indicators of pricing, demand, supply, and capital conditions.

**What it shows:**  
- Pricing, demand, supply, capital indicators  
- National or proxy series for Florida/Miami

**Data source:**  
FRED (public macro data)  
Census ACS (Miami‑Dade proxy)

**How it pulls data:**  
Fetches FRED time series and Census ACS values via server actions, then displays latest values + trends.

**Why it matters:**  
Adds macro context when direct CRE indicators are limited or delayed.

**Subsection card explanations (Market Research):**  
These cards are grouped by sector. Each metric is a **public proxy**, not a direct CRE rent/vacancy/cap‑rate measure.

**Price (Residential proxy)**  
- **FHFA House Price Index (US):** Home price index used as a broad pricing proxy.  
  - Source: FRED. Units: index (not “000s”).  
  - Why it matters: tracks overall pricing momentum and liquidity conditions.

**Capital**  
- **30Y Mortgage Rate (US):** National rate shown as a proxy for broader credit conditions.  
  - Source: FRED. Units: percent.  
  - Why it matters: credit cost influences refinancing and asset pricing.

**Supply (Residential construction proxies)**  
- **Building Permits (Single‑Family, US):** New supply authorization signal.  
  - Source: FRED. Units: thousands (SAAR) → displayed as full number (e.g., 878,000).  
  - Why it matters: supply pressure affects pricing and absorption.

**SFR Trend Panel (combined view)**  
- **FHFA Index + Mortgage Rate + Permits** shown together for directional context.  
  - Why it matters: shows the relationship between pricing, credit cost, and new supply.

**Pricing (Category panel)**  
- **FHFA House Price Index:** Pricing proxy (index).  
- **Case‑Shiller Home Price Index:** Alternate pricing proxy (index).  
- **Median Sales Price (US):** Residential price level (not SA).  
  - Sources: FRED.  
  - Why it matters: pricing momentum and liquidity conditions.

**Demand (Category panel)**  
- **New One‑Family Houses Sold:** Demand signal (thousands, SAAR → displayed as full number).  
  - Source: FRED.  
  - Why it matters: buyer demand affects take‑out and absorption.

**Supply (Category panel)**  
- **Housing Starts (Single‑Family, US):** Start activity (thousands, SAAR → displayed as full number).  
- **Building Permits (Single‑Family, US):** Authorization signal (thousands, SAAR → displayed as full number).  
  - Source: FRED.  
  - Why it matters: future inventory and construction pipeline.

**Industrial Real Estate (Public Data)**  
- **Industrial Production Index (US):** Demand proxy for industrial/warehouse space.  
- **Private Payrolls (US, demand proxy):** Labor proxy for activity.  
  - Source: FRED. Units: index or thousands of jobs (displayed as full number).  
  - Why it matters: goods production and employment drive warehouse/logistics demand.

**Retail Market (Public Data)**  
- **PCE Price Index (US, pricing proxy):** Pricing pressure proxy.  
- **Retail Sales (US):** Consumer demand proxy (millions of dollars).  
- **Retail Trade Employment (US):** Demand proxy when available.  
  - Source: FRED.  
  - Why it matters: consumer spending and employment drive retail performance.

**Hospitality (Public Data)**  
- **Lodging Away From Home CPI (US):** Pricing proxy for hotel rates.  
- **Leisure & Hospitality Employment (US):** Demand proxy for travel activity.  
  - Source: FRED.  
  - Why it matters: travel demand and pricing drive hotel cash flows.

**Office Buildings (Public Data)**  
- **Commercial Property Price Index (US, proxy):** Pricing proxy for office asset values.  
- **Professional & Business Services Employment (US):** Demand proxy for office‑using jobs (thousands of persons, SA).  
  - Source: FRED.  
  - Why it matters: office demand is tied to professional services employment.

---

### G) Credit & Distress Signals (New)
**What it is:**  
Add‑on data sources beyond FDIC.

**What it measures:**  
External signals of distress and credit activity outside traditional FDIC datasets.

**Cards inside:**  
- **Bank CRE Stress (FFIEC)**  
  - Latest quarter + top institutions by stress metric  
  - Requires FFIEC credentials  
  - **How it pulls data:** FFIEC public data distribution (PWS) via the ingestion runner  
  - **Why it matters:** Independent validation of bank CRE stress  
- **Construction Supply (Census)**  
  - Permits, starts, completions (national totals)  
  - **How it pulls data:** Census RESCONST time‑series API  
  - **Why it matters:** Supply pressure impacts CRE pricing and distress  
- **UCC Filings Watch**  
  - Filing counts by state + newest filings  
  - Scaffolded; requires login/source setup  
  - **How it pulls data:** Planned per‑state scraper or API (not yet fully configured)  
  - **Why it matters:** Early indicator of secured lending stress  
- **Foreclosure Notices Watch**  
  - Counts by county + newest cases  
  - Scaffolded; requires portal access
  - **How it pulls data:** Planned per‑county portal scraper (not yet fully configured)  
  - **Why it matters:** Direct pipeline of distressed assets

---

## 5) Competitor Analysis Tab

**What it is:**  
A peer landscape view for distressed CRE debt buyers.

**Data source:**  
Internal datasets + watchlist matching  
AOM (Assignment of Mortgage) SQLite database

---

## 6) Legal Landscape Tab

**What it is:**  
A summary of legal/regulatory updates.

**Data source:**  
LegiScan API and related feeds

**LegiScan feeds used (Florida):**  
- `getSearch` endpoint with `state=FL`  
- Primary query terms: commercial real estate, mortgage, lending, foreclosure, CMBS, etc.  
- Fallback query terms: “real estate”, “commercial”, “mortgage”, “loan”  
- Filters to most recent bill actions (top 10)  
- Pulls full bill detail via `getBill` for each match



---

## 7) Where the data is presented (quick map)

**News tab:**  
- Industry Outlook  
- Investing Business  
- Public Mentions  
- Article Digest  

**Market Research tab:**  
- Mortgage broker rankings (MBA, MHN, CommercialSearch)  
- Industry outlooks (CBRE, JLL)  
- Sector rankings  

**Market Analytics tab:**  
- FDIC snapshot cards  
- Screening table  
- Market Research proxies  
- Credit & Distress Signals (new add‑ons)

**Competitor Analysis tab:**  
- AOM data and firm matching

**Legal Landscape tab:**  
- Legal updates feed

---

## 8) Key data sources (plain list)
- FDIC: bank call reports (quarterly)
- FFIEC: bank call report distribution (requires credentials)
- Census (RESCONST): construction permits/starts/completions
- FRED: public economic indicators
- Google News RSS + publisher RSS: public mentions list, investing business news
- Perplexity LLM: Industry Outlook and some summaries
- SQLite (internal): AOM data and ingestion caches
