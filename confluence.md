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

| Tab | Feature key | What it shows |
| --- | --- | --- |
| News | `news` | Industry Outlook / Key Signals memo, Industry-Specific News, General Finance News |
| Market Analytics | `market-analytics` | Bank and CRE metrics, FDIC-driven institution data, charts, PDF/CSV export |
| Market Research | `market-research` | Research report feed and library, AI summaries, investment memo generation |
| Legal | `legal` | AI-generated legal and legislative intelligence feed |

Production currently runs `ENABLED_TABS=news,market-analytics,market-research` (plus `legal` where
enabled) — confirm the live value in Vercel rather than trusting this line.

The news feeds merge all three geographies (national, Florida, Miami) into one list. The region
selector was removed in `984a361`; the underlying per-region feeds still exist and are fetched
concurrently, then merged and sorted by access tier and date.

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
3. **Generation** through `lib/openai.ts` with web search enabled.
4. **Post-processing:**
   - `stripInlineCitations` removes citation markup but *preserves publisher domains*, since the
     evidence guard needs attribution to survive.
   - **Evidence guard** (`lib/memo-evidence.ts`) deletes any bullet containing a numeric claim
     without recognized publisher attribution. Deduplication is scoped *within* a section, so summary
     bullets do not delete body bullets.
   - `ensureKeySignalFigures` guarantees at least three figure-bearing summary bullets, backfilling
     from verified metrics when the model underdelivers.
5. **Fallback memo** if generation fails, containing measured figures and a sentinel phrase so
   fallbacks are detectable in logs.

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

## 5. Caching and scheduled work

Generated content is expensive, so nearly everything is cached for a day.

- **Server:** `unstable_cache` keyed by a version string plus the current day, e.g.
  `["industry-outlook-shared-v12", day]`. **Bumping the version string is how you force
  regeneration in production** — the standard tool after fixing prompt or pipeline behaviour.
- **Client:** `sessionStorage`, with its own version constants (e.g. `public_mentions:v4`,
  `investing_news:v2`). Bump these when the shape of cached data changes, or returning users get
  stale structures.
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
| `research_feed_cache` | `api/research/feed-reports` |
| `industry_outlook_cache` | `fetch-industry-outlook.ts` |
| `firm`, `firm_alias`, `firm_entity` | `lib/participant-intel.ts`, `participant-lookup.ts` (SQLite-backed) |

Tables are created by `POST /api/admin/init-db` (header `x-admin-init-token`). Note this route sits
*behind* the password gate, so it needs the auth cookie as well as the token.

**When `POSTGRES_URL` is absent** the app degrades rather than failing: `isDbEnabled()` returns false,
caching becomes a no-op, and search and summarization still run but do not persist. That is exactly
how `dev` and local development run.

**Vercel Blob** holds uploaded report PDFs, served through a proxy route (`api/research/report-file`)
because the store is private. All eight call sites check for the token at request time and return a
clean JSON error, so a missing token degrades rather than crashing. **Nothing deletes blobs** — only
`put`.

**Local SQLite and JSON files** — `app/ingestion/competitor_surveillance/`, `lib/participant-intel.ts`
and `data/*.sqlite`. Vercel's filesystem is read-only apart from `/tmp` and is not durable across
deployments, so **these are effectively local-development-only**. Do not add runtime writes to them.

## 7. Auth

`middleware.ts` gates everything except `/login`, `/api/auth`, `/api/cron`, `/_next` and `/favicon`.
It compares an `auth_token` cookie against `COOKIE_SECRET`; `/api/auth` sets that cookie after
checking `APP_PASSWORD`. **If `COOKIE_SECRET` is missing the comparison always fails and every
request redirects to `/login` in a loop** — the classic symptom of an unconfigured environment.

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
| `CRON_SECRET` | Cron and post-deploy warming return 401; tool becomes slow |
| `POSTGRES_URL` | Research persistence off; features degrade (intended on dev) |
| `BLOB_READ_WRITE_TOKEN` | Report uploads and PDF serving fail (intended on dev) |
| `DATA_ENVIRONMENT` | Assumed to be production data; destructive routes refuse on non-production |
| `ENABLED_TABS` | **No tabs render in production.** Ignored outside production |
| `GOOGLE_API_KEY`, `GOOGLE_CSE_ID` | Market Research search unavailable |
| `ADMIN_INIT_TOKEN` | Cannot initialize database tables |
| `ADMIN_UPLOAD_TOKEN` | Cannot upload or delete reports |
| `INGESTION_TOKEN` | Ingestion endpoint unavailable |
| `ELEMENTIX_API_KEY` | AOM / participants data unavailable |
| `LEGISCAN_API_KEY` | Legislative signals unavailable |
| `CENSUS_API_KEY`, `FFIEC_USER_ID`, `FFIEC_TOKEN` | Corresponding analytics degraded |
| `NEXT_PUBLIC_FDIC_API_KEY`, `FDIC_API_URL`, `FDIC_API_KEY` | FDIC access; the public API works keyless |
| `FRED_API_KEY` | **Not required.** Verified metrics use FRED's keyless CSV endpoint |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | Fallback base URL for server-side PDF rendering |
| `OPENAI_FAST_MODEL`, `OPENAI_SMART_MODEL`, `OPENAI_SUMMARY_MODEL`, `OPENAI_SUMMARY_PDF_MODEL`, `OPENAI_SEARCH_FILTER_MODEL` | Model overrides; defaults apply if unset |
| `CBRE_COVEO_SEARCH_URL` | Legacy CBRE ingestion |
| `MI_PDF_EXTRACTOR_*` | Test-mode switches for the PDF extractor |
| `NEXT_PUBLIC_NONCURRENT_DEBUG` | Optional debug flag |
| `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_REGION`, `NODE_ENV` | Platform-provided |

Historical note: the project migrated OpenAI → Perplexity → Claude → OpenAI. `ANTHROPIC_API_KEY`,
`PERPLEXITY_API_KEY`, `RESEND_API_KEY`, `NEWS_*` and `NEWS_SEND_TOKEN` may linger in Vercel or
`.env.local` but are **no longer read by any code**.

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

`next.config` sets **`typescript.ignoreBuildErrors: true`**. The repo has pre-existing type errors
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
- **Participants-intel code** (`components/market-participants-intel.tsx`,
  `components/participants-intel/*`, `app/api/participants-intel/`) survives, but the Market
  Participants tab was removed in `259fa20` and has no feature flag in `app/page.tsx`. Treat as
  likely-orphaned and verify reachability before investing in it.
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
