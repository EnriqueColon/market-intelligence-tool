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
| Runtime | Node 20.x |
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

### Lenses

Alongside the tabs, `components/lenses/` holds department-specific views selected by the header
department control. **A lens is additive**: it renders above the tabs and removes nothing, so every
tab stays reachable whichever department is chosen. Anything that replaces a tab is not a lens.

The department is a stated preference held in a non-httpOnly cookie, not an authenticated claim, so
it selects a view and must never gate access to data.

One exists today — the **Executive Brief**, which answers "what moved this quarter" in at most
eighteen lines rather than eleven hundred rows, and whose entries open the institution profile drawer
owned by the Market Analytics tab. A lens hands an institution to whichever view already owns the
detail rather than rendering its own copy; `confluence.md` explains why that indirection is
deliberate. Three more lenses are planned; see `docs/NEXT_VERSION_PLAN.md`.

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
| **FDIC** BankFind API | Bank financials, screening, stress map | Keyless (optional `FDIC_API_KEY`) | Analytics and map empty; hardened behind `lib/fdic-client.ts` |
| **FRED** | Verified market metrics, Market Pulse strip | **Keyless CSV endpoint** for the outlook | Pulse strip renders nothing rather than a placeholder |
| **Google News RSS** + publisher RSS | News feeds | Keyless | Falls back to GDELT |
| **GDELT DOC 2.0** | News fallback when RSS yields under 15 items | Keyless | Feeds thin out |
| **Google Programmable Search** | Market Research search | `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` | Research search unavailable |
| **OpenFreeMap** | Basemap tiles for the stress map | Keyless | Map renders without a basemap |
| **Census**, **FFIEC** | Analytics side panels | `CENSUS_API_KEY`, `FFIEC_USER_ID`, `FFIEC_TOKEN` | Sections report `configured: false` |
| **Elementix** | Participants intel API | `ELEMENTIX_API_KEY` | Returns null; feeds orphaned UI |

`FRED_API_KEY` is **not needed** by the outlook, despite appearing in older documents. It is still
read by `fetch-kpi-data.ts` and `fetch-cre-data.ts`, whose FRED paths return null without it.

### Request flow

```
Browser
  └─ middleware.ts ......... password gate (auth_token cookie vs COOKIE_SECRET)
      └─ app/page.tsx ...... server component; resolves ENABLED_TABS into a features object
          └─ dashboard ..... client components
              ├─ Server Actions (app/actions/*) ──► external APIs
              │      └─ unstable_cache, keyed by version + Eastern-time day
              └─ Route Handlers (app/api/*) ─────► Postgres / Blob / map data
```

Cron routes bypass the password gate and are protected by a bearer token instead.

---

## Getting started

### Prerequisites

Node 20.x and npm. Some ingestion scripts under `scripts/` are Python and are not needed to run the
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
npm run test:memo-evidence    # the evidence guard
npm run test:verified-metrics
npm run test:allowlist
npm run build                 # next build
```

Tests use Node's built-in runner with `--experimental-strip-types`, which requires importing local
modules **with the `.ts` extension**. TypeScript flags that as an error; it is expected and harmless.

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
  scoring/      Pure, testable ranking: opportunity score, change detection, brief ranking
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

**Never use `process.env.NODE_ENV` to detect production.** Vercel sets it to `"production"` on
preview builds too, so a dev deployment is indistinguishable from the live tool. Use
`lib/environment.ts`, and call `assertSafeToMutateProductionData()` before any irreversible write,
mapping the thrown `ProductionDataWriteError` to a 403.

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
| Add a feature flag inside a tab | Add the key to `ENABLED_TABS`, resolve it in `app/page.tsx`, pass it down as a prop — `isFeatureEnabled()` is server-only |
| Add an FDIC column | Request the field in `lib/fdic-config.ts`, map it in `lib/fdic-data-transformer.ts`, then verify against the live API |
| Force the outlook to regenerate | Bump the cache key version in `getCachedOutlook.ts`, push to `main`, confirm `keySignalFigures` is non-zero in the warm-cache log |
| Change chart appearance | `lib/chart-theme.tsx`. Use colour literals, not CSS variables — the PDF renderer cannot resolve them |
| Add a chart to both screen and PDF | Put it in `components/charts/analytics/`; both surfaces render the same component so they cannot drift |
| Sign everyone out | Rotate `COOKIE_SECRET`. Only when you intend to |
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
