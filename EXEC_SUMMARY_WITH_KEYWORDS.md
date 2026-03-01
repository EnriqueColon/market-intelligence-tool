# Market Intelligence — Executive Summary (with Keywords)

## Purpose
This memo explains how the tool works at a high level, with the exact keyword criteria used for public‑data searches.

---

## 1) News Tab

### Public Mentions — How it works
Public Mentions surfaces **real‑estate and credit‑stress signals** from public sources. It pulls:
- Google News RSS (keyword‑based searches)
- Publisher RSS feeds (full feeds, then filtered)
- GDELT (only if RSS coverage is thin)

### Public Mentions — Keywords used in Google News RSS
**Distress / credit‑stress terms**
- "special servicing"
- "CMBS delinquency" OR "CMBS default"
- "maturity wall" OR refinancing
- "loan sale" OR "note sale"
- "receivership" OR "foreclosure" OR "workout" OR "restructuring" OR "nonaccrual" OR "commercial mortgage"

**Broader real‑estate activity terms (to widen coverage)**
- "commercial real estate" OR "real estate" OR CRE OR "office market" OR "retail market" OR "multifamily market" OR "industrial market"
- "waterfront" OR "coastal" OR "beachfront" OR "oceanfront" OR "intracoastal" OR "bayfront" OR "waterfront estate" OR "oceanfront estate"
- "luxury home" OR "mansion" OR "penthouse" OR "estate sale" OR "record sale"
- "debt fund" OR "private equity" OR "private credit" OR "credit fund" OR "bridge loan" OR "mezzanine" OR "recapitalization"
- "refinancing" OR "loan extension" OR "maturity extension" OR "lender" OR "financing"
- "auction" OR "UCC" OR "note sale" OR "loan sale" OR "foreclosure" OR "receivership" OR "distressed"

**Region filters appended to each query**
- National: "United States OR U.S. OR US"
- Florida: "Florida OR Miami OR Tampa OR Orlando OR Jacksonville OR Fort Lauderdale"
- Miami Metro: "Miami OR Miami‑Dade OR Brickell OR Miami Beach OR Fort Lauderdale OR Broward OR Doral"

### Public Mentions — Non‑technical filters (summary)
- **US‑only:** obvious non‑US currency, geographies, and non‑US domains are excluded.
- **Real‑estate context required** for RSS items.
- **Consumer/personal finance** and **entertainment/gossip** are excluded.
- Items are **scored and ranked** by relevance and regional match.

---

### Industry Outlook — What it is
Industry Outlook is a **structured summary** generated from sources, designed for investment‑committee use.

**Scope:** distressed commercial real estate debt only (CMBS stress, special servicing, delinquencies/defaults, refinancing stress, note/loan sales, workouts, receiverships, foreclosures).

**Strict prompt rules:**
- Facts must be **source‑attributed** and **non‑forward‑looking**.
- Florida/Miami must explicitly state “no facts” if none are found in the past 7 days.
- Analysis must begin with: **“LLM analysis (assumptions noted):”** and cannot introduce new facts.

---

## 2) Market Analytics Tab
Built around **FDIC data** (quarterly and lagged). The core outputs:
- Distress Opportunity Brief (FDIC‑based credit stress KPIs)
- Top 10 Focus (composite opportunity score)
- Target Screening List (bank‑level FDIC table)
- Market Research (public indicators + proxies)

No keyword searching here; this tab uses structured public data.

---

## 3) Competitor Analysis Tab (AOM)
Uses Miami‑Dade **Assignment of Mortgage** records from a local dataset. This is **structured data**, not keyword‑based search.

---

## 4) Legal Landscape Tab — Keywords
Legal updates are pulled using this **search term list** (Federal Register + LegiScan for Florida):
- "commercial real estate"
- "real estate"
- "commercial property"
- "commercial mortgage"
- "mortgage"
- "lending"
- "loan"
- "foreclosure"
- "distressed debt"
- "debt"
- "CMBS"
- "office"
- "retail"
- "industrial"
- "multifamily"
- "apartment"
- "landlord"
- "tenant"
- "lease"
- "property tax"

---

## Quick Takeaways
- **News** is keyword‑driven with strict filters to keep it relevant and US‑focused.
- **Market Analytics** is FDIC‑anchored and lagged, with clearly labeled proxies.
- **Competitor Analysis** is local AOM data, not a web search.
- **Legal** is keyword‑based and filtered by jurisdiction/type.
