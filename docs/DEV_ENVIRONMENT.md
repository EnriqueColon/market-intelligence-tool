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

### 1. Give the Preview environment its own stores

In **Storage**, create a second Postgres database and a second Blob store (suggested names
`market-intel-dev-postgres` and `market-intel-dev-blob`). When connecting each to the project,
**select the Preview environment only**.

Then confirm in **Settings → Environment Variables** that the production `POSTGRES_URL` and
`BLOB_READ_WRITE_TOKEN` are scoped to **Production only**. If they are still scoped to all
environments they will override, or collide with, the dev values.

### 2. Declare the Preview environment as isolated

Add to the **Preview** scope:

```
DATA_ENVIRONMENT=isolated
```

Until this is set, the two delete routes above return `403` on any non-production deployment. The
default is deliberate: Vercel copies variables into Preview automatically, so absence of this flag
most likely means the isolation was never completed. See `lib/environment.ts`.

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

### 5. Create the tables in the dev database

A new Postgres database is empty. The init route sits behind the password gate, so it needs both the
admin token and the auth cookie:

```bash
DEV_URL="https://market-intelligence-tool-git-dev-<your-scope>.vercel.app"

curl -X POST "$DEV_URL/api/admin/init-db" \
  -H "x-admin-init-token: $ADMIN_INIT_TOKEN" \
  -H "Cookie: auth_token=$COOKIE_SECRET"
```

Expect `{"ok":true}`. `{"error":"POSTGRES_URL is not configured"}` means step 1 did not apply to
Preview; an HTML redirect means the cookie is missing or does not match `COOKIE_SECRET`.

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
