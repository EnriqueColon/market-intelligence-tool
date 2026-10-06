# Market Intelligence Tool

An internal dashboard for commercial real estate and private credit, focused on distressed
opportunities with a national → Florida → Miami emphasis. It aggregates news, generates an AI-written
industry outlook, screens bank financials from FDIC call reports, tracks research reports and follows
legal and legislative signals.

It is password-gated, used by a small internal audience, and **in active production use**. That last
point shapes almost every convention in this repository: development happens on an isolated `dev`
deployment, and `main` is deployed automatically on push.

| | |
| --- | --- |
| Production | `main` → https://market-intelligence-tool-gilt.vercel.app |
| Development | `dev` → Vercel preview, no database, no Blob store |
| Framework | Next.js 15.5.12 (App Router), React 18, TypeScript |
| Runtime | Node 24.x |
| Host | Vercel |

---

## Documentation map

Four files are maintained together, and each answers a different question. Read the one that matches
what you need rather than starting at the top.

| File | Answers | Kind |
| --- | --- | --- |
| `README.md` (this file) | What is this, how do I run it, how do I change it safely? | Orientation |
| `confluence.md` | How does the system behave *right now*, in detail? | Technical reference |
| `SESSION.md` | What changed, when, and why was it done that way? | Dated history |
| `ROLLBACK.md` | Which commit do I go back to, and how? | Recovery |

`docs/` holds narrower guides, of which `docs/DEV_ENVIRONMENT.md` is the one most worth reading
early. `docs/NEXT_VERSION_PLAN.md` describes where the tool is going — serving underwriting, investor
relations, finance and executives from one data layer — and is the place to check before starting
anything substantial, since it records which decisions are already settled.
`EXEC_SUMMARY_WITH_KEYWORDS.md` is an older file recording the search keyword criteria behind the
news feeds; the code in `app/actions/` is the source of truth if the two disagree.

Five superseded documents were deleted on 2026-08-24 — they described Perplexity as the outlook
engine, listed tabs that no longer exist, and named environment variables no code reads. Git history
still has them if you need one. Anything in them that was still true now lives in `confluence.md`.

---

## What it does

Tabs are gated server-side in `app/page.tsx` through `isFeatureEnabled()` (`lib/features.ts`), driven
by the `ENABLED_TABS` environment variable. **Outside production every feature is on**, which is how
a tab is built on `dev` before being exposed to users.

| Tab | Feature key | What it shows |
| --- | --- | --- |
| News | `news` | The Industry Outlook / Key Signals memo, industry-specific and general finance news feeds, and an on-demand article digest |
| Market Analytics | `market-analytics` | FDIC bank screening with a state filter, institution drawer and export; a Visual Analysis chart section; a Bank Stress Map behind `bank-stress-map`; and a nested FRED/Census indicator panel |
| Market Research | `market-research` | A publisher-by-publisher research feed with a Postgres-backed archive, plus memo generation |
| Legal Landscape | `legal` | Regulatory Watch, Legislative Tracker and Enforcement & Litigation, all AI-generated. Despite the name, no LegiScan data is involved |

Production runs a subset — confirm the live `ENABLED_TABS` value in Vercel rather than trusting any
document, including this one.

Two pieces of the product are worth understanding before changing anything near them:

**The Industry Outlook pipeline** is the most failure-prone part of the system, because it is built
around a hard constraint: *the model is not trusted with numbers*. It previously produced confident,
entirely invented statistics. Every figure that reaches a reader now comes from a measured source or
a named publisher, enforced programmatically by an evidence guard rather than by prompt instructions.
`confluence.md` §4 documents the full flow.

**Market Analytics** derives roughly thirty columns from FDIC call report fields. Several FDIC field
names imply something different from what they contain, and getting one wrong puts a plausible but
badly wrong number in front of a user. `confluence.md` §4 "FDIC screening metrics" lists the ones
that have already caused incidents.

### The views in `components/lenses/`

`components/lenses/` holds two task-shaped views that **nothing renders**. There is no tab, no
route and no feature flag that reaches them — setting `ENABLED_TABS` to name them does nothing,
because they are not in `TAB_DEFS`.

That is deliberate, and it is the second time the question has been answered. They were originally
reached by picking a department from a header dropdown; the department was removed on 2026-09-29,
they were made tabs instead, and the tabs were removed the following day. The objection both times
was the same: the tool should not grow a separate destination for each piece of analysis, because a
place you have to decide to visit is a place nobody visits.

**Their calculators in `lib/scoring/` are still live and still unit-tested** — see
"Retained analysis with no caller" below. If these views return it should be inside something people
already open, such as the institution profile drawer, not as another tab.

- **Executive Brief** — "what moved this quarter" in a couple of dozen lines rather than eleven
  hundred rows, plus the institutions that have stopped filing altogether.
- **Underwriter Workbench** — one institution at a time against a matched peer cohort, the
  supervisory levels it currently sits near, and how large a loss on its CRE book it absorbs before
  reaching its capital floor.

Both used to hand an institution to the Market Analytics profile drawer rather than rendering their
own copy. `MarketAnalytics` still accepts `focusCert` and `onFocusResolved` for that, and nothing
passes them any more; they are left in place so a future caller does not have to rebuild the routing.

### Retained analysis with no caller

Five modules in `lib/scoring/` exist only to serve those two views and therefore have no caller
either. They are kept rather than deleted because each encodes something that was expensive to get
right and is recorded nowhere else, and their 39 unit tests keep them honest:

| Module | What it works out |
| --- | --- |
| `institution-change.ts` | Which institutions crossed a supervisory or watch level, and which are deteriorating without having crossed anything. The only trend-over-time analysis in the codebase |
| `cre-downside.ts` | How large a loss on the CRE book an institution absorbs before reaching its capital floor, handling risk-based and CBLR filers separately |
| `peer-cohort.ts` | A defensible peer group by size, lending mix and geography, relaxed one axis at a time, reporting which criteria survived |
| `workbench-analysis.ts` | Composes the three above |
| `quarter.ts` | FDIC report-date arithmetic |

Note the distinction from an orphaned *capability*: these are pure functions under test, not an
unreachable write path like the department watchlist was. `app/actions/executive-brief.ts` and
`app/actions/underwriter-workbench.ts` are also still present and uncalled.

---

## Tech stack

### Application

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 15.5.12, App Router | Server Components by default; Server Actions in `app/actions/` |
| Language | TypeScript 5 | `next.config.mjs` sets `typescript.ignoreBuildErrors: true` — see Maintenance notes |
| UI | React 18, Tailwind CSS v4, shadcn/ui on Radix primitives | Components in `components/ui/` |
| Charts | Recharts | Shared theme in `lib/chart-theme.tsx` |
| Maps | MapLibre GL | Dynamically imported, `ssr: false` |
| Icons / fonts | lucide-react, Geist | |
| Documents | Playwright (PDF), exceljs, jszip, docx, pdf-lib, pdf-parse | PDF route is heavier and slower than the rest |
| Validation | Zod, react-hook-form | |

### Infrastructure

| Concern | Service | Gating |
| --- | --- | --- |
| Hosting, build, cron | Vercel | — |
| Relational store | Neon Postgres via Vercel Marketplace | `POSTGRES_URL`; absent on `dev` by design |
| File store | Vercel Blob (private) | `BLOB_READ_WRITE_TOKEN`; absent on `dev` by design |
| Local data | SQLite files under `data/` | Local development only — Vercel's filesystem is read-only apart from `/tmp` |

When Postgres or Blob is absent the app **degrades rather than failing**: caching becomes a no-op,
search and summarization still run but do not persist, and upload paths return clean JSON errors.
That is exactly how `dev` and local development are meant to run, so do not "fix" it by pointing a
preview at production stores.

---

## External connectivity

Everything the tool talks to, how it authenticates, and what happens when it is unavailable. Note how
many of these are keyless — that is deliberate, and it is why the tool works on a preview deployment
with almost no configuration.

| Service | Used for | Auth | If unavailable |
| --- | --- | --- | --- |
| **OpenAI** (Responses API) | Outlook memo, article briefs, report summaries, legal feed | `OPENAI_API_KEY` | Every AI feature fails; the outlook serves a measured-figures fallback memo |
| **FDIC** BankFind API | Bank financials, screening, stress map; `/history`, `/failures` and `/institutions` for who failed, merged or closed and who acquired them | Keyless (optional `FDIC_API_KEY`) | Analytics and map empty; hardened behind `lib/fdic-client.ts` |
| **FRED** | Verified market metrics, Market Pulse strip | **Keyless CSV endpoint** for the outlook | Pulse strip renders nothing rather than a placeholder |
| **Google News RSS** + publisher RSS | News feeds | Keyless | Falls back to GDELT |
| **GDELT DOC 2.0** | News fallback when RSS yields under 15 items | Keyless | Feeds thin out |
| **Google Programmable Search** | Market Research search | `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` | Research search unavailable |
| **OpenFreeMap** | Basemap tiles for the stress map | Keyless | Map renders without a basemap |
| **Census**, **FFIEC** | Analytics side panels | `CENSUS_API_KEY`, `FFIEC_USER_ID`, `FFIEC_TOKEN` | Sections report `configured: false` |
| **Elementix** | Participants intel API | `ELEMENTIX_API_KEY` | Returns null; feeds orphaned UI |
| **govtrack** | Finds federal bills for the Legislative Tracker, and the bill-identity check | Keyless | Federal legislation disappears from the tab rather than becoming unverified. Slow on its first request of the day — see Maintenance notes |
| **GPO bulk data** (govinfo.gov) | Each federal bill's record, text, committee report and CRS summary, by bill number | Keyless — the bulk files, not the API, which needs one | Federal bill cards show govtrack's four facts and no details |
| **Federal Register** | Rules and proposed rules for the Regulatory section, with each rule's record facts and full text | Keyless | That section falls back to the model alone, which it also uses anyway for FILs and bulletins |
| **LegiScan** | Florida bills for the Legislative Tracker — sponsors, votes, text versions and the staff analyses (PDFs on flsenate.gov, read with `pdf-parse`) | `LEGISCAN_API_KEY` | Florida legislation is omitted and the feed says so in a note |

`FRED_API_KEY` is **not needed** by the outlook, despite appearing in older documents. It is still
read by `fetch-kpi-data.ts` and `fetch-cre-data.ts`, whose FRED paths return null without it.

### Request flow

```
Browser
  └─ middleware.ts ......... password gate (auth_token cookie vs COOKIE_SECRET)
      └─ app/page.tsx ...... server component; resolves ENABLED_TABS; reads the News tab's
          │                    caches (app/services/initial-news-data.ts, 2.5 s budget) so the
          │                    default tab arrives in the HTML rather than one round trip later
          └─ dashboard ..... client components; fetch only what the page did not carry
              ├─ Server Actions (app/actions/*) ──► external APIs
              │      └─ unstable_cache, keyed by version + Eastern-time day
              └─ Route Handlers (app/api/*) ─────► Postgres / Blob / map data
```

Cron routes bypass the password gate and are protected by a bearer token instead.

---

## Getting started

### Prerequisites

Node 24.x and npm. Some ingestion scripts under `scripts/` are Python and are not needed to run the
app.

### Setup

```bash
npm install
touch .env.local   # populate it before starting — see below
npm run dev        # http://localhost:3000
```

There is **no `.env.example`** in the repository, because the variable list is long and mostly
optional. `confluence.md` §8 documents every variable and the consequence of omitting each one. To
get a working local instance you need only:

| Variable | Why |
| --- | --- |
| `APP_PASSWORD` | Otherwise nobody can log in |
| `COOKIE_SECRET` | **Otherwise every request redirects to `/login` in a loop** |
| `OPENAI_API_KEY` | Only if you are working on an AI-backed feature |
| `ENABLED_TABS` | Ignored outside production, so usually unnecessary locally |

Market Analytics and the stress map need no keys at all — FDIC access is anonymous.

### Tests

Each suite runs individually; there is no aggregate `npm test`.

```bash
npm run test:environment      # environment detection
npm run test:metrics          # number formatting and unit normalisation
npm run test:opportunity-score # cohort scoring, including outlier compression
npm run test:institution-change # threshold crossings, deterioration trends, brief ranking
npm run test:fdic-cre         # what counts as CRE, and what must never be added to it
npm run test:fdic-loan-quality # NPL, noncurrent, reserve and past-due denominators and units
npm run test:headline-filing  # which filing represents a bank in the charts and exports, and who is held out
npm run test:capital-category # Prompt Corrective Action bands at the published thresholds, CBLR filers on leverage alone
npm run test:structure-events # FDIC failure, merger and closing records shaped into exit sentences
npm run test:institution-trend # eight-quarter drawer trend: units, CBLR nulls, verdict tone (runs under tsx: uses @/ imports)
npm run test:trend-narrative  # the analyst reading's prompt table, screen flags, figure guard and fallback
npm run test:bank-behavior    # bank-behaviour fields: provenance catalogue, null handling, YTD→quarter differencing (tsx)
npm run test:quarter          # FDIC report-date arithmetic
npm run test:peer-cohort      # workbench peer selection, and what it refuses to relax
npm run test:cre-downside     # the capital scenario, on both regulatory capital regimes
npm run test:memo-evidence    # the evidence guard
npm run test:verified-metrics
npm run test:legal-filter     # legal feed hygiene: collapsing repeats, and withholding stale items
npm run test:legal-relevance  # legal feed: the firm-operations bar, and the per-section windows
npm run test:legal-bills      # legal feed: bill numbers, and the fabricated bills that reached the tab
npm run test:legal-legislation # legal feed: federal bills read from the record, and companion-bill dedupe
npm run test:legal-govinfo    # legal feed: a federal bill's GPO record, text, report and CRS summary
npm run test:legal-movement   # legal feed: what changed about a bill, and why re-running cannot consume it
npm run test:legal-fedreg     # legal feed: Federal Register rules, corrections, and full-text section selection
npm run test:legal-florida    # legal feed: Florida bills, number formats, local and reviser bills, the rest of the record, staff analyses
npm run test:legal-pages      # legal feed: reading the enforcement roundup pages the model cites
npm run test:legal-applicability # which institutions a rule covers, and the two CRE-concentration units
npm run test:allowlist        # publisher allowlist, and what "all" covers
npm run build                 # next build
```

Tests use Node's built-in runner with `--experimental-strip-types`, which requires importing local
modules **with the `.ts` extension**. TypeScript flags that as an error; it is expected and harmless.

`test:allowlist` is the exception: it runs under `tsx`, because the module it covers imports a
neighbour without an extension and type stripping cannot resolve that. It also needs a local IPC
socket, so it cannot run inside a sandbox — there it crashes at module load, and because that exit
code only surfaces non-zero inside a pipeline, a careless `grep` reads the crash as a pass. All
twelve suites pass, 155 assertions between them.

Some checks need live data rather than fixtures, because they are calibrations rather than assertions
— the question is not "is this correct" but "is this still useful":

- `scripts/verify-score-distribution.mjs [STATE]` — how Opportunity Scores spread across a real FDIC
  cohort. Run after changing any scoring input or weight, and watch the IQR and the most crowded
  band. A score that puts most of the cohort in one 10-point band has stopped ranking.
- `scripts/verify-change-detection.mjs [STATE]` — what share of institutions produce a change event.
  Run after changing any threshold, the trajectory run length, or a materiality level. Fire on
  everything and it is noise; fire on nothing and the feature is dead.
- `npm run audit:fdic-columns [-- --quarter=YYYYMMDD]` — reconciles every derived Market Analytics
  column against a total FDIC publishes independently, and exits non-zero on a mismatch. Run after
  changing anything in `lib/fdic-config.ts` or `lib/fdic-data-transformer.ts`. It also reports any
  requested field the API never populates, which is how a dead field goes unnoticed for months.
- `npm run verify:executive-brief [STATE]` — what leads each section of the Executive Brief. Read the
  sample, not only the counts: the failure mode is a section topped by reporting artifacts, which
  costs trust faster than showing nothing. Imports the shipped ranking functions, so it tests real
  behaviour rather than a copy.
- `npm run verify:screening-parity` (`STATE=Florida` to scope it) — the Market Analytics tab's
  numbers over live data. It reimplements the reduction as the browser used to do it and compares
  every rendered field per institution against `lib/analytics/screening.ts`, exiting non-zero on any
  drift — about 51,500 comparisons nationally. Run it after touching the reduction, the scoring or
  the transported row shape. It also prints the payload size, which is the number that has to stay
  under Next's 2MB cache ceiling; at 1.26MB there is real but finite headroom.
- `npm run verify:visuals-payload` (`SCOPE=Florida` to scope it) — the Visual Analysis charts. Two
  assertions: the derived payload clears Next's 2MB cache ceiling, and rounding for transport moved
  no plotted value, checked against the unrounded builders. Run it after changing a chart
  derivation or anything it reads. **An oversized payload is not an error** — Next just refuses the
  write and recomputes 22 seconds of FDIC pagination on every mount — so this script is the only
  thing standing between a new chart field and a silently slow tab.
- `npm run verify:behavior-fields` — the bank-behaviour fields (held-for-sale, loan-sale gains, CRE
  charge-offs, OREO, RC-N by category, modifications). Prints every catalogue entry with its live
  value and source for the sample banks (`CERTS=`); with `CDR_SUBSET_DIR=` pointing at an FFIEC CDR
  "Call Bulk Subset of Schedules" folder it ties five fields to the published Call Report and exits
  non-zero on any mismatch; with `COHORT=1 SCOPE=…` it times the full-coverage nine-quarter pull.
  Run it after touching `FDIC_FIELDS.behavior` or `BEHAVIOR_FIELD_CATALOG`.
- `npm run verify:latest-quarter` — the FDIC quarter probe. This one is load-bearing and fails
  invisibly: its answer is part of both Market Analytics cache keys, so a wrong value serves stale
  figures for up to a week and an unstable one makes every visitor miss the cache. It already
  caught one such failure, where the row shape changed and the code fell through to a fallback
  without erroring.
- `npm run verify:legal-freshness` — calls the live API with the Legal Landscape prompts, fetches
  federal bills from the congressional record, and reports how much of the result is recent,
  on-topic, primary-sourced and — for legislation — the bill it claims to be. **It fails if a
  misattributed bill would render.** This is the check that found the tab showing `S. 1234`
  "Commercial Real Estate Credit Enhancement Act", which is really the SSI Savings Penalty
  Elimination Act. It also fails if the tab would render empty, if an unverified item would reach
  it, if over half the items cite a URL that does not exist, or if too much falls outside its
  section's window. The only check that catches a prompt the model reads as a request for history,
  or one it answers with invented citations. Run it after any edit to
  `lib/legal-updates-prompts.ts`, `lib/legal-updates-sources.ts`, `lib/legal-updates-sections.ts`,
  `lib/legal-updates-bills.ts` or `lib/legal-updates-legislation.ts` — and run it more than once,
  because the output is probabilistic and one clean run proves less than it looks.
- `npm run verify:peer-cohort [STATE=…]` — what the matched peer cohort does to the drawer's
  percentiles on live call reports, against the scope-wide figure it replaced. Fails if the
  percentiles barely move (the cohort is not being applied), if small institutions move *less* than
  large ones (size was the axis the old comparison was dominated by, so that would be backwards), or
  if any cohort describes itself as national inside a single-state universe.
- `npm run verify:peer-positioning` — opens the institution drawer in a real browser and reads the
  Peer Positioning block back. Needs a server: `npm start -- --port 3100` then
  `BASE=http://localhost:3100 npm run verify:peer-positioning`. It caught "2th percentile" and
  "23th percentile" surviving a clean build, 199 passing unit tests and a passing live-data check.
  Uses Playwright directly, because the editor's browser tool cannot reach `localhost` here.
- `npm run verify:legal-applicability` — applies the supervisory CRE thresholds to live Florida
  call reports and fails if they return implausible counts. This is what catches a concentration
  test wired to the wrong field: `creConcentration` is CRE over loans and caps at 100, so a
  300%-of-capital rule resolved against it matches nothing, on every institution, without raising
  anything. Run it after any change to `lib/legal-applicability.ts` or to the applicability
  instruction in the regulatory prompt.
- `npm run verify:tab-persistence` — that switching tabs does not refetch. Needs the app running,
  and `npm start` sets `NODE_ENV=production`, so the feature flags fail closed and **`ENABLED_TABS`
  must be passed explicitly** or the dashboard renders no tabs at all:

  ```bash
  npm run build
  ENABLED_TABS="news,market-analytics,market-research,legal,bank-stress-map" npm start -- --port 3100
  BASE_URL=http://localhost:3100 npm run verify:tab-persistence
  ```
- `npm run verify:fdic-hosts` — every FDIC endpoint against every configured host. Exists because
  the fallback host was configured for a long time in a form that 404s, which `fetchFDICData` treats
  as unrecoverable, so a primary outage would have returned empty data rather than retrying. Also
  fails the primary if it answers with a redirect.
- `npm run verify:workbench [STATE]` — the Underwriter Workbench over live data. This one *does*
  assert: it exits non-zero if a capital scenario's base ratio drifts from FDIC's published
  `RBCRWAJ` or `RBC1AAJ`. It runs the shipped transformer, row mapping and analysis rather than a
  reimplementation. Read the break-even figures split by capital regime — a systematic gap between
  the two means a floor is measuring the reporting regime rather than the risk, which has happened.

### Verifying what actually renders

**Every data-accuracy bug this tool has shipped passed a clean build and its unit tests, and was
caught by reading rendered output.** Building is not verifying. After touching either view:

```bash
npm run dev
npm run verify:lenses               # screenshots both lenses and dumps their text
SKIP_BRIEF=1 npm run verify:lenses  # workbench only; the brief is slow on a cold cache
```

It reads `APP_PASSWORD` from `.env.local` inside the Node process, so the password never reaches a
shell environment or a process list. Screenshots land in `/tmp/lens-shots`. Read the numbers against
something published, not just for absence of a stack trace.

---

## Repository layout

```
app/
  actions/      Server Actions — most external data fetching lives here
  api/          Route handlers (auth, cron, export, map, research, admin)
  ingestion/    Report ingestion sources and storage
  services/     Industry outlook pipeline
  report/       Server-rendered report route used by the PDF renderer
components/
  ui/           shadcn/ui primitives
  charts/       Chart components, incl. charts/analytics/ shared by screen and PDF
  market-analytics/heatmap/   MapLibre stress map
  lenses/       Additive department-specific views, rendered above the tabs
lib/            Domain logic: FDIC client and transforms, auth, features, caching, formatting
  scoring/      Pure, testable analysis: opportunity score, change detection, brief ranking,
                peer cohorts, the CRE capital scenario, FDIC quarter arithmetic
docs/           Focused guides (start with DEV_ENVIRONMENT.md)
data/           Local SQLite and JSON — development only
scripts/        One-off and ingestion scripts (TypeScript and Python)
```

---

## Development workflow

### Branch discipline

- **Production is `main`** and deploys automatically on push. It is in active use.
- **Development happens on `dev`**, which deploys as an isolated Vercel preview.
- Never push feature work directly to `main`. Ship with `git checkout main && git merge dev`.
- Do not commit unrelated files. This repository carries habitual uncommitted churn in
  `data/*.sqlite*`, `scripts/import_aom_to_sqlite.py`, `data/README-aom-import.md` and `.DS_Store` —
  leave it alone.

### Before you ship

1. `npm run build` passes.
2. Your own files are clean under `npx tsc --noEmit`. The repository has pre-existing type errors
   across roughly a dozen files and the build does not gate on them, so check *your* files rather
   than expecting a clean overall run.
3. `git show --stat` looks proportionate — see the line-endings trap below.
4. If behaviour changed, the four documentation files are updated.

---

## Maintenance notes

### Traps that have already caused incidents

**A bare `max-w-*` on `DialogContent` loses to the base component's `sm:max-w-lg`.** The base
class is a media-query rule and wins on every desktop viewport, so the institution drawer asked for
`max-w-6xl` and rendered 512px wide from the day it was written until `6d5169d`. Write dialog
widths as `sm:max-w-6xl`, and size anything inside a dialog with container queries (`@container`,
`@xl:grid-cols-2`), not viewport breakpoints — the dialog is narrower than the page.

**"The URL loads" is not verification on every host.** The Legal Landscape source guard treats a
403 as "the host refused us, not that the page is absent", which is correct for a rate-limiting
regulator and meant **no congress.gov URL was ever checked** — the host is behind Cloudflare and
403s everything. flsenate.gov and govinfo.gov serve soft 404s with HTTP 200. From the day the
guard was added (`e5414c3`) the Legislative Tracker rendered real bill numbers carrying invented
titles, and every gate passed them while looking like it was working. The feed itself had been
live since April 2026. If you add a host to `lib/legal-updates-sources.ts`, check by hand what it
returns for a
path that certainly does not exist; if the answer is 200 or 403, a URL check tells you nothing
there and the item needs a content-level check like `lib/legal-updates-bills.ts`.

**Do not ask a model to judge whether its own output is relevant.** The same feed's relevance gate
read `whyItMatters` — a field the prompt instructs the model to write about "relevance to
distressed CRE debt investing" — so every item certified itself and the gate passed nearly
everything. Judge on fields that describe the source, never on fields that argue for it.

**A relevance rule is only as good as the base rate it was tuned against.** The same term list that
worked on model-returned items, where most candidates are already on topic, kept 32 of 1,930
Florida bills when pointed at an entire legislative session — mostly fire-district and county bills
whose official descriptions mention liens in passing. Moving a filter from a narrow feed to a wide
one is a behaviour change even when the filter does not change, so measure it against the wide feed
before shipping. It ended with one rule for both — a heading read on every term, a body only on the
core ones — because the model path then admitted a stablecoin proposal the same way. See
"Where a term sits decides how much it counts" in `confluence.md`.

**Check whether a key in `.env.local` is actually read before trusting a document that says it is
not.** `LEGISCAN_API_KEY` sat in the environment from the start of the project. A deployment
checklist listed it as required, this README and `confluence.md` recorded that nothing read it and
that it could be deleted, and in the meantime the Legislative Tracker was asking a model to recall
Florida bill numbers and rendering ones that do not exist. The key worked the first time it was
tried. `rg -n LEGISCAN --glob '!node_modules'` is the whole check.

**A timeout tuned to how fast a service answers while you are testing it is tuned to the wrong
number.** govtrack answers its first request after an idle period in about 28 seconds and the rest
in a quarter of one. Production makes exactly one cold request a day, off a cron, so a 15-second
timeout failed every time in production and never once in testing. Retrying does not help; the
cold start now gets paid once, deliberately, before the parallel searches begin.

**The Node version is pinned in `package.json` `engines`, and Vercel retires versions.** On
2026-10-05 a push to `dev` failed before cloning finished: "Node.js Version 20.x is discontinued and
must be upgraded." The pin had been `20.x` since the project began, and `main` carried the same one,
so the next production deploy would have failed identically. Nothing in the code needed changing —
local development had been on Node 24 for some time. When a build fails at that step the fix is the
one line in `engines`, and it has to land on `main` as well as `dev`.

**Never use `process.env.NODE_ENV` to detect production.** Vercel sets it to `"production"` on
preview builds too, so a dev deployment is indistinguishable from the live tool. Use
`lib/environment.ts`, and call `assertSafeToMutateProductionData()` before any irreversible write,
mapping the thrown `ProductionDataWriteError` to a 403.

**Any feed that merges several AI-generated result sets needs a dedupe pass, and the key should be
the title rather than the URL.** The Legal Landscape tab shipped without one and rendered a single
interagency rule five times — the model had returned it once per issuing agency — until a user
reported it on 2026-09-29. The URL is the intuitive key and the wrong one, because each agency
mirrors a joint rule at its own domain, so the copies are URL-distinct and title-identical. See
`lib/legal-updates-filter.ts` and section 3 of `confluence.md`.

**A model does not know what day it is, and will not tell you so.** Any prompt asking for "recent"
or "the last N days" is measured against the model's training cutoff unless the date is in the
prompt. The Legal Landscape feed asked for the past 90 days and was observed searching
`after:2024-03-01`, returning guidance from 2006 and 2015 alongside a 2019 rule. Supplying the date
is half the fix; the model must also be told to search named sources by month, or it makes one
broad query and reports finding nothing. Verify with a live call, not by reading the prompt — see
`npm run verify:legal-freshness`.

**A resolving URL is not a citation.** Checking that a model's link loads catches invented URLs,
and nothing else. The Legal Landscape feed cited law-firm briefings and trade press that resolved
perfectly well while being summaries of a development rather than the document, alongside bill
numbers copied from the prompt's own formatting example. Pin the acceptable hosts per source type
*and* check the link, and name those hosts in the prompt so the model goes to them first. See
`lib/legal-updates-sources.ts`.

**A section that renders nothing should still render.** The Legal Landscape tab drew only the
sections that had items, so when the freshness filter emptied one it vanished, and the only sign
was a note at the top of the page that read as a failure. Draw the heading regardless and put the
explanation inside it, distinguishing "the feed found nothing" from "your filter hid it". The same
applies to any list a filter can empty.

**Two fields in this codebase are both called CRE concentration and mean different things.**
`creConcentration` is CRE over total loans and cannot exceed 100; `capitalRatios.creToTier1Tier2`
is CRE over Tier 1 + Tier 2 capital and is what every supervisory threshold means, expressed as a
multiple. Comparing a 300%-of-capital threshold against the first matches nothing, on every
institution, and raises nothing — it looks like a rule that happens to affect no one. Name any new
field for its units and check it against live data, not by reading. See
`lib/legal-applicability.ts` and `npm run verify:legal-applicability`.

**Do not ask a model to tell you which of your own entities something affects.** Ask it what the
document says about its own scope, then resolve that against your data. The Legal Landscape
exposure counts follow this split deliberately: the model has no view of the FDIC universe or the
watchlist, and an invented institution name is more dangerous than an invented URL because there
is nothing to click and check.

**One freshness window across sources that move at different speeds will empty the slow one.** The
Legal Landscape tab applied 90 days to federal agencies, which publish year-round, and to the
Florida legislature, which sits about three months a year — so the Legislative Tracker was blank
nine months out of twelve and looked broken. Windows are per section in
`lib/legal-updates-sections.ts`, and the prompt has to know the same calendar; widening the window
alone just makes the model search a longer period it still believes is quiet.

**`Date.parse` invents a January.** Given prose it cannot fully parse, it extracts a year and pins
it to the 1st of January — "Fall 2026" becomes 2026-01-01, nine months early. Anywhere a parsed
date decides whether content is too old to show, that is enough to withhold something current. Parse
only formats that name a specific day, and treat the rest as undated.

**Verify FDIC fields against the live API before trusting a field name.** `LNLSDEPR` reads like a
loan-loss reserve and is actually net loans-to-deposits; it was displayed as "Reserve Coverage",
about thirty times too large, until 2026-08-23. A one-off `curl` against
`banks.data.fdic.gov/api/financials` comparing a field against its supposed derivation takes a minute
and would have caught it.

**An FDIC field that reads like a separate category may already be counted elsewhere.** `LNREOTH`
("all other loans secured by real estate") sounds additive and is not — FDIC's total real estate
figure reconciles without it on 4,335 of 4,352 institutions. Adding it to CRE counted the same loans
twice and, together with wrongly including owner-occupied property, reported 63.5% of the American
banking system as above the 300% supervisory screen when the true figure is 9.6%. The CRE definition
now lives in one tested place, `lib/fdic-cre.ts`. Before trusting a new component field, check that
the published total still reconciles without it.

**Never guess a number's scale from its magnitude.** A shared `normalizePercent` helper divided
anything above 100 as basis points and multiplied anything at or below 1 as a decimal fraction. Both
guesses were wrong. Above: 66 of 4,352 institutions reported CET1 over 100% in 2026Q1, one at
506.72%, and all were rendered near 1%, making the country's best-capitalised banks look like its
worst. Below, and worse, because it hits the common case rather than the rare one: a third of the
industry earns under one percent on assets, so **1,441 institutions had their ROA shown a hundred
times too high**, a 1.00% ROA appearing as 99.98%. FDIC reports all of these in percent units and
says so arithmetically — its `ROA` equals `NETINC * n / ASSET5 * 100` on every institution — so
nothing needed inferring. `normalizePercent` has been deleted; use `normalizeFdicPercent`, which
trusts the reported value.

**A field name is not evidence of its units.** `NCLNLS` sits beside `NCLNLSR`, is glossed
"Noncurrent Loans to Assets", and holds dollars: it equals `P9LNLS + NALNLS` exactly on all 4,352
institutions. Read as percent points it made 78% of the industry show exactly 100.00% noncurrent.
`LNREDOM` reads residential and is every real estate loan in domestic offices. `LNREOTH` reads like a
commercial residual and is closed-end 1-4 family mortgages. Reconcile a field against a published
FDIC total before trusting what it is called — `npm run audit:fdic-columns` does this for every
column at once.

**Reconcile against a published total; do not recompute from your own parts.** Recomputing a metric
from the same fields the app already uses confirms your assumption rather than testing it. A
verification script did exactly that and validated the CRE double-count it existed to catch. What
found that bug was checking that FDIC's own `LNRE` total still balanced *without* `LNREOTH`. Also
sanity-check magnitudes against outside knowledge: 63.5% of banks above a supervisory screen, or a
column reading 100.00% on most rows, is self-evidently wrong before any arithmetic.

**Never substitute one capital measure for another across a time series.** Falling back to the
leverage ratio when CET1 is missing for a quarter compares two different measures and invents a
change that never happened.

**"Latest" per institution is not the same as the latest quarter.** Not every bank files every
quarter, so an institution's most recent row can be a quarter behind the cohort's. Reporting its
newest movement under a heading that names the current quarter dates that movement forward, which is
how the Executive Brief came to list a Q4 2025 crossing as Q1 2026 for 102 of 1,215 institutions. Any
view headed "this quarter" must require a row *in* that quarter, and say how many institutions it
therefore excluded — a silently smaller cohort reads exactly like a calmer market.

**A missing FDIC field may arrive as zero rather than null.** 1,765 of 4,352 institutions — 40.6%,
not a rounding error — elect the Community Bank Leverage Ratio and file no risk-weighted assets, and
FDIC reports `RWAJ` and `RBCRWAJ` as `0` for them while omitting `RBCT1CER` and `RBC1RWAJ` entirely.
A `!= null` guard passes that straight into a denominator and produces an infinite ratio instead of
a caught absence. Test that a denominator is positive, not that it exists.

The damage is not confined to denominators, and that is the part worth internalising. A zero
*capital ratio* is not a missing value, it is the most alarming value the field can hold: those
institutions rendered at 0.00% total risk-based capital, indistinguishable from the 2 banks
genuinely below 8%. It also silently defeats `??`, which only falls through on null — so
`cet1Ratio ?? leverageRatio` returned zero forever rather than the ratio a CBLR filer actually
reports, and pinned 40% of the industry at the bottom of the Opportunity Score's capital component.
Convert absence to `null` at the boundary, in the transformer, and give the field a nullable type so
consumers must decide what absence means. `normalizeCapitalRatioPercent` does this;
`npm run audit:fdic-columns` prints which capital fields currently use zero to mean absent.

**Two regulatory levels are not comparable just because both are percentages.** The 9% CBLR figure is
the threshold for *electing* a reporting regime; the 8% total risk-based and 4% leverage figures are
PCA *capital adequacy* categories; the 300% CRE concentration figure is a *supervisory screening*
criterion that triggers scrutiny rather than any consequence. Measuring risk-based filers against
their adequacy floor and CBLR filers against their election trigger ranked the CBLR banks as
uniformly more fragile — the scenario was measuring which regime a bank had elected. Establish what a
level means before ranking institutions against it.

**FDIC report dates must be `YYYYMMDD`.** A hyphenated `2025-09-30` is not rejected — it matches zero
rows. This silently emptied every map endpoint for the entire life of the feature, and it presents as
missing data rather than as an error.

**The current quarter is never published.** Call reports lag by roughly two quarters, so code that
defaults to "this quarter" returns nothing.

**Bump the cache version to force regeneration.** Generated content is cached for a day, keyed by a
version string. After changing prompt or pipeline behaviour, production will keep serving yesterday's
output until the version is bumped.

**Four files carry CRLF line endings** (`lib/map-stress-utils.ts`, `app/actions/cre-deterioration.ts`,
`app/actions/export-market-analytics-report.ts`, `lib/noncurrent-debug.ts`). Editing them with a
script in text mode silently rewrites every line and turns a small change into a thousand-line diff.
There is no `.gitattributes` to normalise this yet.

**`CRON_SECRET` must match between GitHub Actions and Vercel.** A mismatch does not error visibly —
the post-deploy warm-cache run returns 401 and the symptom is simply that the tool is slow.

**Local dev is sensitive to a corrupted `.next` cache.** Missing chunk or module errors that make no
sense against your source usually mean the build cache, not your code. Stop the dev server,
`rm -rf .next`, and start it again.

### Making common adjustments

| To do this | Change this |
| --- | --- |
| Expose or hide a tab | `ENABLED_TABS` in Vercel. No code change |
| Surface the Executive Brief or Underwriter Workbench again | **Not a flag change** — `ENABLED_TABS` cannot reach them, because they are not in `TAB_DEFS`. Adding them back as tabs has been rejected twice; prefer folding the analysis into the institution profile drawer. See "Lenses" above |
| Add a feature flag inside a tab | Add the key to `ENABLED_TABS`, resolve it in `app/page.tsx`, pass it down as a prop — `isFeatureEnabled()` is server-only |
| Add an FDIC column | Request the field in `lib/fdic-config.ts`, map it in `lib/fdic-data-transformer.ts`, then verify against the live API |
| Show a new field in the Market Analytics tab | Add it to the row in `lib/analytics/screening.ts` — the browser only renders what that module sends. Then run `verify:screening-parity` and check the printed payload size still clears 2MB |
| Add a tab, or touch `TabsContent` | Visited panels are force-mounted, and `forceMount` stops Radix setting `hidden` — so the panel must carry `data-[state=inactive]:hidden` or it will render stacked on the others. Anything with a canvas inside also needs to re-measure on reveal, since hiding is `display: none`. Run `verify:tab-persistence` |
| Add or change an analytics chart | Derivation goes in `lib/analytics-chart-data.ts`, so screen and PDF share it; expose the series from `lib/analytics/visuals.ts`; then run `verify:visuals-payload`. Do not chart `ReportData` directly from the client — at 5.46MB it cannot be cached, which is what made the tab slow |
| Change what the tab's scores mean | Bump `market-analytics-screening-v1` in `app/actions/market-analytics-screening.ts`, or cached entries keep serving scores computed the old way |
| Force the outlook to regenerate | Bump the cache key version in `getCachedOutlook.ts`, push to `main`, confirm `keySignalFigures` is non-zero in the warm-cache log |
| Change chart appearance | `lib/chart-theme.tsx`. Use colour literals, not CSS variables — the PDF renderer cannot resolve them |
| Add a chart to both screen and PDF | Put it in `components/charts/analytics/`; both surfaces render the same component so they cannot drift |
| Sign everyone out | Rotate `COOKIE_SECRET`. Only when you intend to |
| Add a tab | Component plus its server action, then a `TAB_DEFS` entry, a `TabsContent` block and an `EnabledTabs` key in `market-intelligence-dashboard.tsx`, an `isFeatureEnabled()` call in `app/page.tsx`, and **a `TAB_GRID_COLS` entry for the new column count** — Tailwind cannot see `grid-cols-${n}`. Consider first whether it belongs inside an existing tab; two views have now been removed from the tab bar for being destinations nobody visits |
| Keep a new tab off the ~50s cold load | Warm it in `app/api/cron/warm-cache/route.ts` behind its own flag, and keep its `revalidate` under 24h, or the daily cron will always find it fresh and never refresh it |
| Diagnose "the tool is slow" | Almost always cold caches. Check the latest `Warm Cache After Deploy` run in GitHub Actions |
| Roll back | `ROLLBACK.md` |

---

## Keeping the documentation current

At the end of any session in which something was committed, update all four files — this one
included — before finishing:

- **`README.md`** — only when the stack, connectivity, setup or workflow actually changed. It is
  orientation, not a changelog.
- **`SESSION.md`** — a new dated entry at the top: what changed and why, the resulting state, and
  what is still open.
- **`ROLLBACK.md`** — every new commit, with its short SHA verified via
  `git log --format='%h|%ci|%s'` rather than written from memory.
- **`confluence.md`** — only where behaviour changed, describing how the system works now.
