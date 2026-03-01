# Market Participants & Activity Tab — Functionality, Code, Pipeline & Architecture

## Overview

The **Market Participants & Activity** tab provides a peer landscape for distressed CRE debt buyers. It combines:

1. **AOM (Assignment of Mortgage) analytics** — Miami-Dade Clerk data on mortgage assignments
2. **Participant Lookup** — Search and profile individual firms with AOM metrics
3. **Competitor Surveillance** — Multi-source event ingestion (SEC, UCC, foreclosure, etc.)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         app/page.tsx (TabsContent "competitors")                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    CompetitorAnalysis (components/competitor-analysis.tsx)  │  │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐  │  │
│  │  │ AOM Summary     │ │ Firm Rollups    │ │ Firm Counterparty Drilldown  │  │  │
│  │  │ (fetchAomSummary)│ │ (fetchAomFirm  │ │ (fetchAomFirmGraph)          │  │  │
│  │  │                 │ │  Insights)      │ │                              │  │  │
│  │  └────────┬────────┘ └────────┬────────┘ └──────────────┬──────────────┘  │  │
│  │           │                    │                         │                 │  │
│  │  ┌────────┴────────┐ ┌─────────┴─────────┐ ┌──────────────┴──────────────┐  │  │
│  │  │ Top Assignors  │ │ Party Search      │ │ ParticipantLookup           │  │  │
│  │  │ Top Assignees  │ │ (searchAom)       │ │ FirmProfilePanel            │  │  │
│  │  └─────────────────┘ └──────────────────┘ └──────────────┬──────────────┘  │  │
│  └──────────────────────────────────────────────────────────│─────────────────┘  │
│                                                              │                    │
│  ┌──────────────────────────────────────────────────────────│─────────────────┐  │
│  │ CompetitorSurveillance (components/competitor-surveillance.tsx)             │  │
│  │  Events, Metrics, Connectors (SEC, UCC, AOM, Foreclosure, Hiring, etc.)     │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Pipeline

### 1. AOM Data Flow

```
Miami-Dade Clerk AOM exports
         │
         ▼
  data/aom.sqlite  (aom_events table)
         │
         ├──► fetch-aom-data.ts (sqlite3 CLI)
         │    • fetchAomSummary
         │    • fetchAomFirmInsights (watchlist + aliases)
         │    • fetchAomFirmGraph (drilldown)
         │    • searchAom
         │
         └──► participant-lookup.ts (better-sqlite3)
              • searchParticipantFirms (fallback)
              • loadParticipantProfile (metrics)
```

**AOM schema (read-only):**
- `aom_events`: `event_date`, `first_party`, `second_party`, `doc_type`, `cfn_master_id`, `city`, `county`, `state`

### 2. Participant Intel Flow

```
User search "Rialto"
         │
         ▼
  searchParticipantFirms()
         │
         ├──► data/participant_intel.sqlite (firm, firm_alias)
         │    • Match alias_norm LIKE %query%
         │
         └──► Fallback: data/aom.sqlite
              • DISTINCT first_party, second_party WHERE party LIKE %query%
         │
         ▼
  loadParticipantProfile()
         │
         ├──► participant_intel (resolve firm, bootstrap if new)
         └──► aom.sqlite (aggregate inbound/outbound by alias set)
```

**participant_intel schema:**
- `firm`: firm_id, canonical_name, category, created_at, updated_at
- `firm_alias`: alias_id, firm_id, alias_text, alias_norm, match_type, confidence, source
- `firm_entity`: entity_id, firm_id, entity_name, entity_type, source (TODO: SEC/UCC)

### 3. Competitor Surveillance Ingestion

```
Connectors (app/ingestion/competitor_surveillance/connectors/)
         │
         ├── sec_edgar     → SEC Form D filings
         ├── rss_news      → News/RSS
         ├── manual_csv    → Manual CSV upload
         ├── aom_sync      → data/aom.sqlite → events (competitor match)
         ├── ucc_sync      → data/ingestion.sqlite (ucc_filings)
         ├── foreclosure   → data/ingestion.sqlite (foreclosure_notices)
         └── hiring_rss    → Hiring signals
         │
         ▼
  data/competitor_surveillance.sqlite
         • competitors, events, metrics
         │
         ▼
  CompetitorSurveillance UI (events, metrics, source status)
```

---

## File Structure

```
app/
├── page.tsx                    # TabsContent "competitors" → CompetitorAnalysis + CompetitorSurveillance
├── actions/
│   ├── fetch-aom-data.ts       # AOM queries (sqlite3 CLI)
│   ├── participant-lookup.ts  # searchParticipantFirms, loadParticipantProfile
│   └── competitor-surveillance.ts  # Surveillance events, metrics, ingestion
└── ingestion/
    └── competitor_surveillance/
        ├── registry.ts         # Connector registry
        ├── runner.ts           # runIngestion
        ├── base.ts             # Connector interface
        ├── connectors/
        │   ├── aom_sync.ts
        │   ├── sec_edgar.ts
        │   ├── ucc_sync.ts
        │   ├── foreclosure_sync.ts
        │   ├── hiring_rss.ts
        │   ├── rss_news.ts
        │   └── manual_csv.ts
        └── storage/
            ├── db.ts           # competitor_surveillance.sqlite
            └── queries.ts

components/
├── competitor-analysis.tsx     # Main AOM + Participant Lookup UI
├── participant-lookup.tsx      # Search input, matching participants list
├── firm-profile-panel.tsx      # Firm profile card (metrics, aliases, View flows)
└── competitor-surveillance.tsx # Events, metrics, connectors UI

lib/
└── participant-intel.ts        # normalize_name(), ensureParticipantIntelDb(), schema

data/
├── aom.sqlite                  # AOM events (external build)
├── participant_intel.sqlite    # firm, firm_alias, firm_entity (auto-created)
├── competitor_surveillance.sqlite  # Surveillance events
├── ingestion.sqlite            # ucc_filings, foreclosure_notices
├── watchlist.json              # Canonical firm names (optional)
├── watchlist-aliases.json      # firm → aliases mapping
└── major-banks-exclude.json    # Firms to exclude from rollups
```

---

## Key Code Paths

### CompetitorAnalysis (`components/competitor-analysis.tsx`)

| Section | Server Action | Data Source |
|---------|---------------|-------------|
| AOM Summary | `fetchAomSummary` | aom.sqlite |
| Firm Rollups | `fetchAomFirmInsights` | aom.sqlite + watchlist-aliases + major-banks-exclude |
| Firm Drilldown | `fetchAomFirmGraph` | aom.sqlite + watchlist-aliases |
| Party Search | `searchAom` | aom.sqlite |
| Participant Lookup | `searchParticipantFirms`, `loadParticipantProfile` | participant_intel.sqlite + aom.sqlite |

### Entity Resolution

- **AOM rollups**: `watchlist-aliases.json` maps party names → canonical firms. `watchlist.json` (optional) filters to watchlist-only.
- **Participant Lookup**: `participant_intel` DB + `normalize_name()` in `lib/participant-intel.ts`. Bootstraps firms from AOM when not found.
- **Major banks filter**: `data/major-banks-exclude.json` — firms matching these patterns are excluded from rollups when "Exclude major banks" is checked.

### Normalization

- **fetch-aom-data**: `normalize(s)` = lowercase, replace non-alphanumeric with space, trim
- **participant-intel**: `normalize_name(s)` = uppercase, strip punctuation, remove suffix tokens (LLC, INC, LTD, etc.)

---

## UI Sections (in order)

1. **Market Participants & Activity (AOM)** — Summary: total events, date range, months
2. **Firm Rollups (Entity-Resolved)** — Table: Firm, Inbound, Outbound, Net, Total, Last Seen, Top Counterparties. Controls: Exclude major banks, All/watchlist, Months (6–48)
3. **Firm Counterparty Drilldown** — Select firm, min flow; shows assignor→assignee flows, inbound/outbound counterparties
4. **Top Assignors / Top Assignees** — Side-by-side tables
5. **Party Search** — Free-text search on assignor/assignee
6. **Participant Lookup** — Search firms, persistent matching list, click to load profile
7. **Firm Profile** — Canonical name, aliases, metrics (in/out/net/total/last seen), top counterparties, affiliated entities, "View flows" button
8. **Competitor Surveillance** — Events table, metrics, connector status, ingestion controls

---

## Dependencies

- **better-sqlite3**: participant_intel, competitor_surveillance, ingestion connectors
- **sqlite3 CLI**: fetch-aom-data (execFile)
- **Next.js server actions**: All data fetching
