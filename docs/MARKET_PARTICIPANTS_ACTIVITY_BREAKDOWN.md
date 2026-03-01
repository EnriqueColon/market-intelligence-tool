# Market Participants & Activity — Complete Tool Breakdown

A comprehensive reference for understanding the tool's architecture, components, data flow, and functionality. Use this document when discussing changes with an LLM or for onboarding.

---

## 1. Purpose & Overview

The **Market Participants & Activity** tab is a peer landscape for distressed CRE debt buyers. It answers:

- **Who is assigning mortgages to whom?** (AOM flows)
- **Which firms are most active as assignors vs assignees?**
- **What are the counterparty relationships for a given firm?**
- **How do I search and profile individual firms?**

**Data source:** Miami-Dade Clerk Assignment of Mortgage (AOM) bulk exports, loaded into a local SQLite database. The tool does **not** use live API lookups—it relies on pre-loaded bulk data.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  app/page.tsx → TabsContent "competitors"                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  CompetitorAnalysis (components/competitor-analysis.tsx)                     │
│  ├── AOM Summary (total events, date range)                                 │
│  ├── Firm Rollups (inbound/outbound by firm, watchlist filter)              │
│  ├── Firm Counterparty Drilldown (select firm → flows table)                │
│  ├── Top Assignors / Top Assignees (side-by-side tables)                    │
│  ├── Party Search (free-text search on assignor/assignee)                   │
│  └── Participant Lookup → Firm Profile Panel                                 │
│                                                                              │
│  CompetitorSurveillance (components/competitor-surveillance.tsx)             │
│  └── Multi-source events (SEC, UCC, AOM, foreclosure, etc.)                  │
└─────────────────────────────────────────────────────────────────────────────┘

Data Layer:
  data/aom.sqlite          ← AOM events (built from bulk CSV/TSV)
  data/participant_intel.sqlite  ← Firms, aliases, entities
  data/watchlist.json     ← Canonical firm names (optional)
  data/watchlist-aliases.json  ← Firm → aliases mapping
  data/major-banks-exclude.json ← Patterns to exclude from rollups
```

---

## 3. Data Pipeline

### 3.1 AOM Data Ingestion

**Source:** Miami-Dade Clerk bulk exports (CSV/TSV)

**Import script:** `scripts/import_aom_to_sqlite.py`

```bash
python3 scripts/import_aom_to_sqlite.py --input "data/aom-source" --db "data/aom.sqlite"
```

- Reads CSV/TSV from `data/aom-source/` (or custom path)
- Maps columns: `REC_DATE`, `DOC_TYPE`, `FIRST_PARTY`, `SECOND_PARTY`, `PARTY_CODE`, `CFN_YEAR`, `CFN_SEQ`, `REC_BOOK`, `REC_PAGE`, etc.
- Supports flexible headers: `FIRST_PARTY` or `ASSIGNOR`, `SECOND_PARTY` or `ASSIGNEE`
- Handles combined `PARTY_NAME` with " / " separator
- Output: `data/aom.sqlite` with `aom_events` table

**aom_events schema (key columns):**
| Column        | Type   | Description                                      |
|---------------|--------|--------------------------------------------------|
| event_date    | TEXT   | Recording or document date (YYYY-MM-DD)          |
| doc_type      | TEXT   | Document type (e.g. ASSIGNMENT OF MORTGAGE)      |
| first_party   | TEXT   | Assignor (transferring FROM)                     |
| second_party  | TEXT   | Assignee (transferring TO)                       |
| party_code    | TEXT   | R=Reverse/Assignor, D=Direct/Assignee (if present)|
| cfn_master_id | TEXT   | Clerk's file number                              |
| cfn_year      | TEXT   | CFN year                                         |
| cfn_seq       | TEXT   | CFN sequence                                     |
| rec_book      | TEXT   | Record book                                      |
| rec_page      | TEXT   | Record page                                      |
| state, county, city | TEXT | Geography                                |

**Important:** The bulk export may produce "mirrored" rows (one row per party, so assignor and assignee appear in both columns depending on row). The schema includes `party_code` for directional inference (R=Assignor, D=Assignee), but the current app logic assumes `first_party` = assignor and `second_party` = assignee. If the export is mirrored, this can be incorrect.

---

### 3.2 AOM Queries (fetch-aom-data.ts)

**Technology:** Uses `sqlite3` CLI via `execFile` (not better-sqlite3). Runs from project root.

**Exported functions:**

| Function              | Purpose                                                                 |
|------------------------|-------------------------------------------------------------------------|
| `fetchAomSummary`      | Total events, date range, doc type counts, top assignors, top assignees, monthly counts |
| `searchAom`            | Free-text search on first_party or second_party; returns event rows     |
| `fetchAomFirmInsights` | Firm-level rollups: inbound, outbound, net, monthly trend, top counterparties, 30d/90d metrics |
| `fetchAomFirmGraph`    | Graph data for drilldown: nodes, links (assignor→assignee), inbound/outbound lists for focal firm |

**Entity resolution:** Uses `loadWatchlistData()` from `app/lib/watchlist.ts`:
- `watchlistSet`: canonical firm names (from watchlist.json)
- `aliasLookup`: Map<normalized_name, canonical_firm>
- `normalize(s)`: lowercase, replace non-alphanumeric with space, trim

**Direction logic:** 
- Assignor = `first_party`, Assignee = `second_party` (no use of `party_code` currently)
- Inbound = firm appears as assignee (second_party)
- Outbound = firm appears as assignor (first_party)

**Major banks filter:** `data/major-banks-exclude.json` — JSON array of substring patterns. Firms matching any pattern are excluded from rollups when "Exclude major banks" is checked.

**Role classification:** `classifyParticipantRole()` from `app/lib/participant-activity.ts` — labels firms as Accumulator, Distributor, Intermediary, Registry/Utility, or Agency/Gov based on inbound/outbound/net 90d metrics.

---

### 3.3 Participant Intel (participant-lookup.ts + participant-intel.ts)

**Purpose:** Search and profile firms with canonical names and aliases.

**participant_intel.sqlite schema:**
- `firm`: firm_id, canonical_name, category, created_at, updated_at
- `firm_alias`: alias_id, firm_id, alias_text, alias_norm, match_type, confidence, source
- `firm_entity`: entity_id, firm_id, entity_name, entity_norm, entity_type, source

**Search flow (`searchParticipantFirms`):**
1. Search `participant_intel` by `alias_norm LIKE %query%`
2. If no match, fallback to `aom.sqlite`: `DISTINCT first_party, second_party WHERE party LIKE %query%`

**Profile load (`loadParticipantProfile`):**
1. Resolve firm by ID or name (participant_intel)
2. If not found, **bootstrap**: create new firm + alias in participant_intel
3. Load aliases from firm_alias
4. Query AOM for metrics: match rows where first_party or second_party matches any alias (via `normalize_name`)
5. Assignor match → outbound; Assignee match → inbound
6. Return: canonicalName, category, aliases, metrics, topCounterparties, entities

**`normalize_name` (lib/participant-intel.ts):** Uppercase, strip punctuation, remove suffix tokens (LLC, INC, LTD, etc.). Used for matching only.

**`loadParticipantProfileFromWatchlist`:** Same as loadParticipantProfile but uses watchlist canonical_name + aliases for AOM matching (no participant_intel lookup).

---

### 3.4 Watchlist (app/lib/watchlist.ts)

**Files:** `data/watchlist.json`, `data/watchlist-aliases.json`

**watchlist.json schemas:**
- **New:** `[{ canonical_name, category, aliases, notes }]`
- **Legacy:** `["Firm A", "Firm B"]` (uses watchlist-aliases.json for aliases)

**watchlist-aliases.json:** `{ "Firm A": ["Alias 1", "Alias 2"], ... }`

**Output:** `watchlist`, `watchlistSet`, `aliasesByFirm`, `aliasLookup` (normalized → canonical)

---

## 4. UI Components

### 4.1 CompetitorAnalysis (components/competitor-analysis.tsx)

**Sections (top to bottom):**

1. **ParticipantExecutiveSnapshot** — Summary KPIs (if used elsewhere)
2. **AOM Summary Card** — Total events, date range, months; notes if DB missing
3. **Firm Rollups Table** — Firm, Inbound, Outbound, Net, Total, 30d, 90d, Trend, Last Seen, Top Counterparties
   - Controls: Exclude major banks, All/watchlist, Months (6–48)
   - Click row → sets selectedFirm for drilldown
4. **Firm Counterparty Drilldown** — Select firm dropdown; table of assignor→assignee flows; inbound/outbound counterparty lists
5. **Top Assignors / Top Assignees** — Two side-by-side tables
6. **Party Search** — Input + Search button; table of matching events (date, doc type, assignor, assignee, CFN)
7. **ParticipantLookup** — Search input, matching list, Watchlist dropdown
8. **FirmProfilePanel** — Shown when profile loaded; metrics, aliases, top counterparties, "View flows" button

**State:** summary, insights, counterpartyData (graph), searchRows, selectedFirm, lookupProfile, excludeMajorBanks, scope, monthsBack, minEdgeCount, query

---

### 4.2 ParticipantLookup (components/participant-lookup.tsx)

- Search input with debounce (300ms)
- Fetches `searchParticipantFirms(query)` → displays candidates
- Watchlist dropdown: `fetchWatchlistFirms()` → select firm → `loadParticipantProfileFromWatchlist(name)`
- Click candidate or "Load profile" → `loadParticipantProfile(idOrName)` → `onProfileLoaded(profile)`

---

### 4.3 FirmProfilePanel (components/firm-profile-panel.tsx)

- Displays: canonicalName, category, aliases, metrics (inbound, outbound, net, total, lastSeen), topCounterparties, entities
- "View flows" → `onViewFlows(canonicalName)` → parent scrolls to drilldown and sets selectedFirm
- "Dismiss" → `onDismiss()`

---

## 5. Competitor Surveillance (separate subsystem)

**Purpose:** Ingest events from multiple sources (SEC, UCC, AOM, foreclosure, etc.) and match to competitors.

**Connectors:** `app/ingestion/competitor_surveillance/connectors/`
- `aom_sync.ts` — Reads aom.sqlite, matches first_party/second_party to competitors, emits SurveillanceEvent
- Others: sec_edgar, ucc_sync, foreclosure, hiring_rss, rss_news, manual_csv

**Storage:** `data/competitor_surveillance.sqlite`

**UI:** CompetitorSurveillance component — events table, metrics, connector status.

---

## 6. File Reference

| Path | Purpose |
|------|---------|
| `components/competitor-analysis.tsx` | Main AOM + Participant Lookup UI |
| `components/participant-lookup.tsx` | Search input, candidates, watchlist |
| `components/firm-profile-panel.tsx` | Firm profile card |
| `app/actions/fetch-aom-data.ts` | AOM queries (sqlite3 CLI) |
| `app/actions/participant-lookup.ts` | searchParticipantFirms, loadParticipantProfile |
| `app/actions/fetch-watchlist.ts` | fetchWatchlistFirms (server action) |
| `app/lib/watchlist.ts` | loadWatchlistData |
| `app/lib/participant-activity.ts` | classifyParticipantRole |
| `lib/participant-intel.ts` | ensureParticipantIntelDb, normalize_name, schema |
| `scripts/import_aom_to_sqlite.py` | Bulk import CSV/TSV → aom.sqlite |
| `app/ingestion/competitor_surveillance/connectors/aom_sync.ts` | AOM → surveillance events |

---

## 7. Known Limitations & Design Decisions

1. **Direction assumption:** App assumes `first_party` = assignor, `second_party` = assignee. Bulk exports that produce mirrored rows (one per party) may require `party_code` (R/D) for correct direction. The schema supports `party_code` but it is not used in fetch-aom-data or participant-lookup.

2. **No live API:** All AOM data comes from pre-loaded bulk exports. No Miami-Dade Clerk API integration for discovery/search.

3. **sqlite3 CLI vs better-sqlite3:** fetch-aom-data uses `execFile` with sqlite3 CLI; participant-lookup uses better-sqlite3. Different tools, same DB.

4. **Entity resolution:** Watchlist + aliases drive firm rollups. Firms not in watchlist/aliases appear as "unmatched" in Firm Insights.

5. **Bootstrap on profile load:** If a firm is not in participant_intel, loadParticipantProfile creates it and an alias from the search name. No manual firm creation UI.

---

## 8. Data Flow Summary

```
Bulk CSV/TSV (Miami-Dade)
    → import_aom_to_sqlite.py
    → data/aom.sqlite (aom_events)

aom.sqlite
    → fetchAomSummary, searchAom, fetchAomFirmInsights, fetchAomFirmGraph
    → CompetitorAnalysis UI

aom.sqlite + watchlist + participant_intel
    → loadParticipantProfile, searchParticipantFirms
    → ParticipantLookup, FirmProfilePanel

aom.sqlite + competitor_surveillance
    → aom_sync connector
    → competitor_surveillance.sqlite
    → CompetitorSurveillance UI
```

---

## 9. Configuration Files

| File | Format | Purpose |
|------|--------|---------|
| `data/watchlist.json` | JSON | Canonical firms, categories, aliases |
| `data/watchlist-aliases.json` | JSON | Supplemental alias mapping |
| `data/major-banks-exclude.json` | JSON array of strings | Substring patterns to exclude from rollups |
