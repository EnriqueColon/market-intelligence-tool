# App Tabs & Data Sources

This document explains **each tab**, its **sections**, **where the data comes from**, and **how it works**.

## App entrypoint / navigation

- **Main page**: `app/page.tsx`
- **Tabs**: News / Market Analytics / Market Research / Competitor Analysis / Legal Landscape

---

## Tab: News

Rendered by `components/industry-outlook.tsx`, `components/investing-business-mentions.tsx`, `components/public-mentions.tsx`, and `components/article-digest.tsx`.

### Section: Industry Outlook
- **UI**: `components/industry-outlook.tsx`
- **Data**: `app/actions/fetch-industry-outlook.ts` (or API route)
- **Sources**: Perplexity LLM for memo-style outlook.
- **How it works**: Generates a regional outlook focused on distressed CRE debt.

### Section: Investing Business
- **UI**: `components/investing-business-mentions.tsx`
- **Data**: `app/actions/fetch-investing-news.ts` (`fetchInvestingNews(level)`)
- **Sources**:
  - Google News RSS with investing-focused queries (private equity, REIT, capital raise, fund raising, investment firm, CRE capital markets).
  - Same publisher feeds as Public Mentions: GlobeSt, Bisnow, Commercial Observer, South Florida Business Journal.
- **How it works**:
  - Fetches and displays a table of investing/capital-activity news.
  - Respects region (national/florida/miami).
  - Supports Brief dialog via `summarizeNewsItem`.

### Section: Latest News
- **UI**: `components/news-headlines.tsx`
- **Data**: `app/actions/fetch-news.ts` (`fetchNewsHeadlines(level)`)
- **Sources**:
  - News is pulled from web sources (the action currently uses Perplexity for summarization when configured; see env vars below).
- **How it works**:
  - Caches headlines in-memory in the browser (per level) to reduce re-fetching during a session.
  - If the fetch fails, the UI now fails “softly” (no unhandled promise rejection).

### Section: Public Mentions
- **UI**: `components/public-mentions.tsx`
- **Data**: `app/actions/fetch-public-mentions.ts` (`fetchPublicMentions(level)`)
- **Sources**:
  - Google News RSS query for distressed/loan sale keywords.
- **How it works**:
  - Fetches and displays a table of public mentions.

### Section: Article Digest
- **UI**: `components/article-digest.tsx`
- **Data**: `app/actions/fetch-article-digest.ts`
- **How it works**: Paste URL, upload file, or paste text to generate a structured briefing.

---

## Tab: Market Analytics

Rendered by `components/market-analytics.tsx`. This tab is a “hub” that combines:
- FDIC data (bank financials + risk indicators)
- Public market research indicators (multi-sector)

### Section: FDIC Financials + Screening
- **UI**: `components/market-analytics.tsx` and FDIC dashboard components under `components/fdic-dashboard/`
- **Data**: `app/actions/fetch-fdic-data.ts` (e.g., `fetchFDICFinancials(...)`)
- **Sources**:
  - FDIC public datasets / API (pulled server-side).
- **How it works**:
  - Lets you filter by region and scenario.
  - Computes derived metrics (opportunity score, trends) client-side from the returned FDIC records.

### Section: Market Research (Public Data)
- **UI**: `components/market-research.tsx`
- **Data**: `app/actions/fetch-market-research.ts` (`fetchMarketResearch()`)
- **Sources**:
  - **FRED**: pulled via CSV from `https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>`
  - **FHFA HPI** (via FRED series where available)
  - **Census ACS**: `https://api.census.gov/data/...` for Miami-Dade proxy metrics
- **Geographies**:
  - **National**: FRED/FHFA series
  - **Miami-Dade (Proxy)**: mixture of (a) Miami-area FRED series where available, and (b) Census ACS proxy metrics
- **Sectors currently included**:
  - Single-Family Residential
  - Industrial
  - Retail
  - Hospitality
  - Office
- **How it works**:
  - Each metric includes: latest value, change (often YoY via `yoyPeriods`), and a short history series.
  - Some Census calls can fail due to DNS/network restrictions; the action is designed to **fail softly** (it returns partial results rather than crashing the UI).

---

## Tab: Market Research

Rendered by `components/market-research-reports.tsx`.

### Section: Industry Reports
- **UI**: `components/market-research-reports.tsx`
- **Data**: `app/data/market-research-reports.ts` (static curated content)
- **Sources**:
  - MBA Commercial/Multifamily Mortgage Firm Rankings (2024–2025)
  - MHN Top Multifamily Finance Firms (2026)
  - CommercialSearch Top Commercial Mortgage Brokers (2025)
  - MBA Year-End Servicer Rankings (2025)
  - CBRE U.S. Real Estate Market Outlook 2026
  - JLL Global Real Estate Outlook 2026
  - CBRE U.S. Cap Rate Survey H2 2025
  - JLL Debt in the Spotlight (2025/2026)
  - Sector rankings (Overall, Life Insurance, Fannie Mae, Freddie Mac, CMBS)
- **How it works**:
  - Displays curated report metadata, key takeaways, and rankings.
  - Report URLs can be added to the data file when known.

---

## Tab: Competitor Analysis (AOM)

Rendered by `components/competitor-analysis.tsx`. This is **AOM-driven competitor intelligence**.

### What “AOM” is here
- “AOM” = **Assignment of Mortgage** events exported monthly for Miami-Dade.
- These are loaded into a local SQLite database for fast querying.

### Section: AOM Overview
- **UI**: `components/competitor-analysis.tsx`
- **Data**: `app/actions/fetch-aom-data.ts` (`fetchAomSummary(...)`)
- **Source of truth**:
  - Local SQLite file: `data/aom.sqlite`
  - Table: `aom_events`

### Section: Firm Rollups
- **UI**: `components/competitor-analysis.tsx`
- **Data**: `app/actions/fetch-aom-data.ts` (`fetchAomFirmInsights(...)`)
- **How it works**:
  - Builds inbound/outbound/net activity per firm over the selected time window.
  - “Firm” is derived from the party names (and optional alias mapping if used).

### Section: Relationship Map (table)
- **UI**: `components/competitor-analysis.tsx`
- **Data**: `app/actions/fetch-aom-data.ts` (`fetchAomFirmGraph(...)`)
- **How it works**:
  - Builds **assignor → assignee** edges for a selected focal firm and time window.
  - Because real-world relationships can be cyclical, the “map” is presented as a **table of edges** (not a Sankey graph).

### Section: Top Assignors / Top Assignees
- **UI**: `components/competitor-analysis.tsx`
- **Data**: `fetchAomSummary(...)`
- **How it works**:
  - Uses aggregated counts from `aom_events.first_party` and `aom_events.second_party`.

### Section: Party Search
- **UI**: `components/competitor-analysis.tsx`
- **Data**: `app/actions/fetch-aom-data.ts` (`searchAom(...)`)
- **How it works**:
  - Runs a substring match against `first_party` / `second_party` and returns the most recent matches.

### How AOM data gets into `data/aom.sqlite`
- **Importer script**: `scripts/import_aom_to_sqlite.py`
- **Typical pipeline**:
  1. Put raw monthly exports into `data/aom-source/`
  2. Convert to clean CSVs in `data/aom-csv/` (if needed)
  3. Import into SQLite: `data/aom.sqlite`

Notes:
- The importer is designed to be resilient: it stores `raw_json` for each row so you can re-map fields later.
- If the app can’t execute `sqlite3` in the runtime environment, the AOM panels will show notes (rather than crashing).

---

## Tab: Legal Landscape

Rendered by `components/legal-updates.tsx`.

### Section: Legal Updates
- **UI**: `components/legal-updates.tsx`
- **Data**: `app/actions/fetch-legal-updates.ts` (`fetchLegalUpdates()`)
- **Sources**:
  - Public legislative / regulatory sources (as implemented in that action).
- **How it works**:
  - Filters by jurisdiction (Federal/Florida) and category (Bill/Rule).
  - If the fetch fails, the UI now fails softly and surfaces a note.

---

## Environment variables (common)

Stored in `.env.local`.

- **`FRED_API_KEY`** (optional): used by some KPI fetching code in `app/actions/fetch-kpi-data.ts` (JSON endpoint approach).
  - Market Research uses **public FRED CSV** (no key) via `fredgraph.csv`.
- **`PERPLEXITY_API_KEY`** (optional): used for certain real-time KPI/news workflows (see `fetch-kpi-data.ts` and `fetch-news.ts`).
- **`OPENAI_API_KEY`** (optional): used by `app/actions/fetch-ai-market-report.ts` to generate an AI report from market research metrics.

---

## Caching / reliability notes

- **Dev environment can be sensitive to `.next` cache corruption**. If you see missing chunk/module errors, restart dev:
  - Stop dev server (Ctrl+C)
  - `rm -rf .next`
  - `npm run dev`
- Public-data endpoints (Census/FRED) depend on your network/DNS; the UI is designed to degrade gracefully when unreachable.

