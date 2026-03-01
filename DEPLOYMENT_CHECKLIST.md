# Vercel Production Deployment Checklist

## Runtime & Build
- Node version: `20.x` (pinned in `package.json` engines)
- Install command: `npm install`
- Build command: `npm run build`
- Start command (local prod validation): `npm run start`
- Next.js version: `15.2.4` (unchanged)

## Required Environment Variables (names only)
Server-only (do **not** expose as `NEXT_PUBLIC_*`):
- `APP_URL` (fallback base URL for server-side PDF report rendering when `VERCEL_URL` is unavailable)
- `PERPLEXITY_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_CSE_ID`
- `FRED_API_KEY`
- `LEGISCAN_API_KEY`
- `FFIEC_USER_ID`
- `FFIEC_TOKEN`
- `CENSUS_API_KEY`
- `FDIC_API_URL` (optional override; defaults to FDIC public endpoint)
- `FDIC_API_KEY` (optional; reserved for future FDIC auth requirements)

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
