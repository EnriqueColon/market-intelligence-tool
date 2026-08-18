# Dev Environment

Production runs from `main` at https://market-intelligence-tool-gilt.vercel.app and is in active use.
Ongoing development happens on the long-lived `dev` branch, which Vercel deploys as a preview at:

```
https://market-intelligence-tool-git-dev-<your-vercel-scope>.vercel.app
```

The exact hostname appears in the Vercel dashboard after the first `dev` deployment. It is stable —
every push to `dev` updates the same URL, so it can be bookmarked.

## Why the isolation matters

Two stores hold real data, and a preview deployment inherits production's credentials for both
unless you deliberately repoint it:

- **Postgres** — the research library (`research_reports`, `research_summaries`, and cache tables).
  `POST /api/research/delete-test-reports` runs `DELETE FROM research_reports WHERE producer = 'manual'`,
  which removes every manually uploaded report in one call.
- **Blob** — the uploaded report PDFs. Nothing deletes blobs, but uploads from dev would land in the
  production store, and a colliding pathname overwrites the production file.

Two things are already safe and need no attention: the `Warm Cache After Deploy` workflow triggers
only on `main`, and Vercel runs `vercel.json` crons only against production deployments. Neither
will fire for `dev`.

## One-time Vercel setup

### 1. Keep the production stores out of Preview

The current setup runs the dev environment **without a database or Blob store**. Nothing to create:
in **Settings → Environment Variables**, scope both `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` to
**Production only**. If either is set to all environments, edit it — that single setting is the
difference between an isolated dev environment and one quietly writing to real data.

This is the same shape as local development, where `.env.local` has no `POSTGRES_URL`. The app
degrades rather than breaks: `isDbEnabled()` returns false, Market Research search and report
summarization still run against Google and OpenAI but skip persistence, and cached summaries come
back empty. No filesystem writes are attempted either, so the read-only Vercel filesystem is not a
problem.

Adopt real stores later if phase 2 needs them:

- **Postgres** — create a separate Neon *project*, not a branch. Neon Free allows 100 projects, and
  the allowances that matter (0.5 GB storage, 100 CU-hours per month) are counted *per project*, so
  a separate project leaves production's budget untouched while a branch would spend it. A branch's
  advantage is a copy-on-write copy of real report data.
- **Blob** — create a second store; Hobby allows up to 100. Then run step 5 to create the tables.

> **If you do add a Blob store, note what it does not isolate.** Separate stores isolate the
> *files*, but not the *quota* — storage, reads and writes are pooled across every store on the
> account, and the monthly Hobby allowance is 1 GB, 10,000 simple operations and only 2,000
> advanced operations (writes, modifications, listings). Exceeding it does not incur a charge; it
> revokes Blob access until the 30-day window rolls over, which would take the production report
> library offline. So do not bulk-test uploads or run listing loops in dev. Nothing in the code can
> guard this, because Vercel enforces it at the account level.

### 2. Declare the Preview environment as isolated

Add to the **Preview** scope:

```
DATA_ENVIRONMENT=isolated
```

This asserts that step 1 was actually done. Until it is set, the two delete routes above return
`403` on any non-production deployment. The default is deliberate: Vercel copies variables into
Preview automatically, so absence of this flag most likely means the isolation was never completed.
See `lib/environment.ts`.

Leave it unset in Production. Production is identified by `VERCEL_ENV`, not by this flag.

### 3. Copy the remaining variables into the Preview scope

These have no per-environment state, so Preview can reuse the production values. Without the first
two the preview is unusable — missing `COOKIE_SECRET` makes the middleware redirect every request
to `/login` forever.

```
APP_PASSWORD          COOKIE_SECRET         CRON_SECRET
OPENAI_API_KEY        GOOGLE_API_KEY        GOOGLE_CSE_ID
ADMIN_INIT_TOKEN      ADMIN_UPLOAD_TOKEN    INGESTION_TOKEN
LEGISCAN_API_KEY      CENSUS_API_KEY        FFIEC_USER_ID
FFIEC_TOKEN           NEXT_PUBLIC_FDIC_API_KEY
```

`ENABLED_TABS` is intentionally **not** in that list. Every feature is enabled outside production,
so the preview always shows all tabs regardless of what production is flagged to show. Use it to
develop a tab before exposing it in production.

### 4. Decide who can open the preview URL

New Vercel projects protect preview deployments behind Vercel account authentication
(**Settings → Deployment Protection**). If you want to share the dev URL with someone who has no
Vercel access, disable that protection or issue a bypass token — the app's own password gate still
applies underneath.

### 5. Confirm the isolation

Redeploy `dev` first — Vercel only picks up environment variables on a new build. Then, with no
database wired, this should report `"vercelEnv":"preview"` and
`"hasBlobReadWriteToken":false`:

```bash
DEV_URL="https://market-intelligence-tool-git-dev-<your-scope>.vercel.app"

curl -H "Cookie: auth_token=$COOKIE_SECRET" "$DEV_URL/api/research/blob-health"
```

An HTML redirect instead of JSON means `COOKIE_SECRET` is missing from Preview or does not match.
A `blobTokenMasked` value identical to production's means step 1 was not applied and dev is still
writing to the production store.

**Only if you later add a database (step 1):** it starts empty, so create the tables. This route
sits behind the password gate, so it needs the admin token *and* the auth cookie:

```bash
curl -X POST "$DEV_URL/api/admin/init-db" \
  -H "x-admin-init-token: $ADMIN_INIT_TOKEN" \
  -H "Cookie: auth_token=$COOKIE_SECRET"
```

Expect `{"ok":true}`.

## Day-to-day workflow

```bash
git checkout dev
git pull
# ...work...
git push origin dev          # deploys to the dev preview URL
```

Crons do not run on previews, so the dev deployment starts with cold caches and the first page load
is slow. Warm it on demand — `/api/cron` is exempt from the password gate and takes a bearer token:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$DEV_URL/api/cron/warm-cache"
```

### Shipping to production

```bash
git checkout main
git merge dev
git push origin main
```

That triggers the production deploy and the post-deploy warm-cache workflow. Merge in this
direction only; do not push feature work straight to `main`.

## Local development

`npm run dev` runs against `.env.local`, which has no `POSTGRES_URL` — so `isDbEnabled()` is false
and database-backed features degrade rather than touching production.

`.env.local` does still carry a `BLOB_READ_WRITE_TOKEN` for the production Blob store, so local
uploads write to production. Replace it with the dev Blob token from step 1 and add
`DATA_ENVIRONMENT=isolated` to `.env.local`.

## Adding new destructive operations

Call the guard before any irreversible write so it cannot run from a deployment wired to production
data:

```ts
import { assertSafeToMutateProductionData, ProductionDataWriteError } from "@/lib/environment"

assertSafeToMutateProductionData("describe the operation")
// ...then, in the catch block, map ProductionDataWriteError to a 403.
```

Reads and cache upserts do not need it. Run `npm run test:environment` after changing that module.
