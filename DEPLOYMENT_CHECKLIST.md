# Vercel Production Deployment Checklist

## Runtime & Build
- Node version: `20.x` (pinned in `package.json` engines)
- Install command: `npm install`
- Build command: `npm run build`
- Start command (local prod validation): `npm run start`
- Next.js version: `15.5.12`

## Required Environment Variables (names only)
Server-only (do **not** expose as `NEXT_PUBLIC_*`):
- `APP_URL` (fallback base URL for server-side PDF report rendering when `VERCEL_URL` is unavailable)
- `PERPLEXITY_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_CSE_ID`
- `POSTGRES_URL` (from Vercel Postgres integration)
- `ADMIN_INIT_TOKEN` (required to initialize Market Research DB tables)
- `INGESTION_TOKEN` (required for protected ingestion run endpoint)
- `ADMIN_UPLOAD_TOKEN` (required for protected manual PDF upload endpoint)
- `FRED_API_KEY`
- `LEGISCAN_API_KEY`
- `FFIEC_USER_ID`
- `FFIEC_TOKEN`
- `CENSUS_API_KEY`
- `FDIC_API_URL` (optional override; defaults to FDIC public endpoint)
- `FDIC_API_KEY` (optional; reserved for future FDIC auth requirements)
- Vercel Blob store connection (required for `@vercel/blob` uploads; ensure Blob is enabled in project)

Client-visible (safe to expose):
- `NEXT_PUBLIC_NONCURRENT_DEBUG` (optional debug-only flag)

Platform-provided:
- `VERCEL`
- `VERCEL_URL`
- `NODE_ENV`

## Feature Flags
- `ENABLED_TABS=news,market-analytics,market-research`

Used to control which tabs appear in production.  
Value is a comma-separated list of feature keys.

## API & Runtime Notes
- Route handlers use Node runtime explicitly where needed via `export const runtime = "nodejs"`.
- `app/api/cbre-automate/route.ts` is intentionally disabled on Vercel (`501`) because it relies on spawning a detached local process.
- `app/api/report/market-analytics-pdf/route.ts` uses Playwright and Node runtime.
- `app/api/admin/init-db/route.ts` initializes `research_reports`, `research_summaries`, and `research_search_cache` tables (protected by `x-admin-init-token` header).
- `app/api/ingestion/run/route.ts` runs institutional research ingestion (protected by `x-ingestion-token` header).
- `app/api/research/upload/route.ts` handles admin PDF uploads to Vercel Blob (protected by `x-admin-upload-token` header).
- `app/api/research/reports/route.ts` returns Market Research report library items and summary status.

## Known Persistence Risks (Vercel Ephemeral Filesystem)
The following use local files and/or SQLite; on Vercel these writes are ephemeral and not durable across deployments/instances:
- `app/ingestion/competitor_surveillance/storage/db.ts` and related connectors using `better-sqlite3`
- `lib/participant-intel.ts` and participant-intel actions using SQLite-backed local files
- Actions that read/write local JSON cache/data files under project paths (for example report summaries, watchlists, and cached industry/search data)

> **Production note:** local filesystem and local SQLite are ephemeral on Vercel and require external persistence for durable production data.

## Required Vercel Project Settings
- Framework preset: `Next.js`
- Runtime: Node.js (default for this project; not Edge for Node-dependent routes)
- Set all required server environment variables in Vercel Project Settings
- Ensure build command is `npm run build`
- Ensure install command is `npm install`
