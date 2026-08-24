# Market Intelligence Tool — Technical Reference

Maintenance handover for developers who did not build this. Describes how the system works *now*.
Keep it current at the end of every session; `SESSION.md` records history, this file records
behaviour.

Verified against `dev` @ `908d083` / `main` @ `eabf088` on 2026-08-18.

---

## 1. What it is

An internal market intelligence dashboard for commercial real estate and private credit, focused on
distressed opportunities with a national → Florida → Miami emphasis. It aggregates news, generates an
AI-written industry outlook, surfaces bank and CRE market analytics, tracks research reports, and
follows legal/legislative signals.

It is password-gated and used by a small internal audience. **It is in active production use**, which
is why development happens on an isolated `dev` deployment (see `docs/DEV_ENVIRONMENT.md`).

## 2. Runtime and deployment

| | |
| --- | --- |
| Framework | Next.js 15.5.12, App Router |
| Node | 20.x (pinned in `package.json` engines) |
| Host | Vercel |
| Production | `main` → https://market-intelligence-tool-gilt.vercel.app |
| Development | `dev` → Vercel preview, no database, no Blob store |

Every push to `main` deploys to production. Every push to `dev` creates a preview deployment.
Route handlers that need Node APIs declare `export const runtime = "nodejs"`.

### Environment detection — read this before writing any environment-dependent code

**`NODE_ENV` cannot distinguish production from a dev deployment.** Vercel sets
`NODE_ENV="production"` when building previews, so a preview build looks exactly like production to
any `process.env.NODE_ENV === "production"` check. This has caused real bugs.

Use `lib/environment.ts`, which separates two different questions:

- `isProductionDeployment()` — *is this the live deployment?* Reads `VERCEL_ENV`, falling back to
  `NODE_ENV` off-platform.
- `isWiredToProductionData()` — *are this deployment's stores the real ones?* Cannot be inferred,
  because Vercel copies environment variables into Preview by default. Declared through
  `DATA_ENVIRONMENT`, and **defaults to "production" so it fails closed**.
- `assertSafeToMutateProductionData(operation)` — throws `ProductionDataWriteError` when a
  non-production deployment is wired to production data. Call before any irreversible write and map
  the error to a 403.

Covered by `npm run test:environment`.

## 3. Feature areas

Tabs are gated server-side in `app/page.tsx` via `isFeatureEnabled()` (`lib/features.ts`), driven by
the `ENABLED_TABS` comma-separated list. **Outside production every feature is on**, which is how a
tab is developed on `dev` before being exposed in production.

The same list also gates content *inside* a tab. `app/page.tsx` resolves those into a `features`
object passed down to the dashboard, because `isFeatureEnabled()` reads server-only env and
everything below it is a client component. `bank-stress-map` is the current entry.

The tab bar derives its column count from the number of enabled tabs. It was previously hardcoded to
`grid-cols-4`, so production — which runs three — rendered an empty fourth cell.

| Tab | Feature key | What it shows |
| --- | --- | --- |
| News | `news` | Industry Outlook / Key Signals memo (`industry-outlook.tsx`), Industry-Specific News (`public-mentions.tsx`), General Finance News (`investing-business-mentions.tsx`), and an on-demand Article Digest (`article-digest.tsx`) |
| Market Analytics | `market-analytics` | FDIC bank financials with state filter, institution drawer and export (`market-analytics.tsx`); a Visual Analysis chart section (`market-analytics-visuals.tsx`); a Bank Stress Map behind `bank-stress-map`; plus a nested FRED/Census indicator panel (`market-research.tsx`) |
| Market Research | `market-research` | Live publisher-by-publisher research feed with Postgres-backed archive (`market-research-feed.tsx`) and memo generation (`research-memo-modal.tsx`) |
| Legal Landscape | `legal` | Three AI-generated sections — Regulatory Watch, Legislative Tracker, Enforcement & Litigation (`legal-updates.tsx`). Despite the name, no LegiScan data is involved |

Production currently runs `ENABLED_TABS=news,market-analytics,market-research` (plus `legal` where
enabled) — confirm the live value in Vercel rather than trusting this line.

The news feeds merge all three geographies (national, Florida, Miami) into one list. The region
selector was removed in `984a361`; the underlying per-region feeds still exist and are fetched
concurrently, then merged and sorted by access tier and date.

Both news feeds source from Google News RSS queries plus direct publisher RSS (GlobeSt, Bisnow,
Commercial Observer, The Real Deal, CRE Daily, Trepp, Miami Herald for CRE; CNBC, Reuters, Bloomberg
for finance), and fall back to the **GDELT DOC 2.0 API** when RSS yields fewer than 15 items. The two
actions carry near-duplicate fetching logic, so a parsing bug tends to need fixing in both — as
happened with the CDATA regex.

## 4. The Industry Outlook / Key Signals pipeline

The most complex and most failure-prone part of the system. It generates the memo whose Executive
Summary is displayed as "Key Signals".

**Design constraint that drives everything here: the model must not be trusted with numbers.** It
previously produced confident, entirely invented statistics (see `SESSION.md`). The pipeline is built
so that any figure reaching the reader came from a measured source or a named publisher.

Flow, in `app/services/industry-outlook/getCachedOutlook.ts`:

1. **In parallel:**
   - `retrieveSources.ts` pulls supplemental news (up to 10 sources, with a per-region quota of 3).
     Handles RSS, unwraps CDATA, decodes HTML entities. A bug here silently discarded article
     snippets before they reached the prompt.
   - `verifiedMetrics.ts` fetches measured figures. **Both sources are keyless** — FRED's public CSV
     endpoint and the FDIC public API — which is why no FRED API key is required despite
     `FRED_API_KEY` appearing in older docs.
2. **Prompt construction** injects today's date (stops stale quarter references), the retrieved
   sources, and a `VERIFIED MARKET DATA` block the model may quote verbatim.
3. **Generation** through `lib/openai.ts` (OpenAI **Responses API**) with web search enabled and
   restricted to `SEARCH_ALLOWED_DOMAINS`. Uses the `fast` tier — `gpt-4.1-mini` by default — with a
   90s timeout inside a route whose `maxDuration` is 120s. Domain filtering requires a larger model,
   so `OPENAI_SEARCH_FILTER_MODEL` defaults to `gpt-4.1`; if the filtered call 400s, `lib/openai.ts`
   retries unrestricted.
4. **Post-processing:**
   - `stripInlineCitations` removes citation markup but *preserves publisher domains*, since the
     evidence guard needs attribution to survive.
   - **Evidence guard** (`lib/memo-evidence.ts`) deletes any bullet containing a numeric claim
     without recognized publisher attribution. Deduplication is scoped *within* a section, so summary
     bullets do not delete body bullets.
   - `ensureKeySignalFigures` guarantees at least three figure-bearing summary bullets, backfilling
     from verified metrics when the model underdelivers.
5. **Usability check** — `hasUsableContent()` requires 200+ characters, an "Executive Summary"
   heading, and at least 3 of the 5 expected headings.
6. **Fallback memo** if generation fails, containing the measured figures plus the sentinel phrase
   *"could not complete a full generated outlook"*, which the client detects. Failures **throw inside
   the cache function so they are never cached**, meaning the next request retries rather than
   serving a bad memo all day.

Health is observable in the warm-cache response: `verifiedMetrics`, `verifiedBulletsInserted`,
`keySignalFigures`, `droppedUnsourced`, `droppedDenied`. **A `keySignalFigures` of 0 means the
section is empty of data — treat as a regression.** Last verified: 5.

### Verified metric sources

`lib/verified-metrics.ts` is pure parsing and formatting (unit tested); fetching lives in
`app/services/industry-outlook/verifiedMetrics.ts`.

| Series | Source | Measures |
| --- | --- | --- |
| `DRCRELEXFACBS` | Federal Reserve Board | CRE loan delinquency rate, U.S. commercial banks |
| `CORCREXFACBS` | Federal Reserve Board | CRE net charge-off rate |
| `CREACBM027NBOG` | Federal Reserve H.8 | CRE loans outstanding |
| `DGS10` | U.S. Treasury | 10-year Treasury yield |
| `MORTGAGE30US` | Freddie Mac | 30-year fixed mortgage rate |
| `BAMLH0A0HYM2` | ICE Data Indices | High-yield option-adjusted spread |
| FDIC call reports | FDIC | Florida bank cohort CRE exposure, dollar-weighted |

`lib/fred-constants.ts` once named `CABOREA` for CRE charge-offs. **That is not a real series id** and
returns an error page; `CORCREXFACBS` is correct. Verify any new series id against the live endpoint
before trusting it.

The Market Pulse strip under the header (`components/market-pulse-strip.tsx`) draws five of these
same series through `app/actions/fetch-market-pulse.ts`, so its tiles and the Key Signals text agree
by construction. Values are cached with `unstable_cache`; the strip degrades to nothing rather than
showing a placeholder if FRED is unreachable.

### FDIC screening metrics

Fields are requested in `lib/fdic-config.ts` and turned into `BankFinancialData` in
`lib/fdic-data-transformer.ts`. These four are the ones whose names invite a wrong reading, so verify
against the live API rather than inferring from the field name:

| Displayed as | Derivation | Typical range |
| --- | --- | --- |
| Reserve Coverage | `LNATRES / LNLSNET` — the allowance over net loans | 1–2% |
| Loans / Deposits | `LNLSDEPR` as reported | 60–100% |
| CRE / (T1+T2) | CRE loans over `RBCT1J + RBCT2` | 1–6x |
| Past Due 30-89 / 90+ | `P3ASSET`, `P9ASSET` — dollar amounts in thousands, not ratios | — |

`LNLSDEPR` is **net loans-to-deposits**, not a reserve, despite the FDIC data dictionary phrasing
that suggests otherwise; it equals `LNLSNET / DEP` to the decimal place on every institution. It was
read as Reserve Coverage until 2026-08-23 and displayed roughly thirty times too large.

`RBCT1J + RBCT2` over `RWAJ` reproduces FDIC's published `RBCRWAJ` exactly, which is the check to run
if the capital figures ever look wrong. `RWA_TO_ASSETS_PROXY` in `lib/fdic-ratio-helpers.ts` remains
only as a fallback for institutions that do not report `RWAJ`; `CapitalRatios.basis` records whether
a row used reported dollars (`"reported"`) or the proxy (`"derived"`). `EQCAP` is requested but the
API returns null for it, so CRE / Equity falls back to Tier 1.

The Opportunity Score normalises each input against the **cohort's own min and max**
(`metricRange` in `app/actions/export-market-analytics-report.ts`), not fixed thresholds, so
correcting a field's scale does not require retuning weights. It does change the ranking, because the
inputs then measure something different.

## 4a. Charts

All Recharts instances share `lib/chart-theme.tsx` — palette, axis, grid, tooltip. Colours are
literals rather than `var(--chart-N)` because Recharts writes SVG fills directly and the headless
Playwright pass that renders the PDF cannot resolve CSS variables.

The four analytics charts live once, in `components/charts/analytics/`, and are rendered by both the
on-screen Visual Analysis section and the PDF report view. Keeping a single copy is the point: they
were previously inline in `market-analytics-report-view.tsx` and reachable only by downloading the
report.

`market-analytics-visuals.tsx` deliberately calls `buildReportData` — the same server action the PDF
uses — rather than reading the dashboard's `screeningTable`, whose opportunity scores are zeroed.
Charts drawn from that table would be silently wrong. The trade is a few seconds of loading, covered
by skeletons.

`singleLineTick` exists because Recharts wraps long category labels onto a second line that overlaps
the row beneath, which makes a twenty-row ranking unreadable.

## 4b. Bank stress map

`components/market-analytics/heatmap/BankStressHeatMap.tsx`, MapLibre GL, fed by `/api/map/states`,
`/api/map/metros` and `/api/map/banks` over `app/actions/map-data.ts`. Gated by `bank-stress-map`.

**FDIC report dates must be `YYYYMMDD`.** A hyphenated `2025-09-30` is not rejected — it is accepted
and matches zero rows. This silently emptied every map endpoint for as long as the feature existed,
and it presents as missing data rather than as an error.

**The current quarter is never published.** Call reports lag by roughly two quarters. When no quarter
is requested, `map-data.ts` walks back through candidates until one returns rows; an explicitly
selected quarter is used as given, so nothing is misattributed to a period the user did not pick.

**The colour scale must tolerate a flat metric.** High-stress share is near zero in almost every
state at the default threshold. When quantile cuts collapse onto one value, cuts that cannot separate
anything are dropped, and a genuinely flat metric returns a neutral fill and sets `hasVariation`
false. Without that the old `<` comparison chain fell through to the most severe colour and painted
the entire country red.

MapLibre throws synchronously when it cannot get a WebGL context, which will unmount the whole tab
unless caught — construction is wrapped and falls back to a message panel.

Layer event handlers are bound once in the init effect. Registering them inside the layer-building
callbacks, which re-run on every data or colour change, accumulates duplicates.

Basemap is OpenFreeMap Positron (`tiles.openfreemap.org`), keyless and desaturated so the choropleth
carries the colour. The former `demotiles.maplibre.org` style has no state boundaries or place names.

## 5. Caching and scheduled work

Generated content is expensive, so nearly everything is cached for a day.

- **Server:** `unstable_cache` keyed by a version string plus the current Eastern-time day.
  **Bumping the version string is how you force regeneration in production** — the standard tool
  after fixing prompt or pipeline behaviour.

  | Key | Contents |
  | --- | --- |
  | `industry-outlook-shared-v12` | The generated memo |
  | `industry-outlook-verified-metrics-v1` | Fetched FRED/FDIC figures |

- **Client:** `sessionStorage`, with its own version constants — `industry-outlook:v8`,
  `public_mentions:v4`, `investing_news:v2`. Bump these when the shape of cached data changes, or
  returning users get stale structures. There is also a same-day in-memory singleton for the memo.
- **Postgres:** `research_search_cache`, `research_feed_cache`, `research_summaries` persist across
  deployments.

Revalidate windows are ~25 hours so each day's content is a true daily snapshot.

### Cron jobs (`vercel.json`)

| Path | Schedule (UTC) |
| --- | --- |
| `/api/cron/warm-cache` | `0 5 * * *` |
| `/api/cron/warm-briefs` | `15 5 * * *` |

**Crons run only against production deployments**, so a preview never runs them — a dev deployment
starts cold and its first page load is slow. Warm it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$URL/api/cron/warm-cache"
```

`.github/workflows/warm-cache.yml` warms production after every deploy: triggers on push to `main`
only, sleeps 120s for the build, then calls both endpoints with `CRON_SECRET`. **This workflow's
`CRON_SECRET` secret in GitHub must match Vercel's value** — a mismatch has broken warming before,
and the symptom is a slow tool rather than an error.

`/api/cron` is exempt from the auth middleware and protected by bearer token instead.

## 6. Persistence

**Postgres** (Neon, via Vercel Marketplace; gated by `POSTGRES_URL` and `isDbEnabled()` in
`lib/db.ts`):

| Table | Written by |
| --- | --- |
| `research_reports` | `app/ingestion/storage/upsert-report.ts`, deleted by `delete-report` / `delete-test-reports` |
| `research_summaries` | `summarize-report`, `research-feed.ts`, `summarize-found-report.ts` |
| `research_search_cache` | `search-industry-reports.ts` |
| `research_feed_cache` | `api/research/feed-reports` (auto-creates itself) |

Those four are the whole Postgres surface. `industry_outlook_cache` and the `firm` / `firm_alias` /
`firm_entity` tables are **SQLite, not Postgres** — see the local-files section below.

Tables are created by `POST /api/admin/init-db` (header `x-admin-init-token`). Note this route sits
*behind* the password gate, so it needs the auth cookie as well as the token.

**When `POSTGRES_URL` is absent** the app degrades rather than failing: `isDbEnabled()` returns false,
caching becomes a no-op, and search and summarization still run but do not persist. That is exactly
how `dev` and local development run.

**Vercel Blob** holds uploaded report PDFs, served through a proxy route (`api/research/report-file`)
because the store is private. All eight call sites check for the token at request time and return a
clean JSON error, so a missing token degrades rather than crashing. **Nothing deletes blobs** — only
`put`.

**Local SQLite and JSON files.** Vercel's filesystem is read-only apart from `/tmp` and is not
durable across deployments, so **all of these are effectively local-development-only**. Do not add
runtime writes to them.

| Path | Purpose | Written by |
| --- | --- | --- |
| `data/aom.sqlite` | Miami-Dade AOM mortgage events | `scripts/import_aom_to_sqlite.py` |
| `data/competitor_surveillance.sqlite` | Competitor events | `app/ingestion/competitor_surveillance/` |
| `data/participant_intel.sqlite` | `firm`, `firm_alias`, `firm_entity` lookup | `lib/participant-intel.ts`, `participant-lookup.ts` |
| `data/ingestion.sqlite` | FFIEC / Census ingested data | `app/ingestion/` |
| `data/industry_outlook_cache.sqlite` / `.json` | Legacy outlook cache | `fetch-industry-outlook.ts` (dead path) |
| `data/watchlist.json`, `watchlist-aliases.json` | Competitor watchlist | `app/actions/watchlist.ts` |

## 7. Auth

`middleware.ts` gates everything except `/login`, `/api/auth`, `/api/cron`, `/_next` and `/favicon`.
It compares an `auth_token` cookie against `COOKIE_SECRET`; `/api/auth` sets that cookie after
checking `APP_PASSWORD`. **If `COOKIE_SECRET` is missing the comparison always fails and every
request redirects to `/login` in a loop** — the classic symptom of an unconfigured environment.

The session is meant to be effectively permanent, so nobody re-types the password during normal use:

- `lib/auth.ts` holds the single definition of the cookie name, options and lifetime. Both the
  middleware and `/api/auth` use it, so the two can never drift apart.
- The cookie lives for **one year** (`AUTH_COOKIE_MAX_AGE`). Browsers clamp persistent cookies to
  400 days, so a longer value would be silently truncated.
- Middleware **re-issues the cookie on every authenticated page view**, sliding the expiry forward.
  Anyone who opens the tool at least once a year is never asked to log in again. API responses are
  deliberately skipped so data fetches do not carry a `Set-Cookie` header.
- Requesting `/login` while already authenticated redirects to the app instead of showing the form.
- The `?from=` redirect target is passed through `safeRedirectPath()`, which rejects anything that
  is not a same-site path (`//host` and `/\host` parse as absolute URLs and are dropped).

Two things still end a session: pressing **Log out** (`DELETE /api/auth`, which expires the cookie),
and **rotating `COOKIE_SECRET`**, which invalidates every outstanding cookie at once. Rotate that
variable only when you intend to sign everyone out.

Additional token-protected endpoints, each authenticated by header:

| Endpoint | Header |
| --- | --- |
| `/api/admin/init-db` | `x-admin-init-token` |
| `/api/ingestion/run` | `x-ingestion-token` |
| `/api/research/upload`, `delete-report`, `delete-test-reports` | `x-admin-upload-token` |
| `/api/cron/*` | `Authorization: Bearer $CRON_SECRET` |

Vercel **Deployment Protection** is enabled for previews, so the `dev` URL additionally requires a
Vercel login and cannot be shared with people outside the account without a bypass token.

## 8. Environment variables

Every variable referenced in code. Scope matters: `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` must be
**Production-only**, or a dev deployment writes to real data.

| Variable | Consequence if missing |
| --- | --- |
| `OPENAI_API_KEY` | All AI features fail: outlook, briefs, summaries, legal feed |
| `APP_PASSWORD` | Nobody can log in |
| `COOKIE_SECRET` | Infinite redirect loop to `/login` |
| `CRON_SECRET` | **Security-relevant: the cron routes only check a bearer token when this is set, so if it is unset they are publicly callable.** A mismatch between GitHub and Vercel instead returns 401 and the tool becomes slow |
| `POSTGRES_URL` | Research persistence off; features degrade (intended on dev) |
| `BLOB_READ_WRITE_TOKEN` | Report uploads and PDF serving fail (intended on dev) |
| `DATA_ENVIRONMENT` | Assumed to be production data; destructive routes refuse on non-production |
| `ENABLED_TABS` | **No tabs render in production.** Ignored outside production |
| `GOOGLE_API_KEY`, `GOOGLE_CSE_ID` | Market Research search unavailable |
| `GOOGLE_CSE_API_KEY` | Separate key, used only by CBRE ingestion (`app/ingestion/sources/cbre-cse.ts`) |
| `ADMIN_INIT_TOKEN` | Cannot initialize database tables |
| `ADMIN_UPLOAD_TOKEN` | Cannot upload or delete reports |
| `INGESTION_TOKEN` | Ingestion endpoint unavailable |
| `ELEMENTIX_API_KEY` | Participants-intel API returns null (feeds orphaned UI — see §10) |
| `CENSUS_API_KEY`, `FFIEC_USER_ID`, `FFIEC_TOKEN` | Corresponding analytics sections report `configured: false` |
| `NEXT_PUBLIC_FDIC_API_KEY`, `FDIC_API_URL`, `FDIC_API_KEY` | All optional; anonymous FDIC access works today. Read by `lib/fdic-client.ts`, the single hardened path to the API (fallback host, timeout, 4xx short-circuit) shared by the analytics actions and the map |
| `FRED_API_KEY` | **Not needed by the outlook**, which uses FRED's keyless CSV endpoint. Still read by `fetch-kpi-data.ts` and `fetch-cre-data.ts`, whose FRED paths return null without it (KPI then falls back to an AI-written narrative) |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | Fallback base URL for server-side PDF rendering |
| `OPENAI_FAST_MODEL`, `OPENAI_SMART_MODEL`, `OPENAI_SUMMARY_MODEL`, `OPENAI_SUMMARY_PDF_MODEL`, `OPENAI_SEARCH_FILTER_MODEL` | Model overrides; defaults apply if unset |
| `CBRE_COVEO_SEARCH_URL` | Legacy CBRE ingestion |
| `MI_PDF_EXTRACTOR_*` | Test-mode switches for the PDF extractor |
| `NEXT_PUBLIC_NONCURRENT_DEBUG` | Optional debug flag |
| `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_REGION`, `NODE_ENV` | Platform-provided |

Historical note: the project migrated OpenAI → Perplexity → Claude → OpenAI. `ANTHROPIC_API_KEY`,
`PERPLEXITY_API_KEY`, `RESEND_API_KEY`, `NEWS_*` and `NEWS_SEND_TOKEN` may linger in Vercel or
`.env.local` but are **no longer read by any code**. `lib/claude.ts` no longer exists; comments
elsewhere still mention Claude and are stale.

`LEGISCAN_API_KEY` is listed in `DEPLOYMENT_CHECKLIST.md` but **is not read anywhere in the code**.
The Legal tab is entirely OpenAI-generated, not LegiScan-sourced. Conversely, that checklist omits
`APP_PASSWORD`, `COOKIE_SECRET`, `BLOB_READ_WRITE_TOKEN` and `DATA_ENVIRONMENT`; prefer this table.

## 9. Build and tests

```bash
npm run build              # next build
npm run dev                # local, reads .env.local
npm run test:environment   # environment detection (9 tests)
npm run test:memo-evidence # evidence guard
npm run test:verified-metrics
npm run test:allowlist
npm run test:metrics
```

Tests use Node's built-in runner with `--experimental-strip-types`, which requires importing local
modules **with the `.ts` extension** — `import { x } from "./y.ts"`. TypeScript flags this as an
error, which is expected and harmless.

There is no aggregate `npm test`; each suite runs individually. `scripts/pdf_extraction.test.js`
exists outside these scripts.

`next.config.mjs` sets **`typescript.ignoreBuildErrors: true`**, plus `images.unoptimized: true` and
`serverExternalPackages: ["better-sqlite3"]`. The repo has pre-existing type errors
across roughly a dozen files, so `npx tsc --noEmit` is noisy and the build does not gate on it. When
changing code, check that *your* files are clean rather than expecting a clean overall run.

## 10. Known fragility

- **`NODE_ENV` as a production check.** Fixed in `lib/features.ts`,
  `app/actions/search-industry-reports.ts` and `app/actions/summarize-found-report.ts`, but other
  `NODE_ENV === "production"` checks remain (for example in `app/actions/fetch-report-summaries.ts`).
  They currently fail safe — degrading to empty rather than erroring — but audit before relying on
  them.
- **AI output is probabilistic.** Prompt changes must be verified by running generation, ideally more
  than once. Historically, prompt instructions alone did not prevent fabricated figures; the
  programmatic guard did.
- **Cache keys hide fixes.** After changing generation behaviour, bump the cache version or
  production will serve yesterday's output.
- **A lot of orphaned UI.** None of these are mounted from `app/page.tsx` or the dashboard:
  `market-participants-intel.tsx` and `components/participants-intel/*` (the tab was removed in
  `259fa20`), `national-view.tsx`, `florida-view.tsx`, `miami-view.tsx`, `market-research-library.tsx`,
  `market-research-reports.tsx`, `competitor-analysis.tsx`. Confirm reachability before investing
  effort in any of them. Note the admin upload library is in this list, so the Blob upload path has
  no live UI even though its API routes work.
- **The daily cron still warms caches for orphaned features** — KPI, insights, price index and
  transaction volume are warmed by `warm-cache` but only consumed by unmounted views. That is
  needless OpenAI and FRED usage every morning.
- **Hardcoded figures, but not user-facing.** `fetch-market-research.ts` contains static Miami
  office/industrial metrics labelled "2025 YTD" (around L708–835). Verified 2026-08-21:
  `fetchMiamiIndustrialReport()` has **no callers**, so none of it reaches a user. Delete it rather
  than refresh it; the hazard is a future session wiring it up without noticing the dates. The
  hardcoded `CENSUS_YEAR = 2022` is separate and does run, but the Miami ACS metrics it produces are
  written to `section.miamiDade`, which the UI never reads.
- The `P3ASSET`/`P9ASSET` past-due columns are correct despite comments suggesting they are ratios;
  the fields really are dollar amounts in thousands. Fix the comments, not the code.
- **Live-tab scores are always zero.** `opportunityScore`, `earningsScore` and `vulnerabilityScore`
  are hardcoded to `0` in `market-analytics.tsx`, so the institution drawer shows zeros. The real
  computation exists only on the export path, which also paginates the full FDIC result set while the
  live tab caps at 5,000 rows sorted by assets descending. The same scope can therefore show
  different institution counts and averages in the tab versus the export, and the live tab
  under-represents smaller institutions. The Visual Analysis charts sidestep this by calling
  `buildReportData` instead of reading the table — anything else new that needs a score must do the
  same, or it will plot zeros.
- **Dead code:** `app/actions/fetch-industry-outlook.ts` (superseded by `getCachedOutlook.ts`, still
  writes local SQLite/JSON), `app/actions/fetch-public-mention-summary.ts` (no importers), and
  `fetchMiamiIndustrialReport()` (no callers).
- **Two OpenAI integration styles** coexist: the Responses API via `lib/openai.ts`, and direct Chat
  Completions in `generate-research-memo.ts` (hardcoded `gpt-4o`), `lib/report-summarizer.ts`,
  `lib/report/interpretation.ts` and `generate-analyst-narrative.ts`. Only the first honours the
  shared timeout and citation-stripping logic.
- **The post-deploy workflow can report a false failure.** Its curl caps at 120s while the
  warm-cache route allows 300s, so a slow warm shows as a CI failure even though the route completes.
- **`app/api/cbre-automate/route.ts`** intentionally returns 501 on Vercel; it spawns a local
  process.
- **Playwright** is used by `app/api/report/market-analytics-pdf/route.ts`, which makes that route
  heavier and slower than the rest.
- **Free-tier ceilings.** Vercel Blob on Hobby pools usage across *all* stores: 1 GB, 10,000 reads,
  2,000 writes/listings per month. Exceeding it revokes Blob access for 30 days rather than billing,
  which would take the production report library offline. Neon Free allows 0.5 GB and 100 CU-hours
  per project, and suspends compute after five minutes idle.
- **Several Postgres variables in Vercel are flagged "Needs Attention"** and have not been
  investigated. May affect the live research library.

## 11. Runbook

**Force the outlook to regenerate in production** — bump the version in the cache key in
`getCachedOutlook.ts` (currently `industry-outlook-shared-v12`), push to `main`, then confirm via the
post-deploy warm-cache log that `keySignalFigures` is non-zero.

**Diagnose "the tool is slow"** — almost always cold caches. Check the latest
`Warm Cache After Deploy` run in GitHub Actions; a 401 means `CRON_SECRET` drifted between GitHub and
Vercel.

**Check what a deployment is wired to** — `GET /api/research/blob-health` with the auth cookie
returns `vercelEnv`, `nodeEnv` and a masked Blob token. Identical masked tokens across two
deployments mean they share a store.

**Ship dev work** — `git checkout main && git merge dev && git push origin main`. Never push feature
work straight to `main`.

**Roll back** — see `ROLLBACK.md`.
