# Session Log

Running record of work sessions, most recent first. Update at the end of every session, alongside
`ROLLBACK.md` and `confluence.md`.

Each entry should let someone who was not present answer three questions: what changed, what state
is it in now, and what is still open.

---

## 2026-08-21

One change, plus the decision to finally ship the dev-environment work that had been sitting on
`dev` since 2026-08-18.

### Stay signed in (shipped to production)

**Trigger.** Users were being asked for the password again roughly once a week.

**Cause.** `/api/auth` issued the `auth_token` cookie with a seven-day `maxAge` and nothing ever
renewed it. Regular daily use made no difference: the clock started at login and ran out on
schedule. Nobody had noticed it was a fixed expiry rather than an idle timeout.

What was done:

- **`lib/auth.ts`** (new) — the single definition of the cookie name, its options and its lifetime.
  Previously `middleware.ts` and `app/api/auth/route.ts` each hardcoded the name and the flags, so
  changing one without the other was a silent way to break the gate.
- **One-year lifetime** (`AUTH_COOKIE_MAX_AGE`). Not longer, because browsers clamp persistent
  cookies to 400 days and would truncate anything past that without telling anyone.
- **Sliding expiry** — the middleware re-issues the cookie on every authenticated page view, so the
  expiry keeps moving forward and someone who opens the tool at least once a year is never asked
  again. API responses are deliberately excluded so ordinary data fetches carry no `Set-Cookie`.
- **`/login` while signed in** now redirects into the app instead of presenting the form again.
- **`?from=` is validated** through `safeRedirectPath()` in both the middleware and the login page.
  It previously accepted `//evil.com`, which the URL parser reads as an absolute address, so a
  crafted login link could have bounced someone off-site immediately after they authenticated. Not
  known to have been exploited; found while touching the redirect.

**Verified against a local dev server**, not just by reading the code: login issued a cookie
expiring Aug 2027; a page view twelve seconds later moved the expiry forward by exactly twelve
seconds, which is the sliding renewal working; a wrong password still returned 401 with no cookie;
an API call returned no `Set-Cookie`; `/login` with a valid cookie redirected to `/`;
`?from=//evil.com` redirected to `/` rather than off-site; and Log out still cleared the cookie and
sent the browser back to the login screen.

**Existing sessions were not disrupted.** Anyone still holding a seven-day cookie has it silently
upgraded to the one-year one on their next page view.

Commit: `74807d8`.

### Merging `dev` into production

Shipping the above meant shipping the five commits that had accumulated on `dev`: the isolated dev
environment, the database-less degradation fix, and the documentation set.

This was checked rather than assumed. Every one of those changes is keyed on
`isProductionDeployment()`, which returns true on production, so all of them are no-ops there:
`lib/features.ts` still reads `ENABLED_TABS`, `search-industry-reports.ts` still insists on a
database, and `assertSafeToMutateProductionData()` returns immediately on the first line without
blocking a legitimate delete. The only behavioural change reaching users is the auth cookie.

### Current status

- **Production** — `main` at `74807d8`. Users stay signed in for a year of continuous use.
- **Dev** — `dev` at `74807d8`, level with `main` for the first time since 2026-08-17.

### Open items

Carried forward from the previous session, all still open:

- **`Needs Attention` flags** on several Postgres environment variables in Vercel, never
  investigated. May affect the live research library. Still the highest-value loose end.
- **The dev URL used for verification is build-specific** and changes every push; the stable branch
  alias is still unrecorded.
- **`.env.local` still holds the production `BLOB_READ_WRITE_TOKEN`**, so local development writes
  to the production Blob store.
- **Pre-existing uncommitted changes**, deliberately left alone: `data/competitor_surveillance.sqlite*`,
  `data/README-aom-import.md`, `scripts/import_aom_to_sqlite.py`, `.claude/`, `.DS_Store`.
- **Phase two is unscoped.**
- The four items surfaced by the codebase inventory (see the previous entry) remain unaddressed.

New this session:

- **`COOKIE_SECRET` is now the only lever that signs everyone out**, and doing so is silent — there
  is no notice to users and no staged rollout. Rotate it only deliberately.
- **The password is still shared and compared with `!==`**, so it is neither per-user nor
  constant-time. A year-long session raises the value of a leaked cookie, though the cookie is
  `httpOnly`, `secure` and `sameSite=lax`. Per-user accounts remain the real fix if the audience
  ever grows beyond a trusted group.

---

## 2026-08-17 → 2026-08-18

Two distinct pieces of work: fixing fabricated statistics in the live tool (shipped to production),
then building an isolated dev environment so future work stops happening directly on production.

### Part 1 — Key Signals accuracy (shipped to production)

**Trigger.** The tool was serving invented statistics. The reported example: *"In Florida,
foreclosure filings have increased by 18% year-over-year, with Miami-Dade County averaging 180–220
new lis pendens filings per week in Q1 2026."* No such figure existed in any source.

Root cause was structural, not a one-off. The model was asked for data-rich prose with no mechanism
requiring the numbers to come from anywhere, so it supplied plausible ones.

What was done, in the order it was done:

1. **Prompt hardening** — forbade unsourced figures, required attribution, injected today's date to
   stop stale quarter references. Insufficient on its own; the model still produced figures.
2. **Programmatic evidence guard** (`lib/memo-evidence.ts`) — deletes any bullet carrying a numeric
   claim without a recognized publisher attribution. Enforcement rather than instruction.
3. **Source denylist** — content farms (`real-estate-tycoon.org`, `noticeregistry.com` and similar)
   excluded from retrieval, not merely from citation.
4. **Verified metrics pipeline** (`lib/verified-metrics.ts`,
   `app/services/industry-outlook/verifiedMetrics.ts`) — real measured figures injected into the
   prompt as ground truth the model may quote verbatim. Sources: FRED's public CSV endpoint and the
   FDIC API, both of which work **without an API key**, which is why no new credential was needed.
   Covers CRE delinquency, net charge-offs, CRE loan balances, the 10-year Treasury, the 30-year
   mortgage rate, high-yield spreads, and the Florida bank cohort's CRE exposure.
5. **Data floor** (`ensureKeySignalFigures`) — guarantees at least three figure-bearing bullets in
   the Executive Summary, backfilled from verified metrics when the model underdelivers. This
   required relaxing an earlier rule that had banned *all* figures from the summary; that rule was
   accurate but left the section saying nothing.
6. **Feed headline recovery** — a double-escaped CDATA regex was silently discarding titles, which
   surfaced as rows of "Untitled" from Bloomberg and others. Fixed across all `fetch-*` actions and
   in `retrieveSources.ts`, where it had also been discarding article snippets before they reached
   the prompt. Named HTML entities are now decoded too.
7. **UI removals** at user request — the region dropdown (national/Florida/metro), the admin token
   field, and the Send News Email button. News feeds now merge all three regions instead of being
   filtered to one.

**Verified in production** via the post-deploy warm-cache run: Key Signals went from **zero**
figure-bearing bullets to **five**, `droppedUnsourced: 0`, `droppedDenied: 0`, total memo bullets
22 → 30.

Commits: `984a361`, `cf9e8a2`, `dc31c78`, `586f52f`, `4b09072`, `25b6dfb`, `2191ff3`, `eabf088`.

### Part 2 — Isolated dev environment (on `dev`, not yet merged)

**Trigger.** Production is in active use, so phase-two work needed somewhere to run that cannot
damage it.

The naive approach — a branch that deploys as a Vercel preview — would have been actively dangerous
here, for a reason worth remembering: **Vercel sets `NODE_ENV=production` on preview builds**, and
every environment check in this codebase read `NODE_ENV`. A preview was therefore
indistinguishable from production. Two concrete consequences, both real rather than theoretical:

- `lib/features.ts` would have shown **zero tabs**, since `ENABLED_TABS` is unset in Preview and the
  fallback returns false for everything.
- The delete routes would have run against production data believing they were production.

And separately, Vercel copies environment variables into Preview by default, so the preview was in
fact wired to the production Postgres and Blob store.

What was built:

- **`lib/environment.ts`** — reads `VERCEL_ENV`, and separates two questions the codebase had
  conflated: *which deployment is this* versus *is its data the real data*. The second cannot be
  inferred, so it is declared via `DATA_ENVIRONMENT` and defaults to "production" to fail closed.
- **Guards on the two irreversible routes** — `delete-report` and `delete-test-reports` refuse and
  return 403 when a non-production deployment is wired to production data. Their admin token was no
  protection, since Preview inherits it by the same default that shared the database.
- **`lib/features.ts`** — keyed on deployment, so previews enable every tab. This is also the
  mechanism for developing a tab before exposing it in production.
- **Database-less degradation** — `search-industry-reports.ts` and `summarize-found-report.ts`
  hard-refused with *"Database is required in production"* when no database was configured and
  `NODE_ENV` was production, which is exactly the dev environment's situation. They now run against
  Google and OpenAI and skip persistence instead.
- **9 unit tests** (`lib/environment.test.ts`, `npm run test:environment`).
- **`docs/DEV_ENVIRONMENT.md`** — setup and day-to-day workflow.

**Vercel configuration completed** (dashboard work, not in code): the Neon Postgres connection and
the Blob store connection were both changed from all environments to **Production only** — done
through *Storage → Projects → Update Project Connection*, because integration-managed variables have
no per-variable Edit option. `DATA_ENVIRONMENT=isolated` added to Preview.

**Verified from outside** against the redeployed preview:

```json
{"vercelEnv":"preview","nodeEnv":"production",
 "hasBlobReadWriteToken":false,"blobTokenMasked":null}
```

`vercelEnv: preview` sitting next to `nodeEnv: production` is the trap that was defused, and no Blob
token means there is no path from dev to production files.

Commits: `255828f`, `27a00b8`, `908d083`.

### Also done

**Deleted the `claude/angry-mirzakhani` branch** (tip `a7cb784`, 2026-04-02) after review. It was
not unfinished work; it had been superseded. Its own description was "Private Creditor Monitor with
lender spider graph and tooltip headers", and all three had since landed or been reversed on `main`:
the monitor was rewritten (349 lines today versus its 412), tooltips arrived in `dd12787`, and the
spider graph was **deliberately removed** in `2530466`. Merging it would have reinstated a chart
that had been dropped on purpose and reverted the Competitor AOM section to a four-month-old
version. It was 63 commits stale and conflicted in five files.

### Current status

- **Production** — `main` at `eabf088`, serving at https://market-intelligence-tool-gilt.vercel.app.
  Unaffected by all Part 2 work; nothing from `dev` has been merged.
- **Dev** — `dev` at `908d083`, deploying as a Vercel preview with no database and no Blob store.
  Isolation verified. Behind Vercel's own login wall (Deployment Protection is on), so it is not
  publicly reachable.
- Branches are now just `main` and `dev`.

### Open items

- **`Needs Attention` flags** on several Postgres environment variables in Vercel were noticed and
  never investigated. These may affect the **live** research library, not just dev. Highest-value
  loose end.
- **The dev URL used for verification is build-specific** (`…-1n4xmsdov.vercel.app`) and changes
  every push. The stable branch alias has not been recorded here yet.
- **`.env.local` still holds the production `BLOB_READ_WRITE_TOKEN`**, so local development writes
  to the production Blob store. Unchanged from before this session, but now the only remaining path
  from a dev context to production data.
- **Pre-existing uncommitted changes** in the working tree, deliberately left alone:
  `data/competitor_surveillance.sqlite*`, `data/README-aom-import.md`,
  `scripts/import_aom_to_sqlite.py`, `.claude/`, `.DS_Store`.
- **Phase two is unscoped.** No decision yet on what to build first.

### Surfaced by the codebase inventory, not yet acted on

A full architecture inventory was run to write `confluence.md`. It turned up four things worth
scheduling, none of them urgent:

- **`CRON_SECRET` gates the cron routes only when it is set.** If it were ever unset in Vercel, both
  warm endpoints would be publicly callable. Worth confirming it is present in Production.
- **Hardcoded figures presented as current data** — `fetch-market-research.ts` carries static Miami
  office/industrial metrics labelled "2025 YTD" and a hardcoded `CENSUS_YEAR = 2022`. The same class
  of problem as the fabricated Key Signals figures, just stale rather than invented.
- **Substantial orphaned UI** — the participants-intel components, `national-view`, `florida-view`,
  `miami-view`, `market-research-library`, `market-research-reports` and `competitor-analysis` are not
  mounted anywhere. Notably this means the Blob upload library has no live UI.
- **The daily cron warms caches for those orphaned features** (KPI, insights, price index,
  transaction volume), spending OpenAI and FRED calls every morning on views nobody can reach.
