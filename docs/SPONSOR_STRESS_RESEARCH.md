# PE sponsor stress monitor — research and proposal

*Written 2026-10-26. The user's decision: hold the full integration; build the lowest-hanging
pieces step by step. Step 2 (adviser CRDs in the registry) is done; see §4. Nothing else is built.*

Every source fact below was checked against sec.gov or the source site on 2026-10-26, not from
memory. Where a check failed or was thin, it says so.

## 1. What the codebase already has

- **Pattern:** pure logic in `lib/` with tests; `app/services/*` fetch uncached; `app/actions/*`
  wrap in `unstable_cache`; crons in `vercel.json` (05:00 and 05:15 UTC, 300-second ceiling);
  provenance catalogues (`lib/peer-intel/catalog.ts`); readings built from figures, never a model.
- **"Pull → snapshot → diff → alert" exists only in memory.** Cohort Changes
  (`lib/analytics/cohort-watch.ts`, `lib/scoring/institution-change.ts`) diffs the eight quarters
  FDIC returns in one call; the Form D raise (`lib/peer-intel/form-d.ts`) diffs the filing trail
  EDGAR returns. **Nothing persists a prior period, and no outbound alert channel exists** — no
  email, Slack, webhook or n8n anywhere. Alerts are on-screen signals (`SIGNALS`,
  `PEER_SIGNAL_THRESHOLDS`). The only outward interface is `/api/analytics/v1/*` (bearer key).
- **Database:** `@vercel/postgres` via `lib/db.ts`, `isDbEnabled()`; schema by
  `app/api/admin/init-db/route.ts` with `CREATE TABLE IF NOT EXISTS`; production only. Vercel Blob
  for files, append-only by convention.
- **Python `app/ingestion/`:** FFIEC and Census work; the UCC and foreclosure connectors are stubs
  that have never produced a row; writes local SQLite, cannot run on Vercel. The county
  assignment-of-mortgage collector was removed 2026-10-26 at the user's instruction.
- **Reusable:** `edgar-contract.ts` (User-Agent, 8 req/s, retry), `rateLimited` /
  `mapWithConcurrency`, `parseFormD` / `parseTerms`, `plainText`, the XBRL reader, `pdf-parse`;
  matching: `personKey` (`people.ts`), alias phrase matching (`developments.ts`), `registry.ts`
  aliases and `UNRESOLVED_WATCH`, the `discover-peers` / `lookup-peer` curation scripts; scoring:
  `seller-likelihood.ts` (score + confidence + state) and `METRIC_SPECS` (labelled thresholds with
  materiality floors); `verify:*` scripts as the validation habit.

## 2. Sources, as verified

| Source | Access | Cadence | Identifiers | Verified facts and limits |
| --- | --- | --- | --- | --- |
| **Form ADV, through 2024-12-31** | SEC FOIA bulk CSV, two zips (705 MB + 429 MB), multi-table | One-off | `FilingID` → adviser CRD; fund `805-` ID | Per-fund tables exist for registered and exempt advisers: `IA_Schedule_D_7B1`, `ERA_Schedule_D_7B1`, `ERA_Schedule_A_B`, `7B1A23` (auditor, PCAOB), `7B1A24` (prime broker). 7B1 columns include Fund Name, Fund ID, 3(c)(1)/(7), Master/Feeder, Fund Type, Gross Asset Value, Minimum Investment, Owners, %Owned Non-US, Annual Audit, GAAP, FS Distributed, Unqualified Opinion, Custodians, Administrator, Marketing. Every filing 2011–2024. |
| **Form ADV, 2025 on** | IAPD only, by SEC's statement. `api.adviserinfo.sec.gov/search/firm?query=` → JSON with CRD, SEC number, other names, address (a JSON string); `reports.adviserinfo.sec.gov/reports/ADV/{CRD}/PDF/{CRD}.pdf` → full current ADV | Annual amendment within 90 days of FY end; other-than-annual any time; **current filing only** | CRD; `805-` fund ID; item 22 Form D file number | Safe Harbor's ADV (CRD 305314): 55 pages, `pdftotext` reads it; seven funds with GAV, owners, Form D numbers and audit answers. Detail JSON endpoints 403; result cap of 20 per search; `nrows` ignored. Monthly "IA Reports" XLSX are adviser-level Items 1–11, not fund rows. ERAs file Items 1, 2, 3, 6, 7, 10, 11 — 7.B.(1) and Schedule A/B, no Item 5. |
| **Form D** | Quarterly zips through 2026 Q3 (`sec.gov/dera/data/form-d`); EDGAR submissions API intra-quarter (already used) | Quarterly / weekly | `ACCESSIONNUMBER`; `PREVIOUSACCESSIONNUMBER` chains amendments; `ISSUERS.CIK` | Tables `FORMDSUBMISSION, ISSUERS, OFFERING, RECIPIENTS, RELATEDPERSONS, SIGNATURES`; `OFFERING` carries `TOTALOFFERINGAMOUNT, TOTALAMOUNTSOLD, TOTALREMAINING, MINIMUMINVESTMENTACCEPTED, TOTALNUMBERALREADYINVESTED`; amendments included. |
| **EDGAR rules** | sec.gov/os/accessing-edgar-data | — | — | User-Agent "Sample Company Name AdminContact@domain.com"; "current max request rate: 10 requests/second"; no crawling. `edgar-contract.ts` complies. |
| **BDC schedules of investments** | SEC "BDC Data Sets", monthly zips (`sec.gov/data-research/sec-markets-data/bdc-data-sets`); `soi.tsv` at the zip root | Monthly | `adsh`, `cik`, `Investment, Identifier Axis` (filer-specific string) | August 2026: 186,669 rows, 252 columns. Present: issuer affiliation, investment type, interest rate, basis spread, maturity, principal, cost, fair value, % of net assets, **`Investment, Interest Rate, Paid in Kind` (11,265 rows)**. **Non-accrual is effectively untagged** (`Financial Instrument Performance Status Axis` on 8 rows; `InvestmentPerformanceStatus` on 1) — it lives in HTML footnotes. The sponsor is never named. LMM lenders present: Main Street, Fidus, Capital Southwest, Monroe, Stellus, Gladstone, Audax, PennantPark, Crescent, WhiteHorse, Nuveen Churchill, Twin Brook, Trinity, Varagon, Kayne, Oxford Square, Great Elm. |
| **UCC — Florida** | floridaucc.com is a JavaScript app; its search host does not resolve from scripts; no bulk product found; third parties disagree on fees | — | debtor name | Not scriptable today. |
| **UCC — Delaware** | No online UCC information (Division's own FAQ); phone or a UCC Authorized Searcher, per search | — | — | Manual, paid. |
| **Bankruptcy** | CourtListener REST API: token auth; 5/min, 50/hour, 125/day quoted; alerts by email or webhook; commercial agreements on request | Event | case name | The only scriptable path short of paid PACER. |
| **WARN (Florida)** | FloridaCommerce page returns 403 to scripts; aggregators disagree with each other | — | — | Manual or browser. |
| **Form PF** | Confidential | — | — | Unavailable. |

## 3. Entity resolution

Deterministic first: sponsor → adviser **CRD** (IAPD search, confirmed by state, other names and
the GP / investment-manager entity the manager's own Form D names — see §4); adviser → funds by
**805- ID**; fund → Form D by item 22's file number and by `ISSUERS.CIK` (the registry's vehicle
CIKs); BDC position → portfolio company by the filer's identifier string. Fuzzy second, with a
review queue: portfolio-company names across BDCs, UCC debtor names, continuation-vehicle name
patterns. **The link with no public source is sponsor → portfolio company**; it must be seeded.

## 4. Step 2, done 2026-10-26: adviser CRDs in the registry

`lib/peer-intel/iapd.ts` scores IAPD hits on exact name, a registry name with a management suffix,
other names against aliases, the Form D's GP and investment-manager entities, state, city and
scope; `npm run resolve:peer-crds` proposes, `npm run verify:peer-crds` checks the registry
against IAPD. Two runs over all 26 managers, then a review:

- **20 manager advisers recorded**, each with a `basis`. The Form D link decided the surprising
  ones: Omnia's fund names Omnia Family Wealth as its adviser; Camden's names Certuity; BH3's
  names BH3 Fund Advisors, which IAPD cannot find under "BH3 Management". H.I.G. resolved through
  its relying adviser Bayside Capital. Apollo, Ares and HPS are recorded as umbrella filers.
- **5 vehicle advisers** where the vehicle's differs: BREIT → BX REIT Advisors, BCRED → Blackstone
  Credit BDC Advisors, Apollo Debt Solutions → Apollo Credit Management, Ares Strategic Income →
  Ares Capital Management, HPS Corporate Lending → HPS Advisors — each the name the vehicle's own
  filings carry (EDGAR full-text counts in the basis).
- **6 reviewed as no adviser:** Atipana, R&R Capital, Integra, SEGLO, Naso, Gelt. Small lenders
  without a registered adviser; their "ambiguous" search results were single-word queries
  returning thousands of unrelated firms.
- Traps found: IAPD's address is a JSON string inside a field; "(RELYING ADVISOR)" qualifiers must
  be stripped before name comparison; the 20-result cap hides large sponsors' advisers, so a
  capped set without a strong match is "ambiguous", never "none".

## 5. Proposal, as it stood before the hold

1. **Extend the Peers tab**, not a new module; raw snapshots in Blob, derived rows in Postgres by
   the `init-db` pattern.
2. **Tables:** sponsors, advisers, funds, filing_snapshots, adv_fund_periods, adv_control_persons,
   portfolio_companies + bdc_positions, entity_links (with method, confidence, reviewedAt),
   signals + scores.
3. **Ingestion order:** ADV current (monthly PDF hash check) and 2011–2024 history (one-off); Form D
   (already live); BDC SOI monthly for ~15 LMM lenders; CourtListener alerts; UCC/WARN deferred.
4. **Signals** with named thresholds in one config object; score = weighted fired severity over
   observed weight, unjudged signals lowering confidence not score; green < 30, yellow 30–60, red ≥
   60, with a confidence floor below which the state is "insufficient data".
5. **Surfacing:** a drawer section and ranked panel; `/api/peers/v1/sponsor-stress`; push delivery
   is a separate decision, since none exists.
6. **MVP:** Form ADV + Form D for a seed list; then BDC; then the rest.
7. **Risks:** 2025+ ADV is PDF-only; non-accrual needs HTML; sponsor → portfolio company has no
   public source; county mortgage assignments are out of scope by decision; no alert channel; the
   cron budget.

**Decided 2026-10-26:** step 1 (fundraising-stress signals from Form D alone) is not built — the
inputs are reliable but a verdict from them is not, since Form D has no closed flag, trails are
sparse, and no backtest exists. The next step is 3: Form ADV 7.B.(1) in the drawer.
