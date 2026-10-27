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

## 6. Step 3, done 2026-10-27: Form ADV 7.B.(1) in the drawer

Built as a local refresh that commits an extract, because IAPD serves the current ADV only as a
generated PDF — 2.6 MB for Safe Harbor, 46 MB for Bridge, 165 MB for Apollo Capital Management's
umbrella — and nothing on Vercel can hold or parse one. `scripts/refresh-peer-adv.mts` downloads
each needed adviser's PDF (300 ms apart, EDGAR's User-Agent convention), `lib/peer-intel/adv-pdf.mts`
reads it with pdf.js, `lib/peer-intel/adv.ts` parses it, and `lib/peer-intel/adv-extract.json` is
committed: 21 advisers, 593 funds, $313B gross, 878 KB. One run, about four minutes.

**What the PDF turned out to be.** Text extracts cleanly, but every yes/no answer and every option
in a checkbox list is a small drawn image — no form field, no tick glyph. The ticked image carries
more ink than the empty one (83% against 79% of dark pixels for the 13×16 yes/no boxes, 37% against
22% for the 9×9 option boxes, measured on Safe Harbor's and BH3's filings), and every page carries
both kinds, so the two are told apart by clustering each page's marks of one size at the widest
ink gap rather than by a fixed threshold. The Yes box is the leftmost on its line. pdf.js keeps an
image named `g_…` in `page.commonObjs` and any other in `page.objs`; asking the wrong store never
calls back, and a process waiting on nothing exits silently with code 0, so every lookup is bounded.

**The link.** Matching by folded name linked 0 of 4 Bayview and Camden vehicles: the registry holds
the Form D issuer, often a domestic feeder, and the ADV lists the master under another name. The
ADV quotes each fund's Form D file number (Q22) and EDGAR's submissions index carries `fileNumber`
on every filing, so the fetch now reads it onto each raise and the link is by file number first,
name second, with parentheticals kept in names because "(Employee)" and "(Offshore)" are what
separate siblings. Rate after the change: Safe Harbor 3/4, Camden 4/4, H.I.G. 2/2, 3650 1/1, Omnia
1/1, Rialto 5/9, Bayview 2/4, BH3 3/6, Bridge 2/6, Pretium 1/3, Silverview 1/2. Every unlinked
vehicle has a file number newer than the ADV's filing date (BH3's Fund III, Bridge's Fund VI) or is an
offshore sibling whose Form D is separate; the row says "not on the ADV by file number or name".

**Which advisers, and what 7.B.(1) does not cover.** A vehicle's own adviser where recorded, plus
the manager's unless every tracked vehicle names its own — which is what skips the Apollo umbrella.
The vehicle-level advisers of BREIT, BCRED and Apollo Debt Solutions, and BrightSpire's and Ladder's,
report **no private funds**, correctly: 7.B.(1) lists private funds only, and those vehicles are
registered. Madison Realty Capital's adviser reports none either, as the 2024 bulk data had shown.
Ares Management's own PDF (CRD 130074) is a blank one-page stub; the tracked Ares vehicle's adviser
(131619) reads fine.

**What it shows for Safe Harbor.** Seven funds: Fund 4 $186.7M gross and 30 owners, Fund 3 $84.1M
and 46 (down from $155.6M on the 2024 ADV), Fund 2 $1.5M, Fund 4's Cayman feeder $7.5M, Precedent
Asset Management-4D $37.2M and 4D1 $0, SHEDDF3 Tides $84.0M; Fund 1 is no longer listed. All
audited by Deloitte Miami (PCAOB 34) with unqualified opinions, except 4D1's "report not yet
received"; **Funds 3 and 4 answer No to 23(g)**, audited statements distributed to all investors,
which the panel shows in amber. If that is a filing error the correction belongs on the ADV.

**Surfacing.** A Form ADV section in the drawer (the adviser's book: funds, feeders, gross assets
over non-feeders so a master and feeder are not double counted, by type, audit and opinion counts,
statements withheld, and the funds not tracked here — the eight largest, expandable) and an ADV
block under each expanded fund row; Copy Snapshot carries both; 16 catalogue entries with basis
`adv` and the form's question numbers. The views are rebuilt from the committed file after the cache
on every read, so a new extract shows on deploy. Cost: 81 / 102 / 207 KB on the three layers'
responses, nearly all briefs of untracked funds.

**Left for later.** No scheduled refresh — the extract is as of its last run; step 5 would make the
gross asset value a series from the bulk CSVs; step 4 is continuation-vehicle detection.

## 7. Step 4, done 2026-10-27: continuation, annex and extension vehicles

A flag, never a score. The drawer lists each vehicle with what its Form D and the adviser's ADV
say and the basis on which it was attributed; the roster marks the manager with a count.

**Two sources.** The ADV, by name — including feeders a master lists by name only, which is the
only place Pretium's Residential Credit Annex Fund appears. And EDGAR full-text search for Form D
filings, which turned out to index a filing's **related persons** as well as its entity name:
searching Safe Harbor's GP "SHE DDF4 GP" returns Fund 4's filings. So a manager is searched on
its names and on the GP entities and people from its tracked raises, which finds vehicles named
after a fund rather than the firm — H.I.G.'s "H.I.G. Supreme CV, SCSp SICAV-RAIF" came only that
way.

**The query grammar, measured.** EDGAR accepts one quoted phrase followed by a bracketed group of
bare words — `"Pretium" (annex OR continuation OR CV OR extension)` — and nothing else:
a bracketed group of quoted phrases returns 0 silently, and an unbracketed `"a" OR "b" (…)`
binds the OR across everything and returns 964 hits. The first version sent one combined query
per manager and found nothing for anyone with no error. It is now one request per term, capped
at four names and four people per manager: 173 requests and 35 s for the national layer.

**Attribution.** A hit is shown when its name is on the ADV, when its entity name carries a
two-or-more-word phrase identifying the manager, or when its related persons share an exact
folded name with the manager's tracked raises; the panel says which held. A hit on a one-word
name alone is counted and listed as unconfirmed — Blackstone's two Annex funds are, because
Blackstone's tracked vehicles are registered and so have no Form D people to share, and "De Soi
Bridge Extension" is, correctly, not Bridge's. "CV" counts only as an upper-case token before a
fund word: Bridge Multifamily CV LP yes, Pretium CV Platform Holdco no.

**What it found, national, 2026-10-27.** Nine vehicles across five managers: H.I.G.'s Europe
Realty Partners III Annex Fund ($63.9M gross) and Supreme CV; Camden's adviser Certuity's Private
Equity Continuation Fund ($8.3M, 42 owners); Bridge Multifamily CV ($549.2M, 103 owners) and its
PV sleeve; Pretium's Residential Credit Annex Fund and its feeder; Ares Senior Direct Lending CV
Master Fund ($1.23B) and its offshore feeder. None of the lower-middle-market Florida managers
has one. Several Form Ds were filed before any sale and the panel says "no sale reported yet"
rather than "$0 from 0 investors".

**Not done.** No predecessor was matched by name stem for any of the nine; the rule stays because
it costs nothing and will catch "Fund III Annex" when a tracked fund is "Fund III". The search
cannot find a continuation vehicle named without those four words.

## 8. Step 5, done 2026-10-27: Form ADV history, 2011–2024

The current extract is one snapshot; this makes each figure a series. The SEC publishes every
Form ADV filing from 2011-11-05 to 2024-12-31 as CSVs in two zip archives
(`https://www.sec.gov/files/adv-filing-data-20111105-20241231-part1.zip` and `-part2.zip`, 705 MB
and 429 MB). Four tables matter: `IA_ADV_Base_A` (533 MB; every filing's date and the adviser's
CRD in column `1E1`), `ADV_Filing_Types` (which filings were annual updating amendments, and the
fiscal year), `IA_Schedule_D_7B1` (397 MB, 1.65 million rows, one per private fund per filing —
the same questions the PDF parser reads) and `ERA_Schedule_D_7B1` for exempt reporting advisers,
which contributes nothing because every adviser in the registry is registered.

**What `build:adv-history` does.** Streams the tables, keeps the filings of the 21 advisers the
extract reads — the same `advisersToRead` rule, which leaves out the umbrella filers Apollo
Capital Management (1,098 funds, 40,054 fund-filings), Ares Management and HPS Investment
Partners, 61,000 of the 70,000 fund-filings and none of it on a panel — and writes
`lib/peer-intel/adv-history.json` keyed by the fund's `805-` number. Other-than-annual filings
that repeat every answer of the filing before them are dropped (6,208 of them); annual filings
are always kept. 726 KB, 583 funds, 549 filings; the whole pass runs in seconds.

**Fund IDs hold.** Every one of the extract's 593 funds carries an 805 number, and they match the
bulk table's: Safe Harbor's Fund 3 is 805-8628615757 in both, and "Safe Harbor Equity Distressed
Debt Fund 3 Tides JV" became "SHEDDF3 Tides LLC" under 805-5917272487. The bulk table also
confirmed the PDF parser: Fund 3's "statements distributed: No" has been its answer on every
filing since 2019, so the amber mark is a standing answer, not a misread.

**The series.** One point per calendar year — the annual updating amendment where the filing
index marks one, else the last filing of the year — then the current PDF extract as the newest
point; a fund first listed after 2024 has the current point only. A year in which every filing
repeated the one before has no point, so a series can skip a year and the notes say "between the
2019 and 2021 filings". Notes compare consecutive years: gross assets at a fifth either way,
owners at any change, the audit, statements and opinion answers whenever they move. The
adviser's book by year sums gross assets over non-feeder funds on that year's filing.

**What Safe Harbor's own series say.** Fund 2: $52.0M (2019), $32.4M, $25.9M, $10.1M, $6.3M
(2024), $1.5M (2026), 20 owners throughout — a drawdown fund returning capital, which is why the
panel's caveat says a fall is what that looks like as well as what a loss looks like, and the
filing does not say which. Fund 3: $41.5M (2019), $67.1M, $109.7M, $115.7M, $155.6M (2024),
$84.1M (2026), owners 17 → 46. Fund 4: first on the 2024 filing with nothing yet, $186.7M and 30
owners by 2026. The book: $95.9M (2019) → $393.5M (2026) over three to seven funds.

**Cost.** 33 KB more on the national layer's response. The archives stay in the scratchpad, not
the repository; a re-run needs them downloaded again.
