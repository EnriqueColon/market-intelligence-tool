# Render.com Cron Setup for Report Summaries

The background job fetches report URLs, extracts content (PDF or page text), and generates AI summaries via Perplexity. Results are stored in `data/report-summaries.json` and displayed in the Market Research tab.

## Prerequisites

- **PERPLEXITY_API_KEY** in environment variables (for AI summarization)
- Render.com account with Cron Job support

## Option A: Render Cron Job

1. In Render dashboard, create a **Cron Job** (not a Web Service).
2. Connect your repository.
3. **Build Command:**
   ```
   npm install && npx playwright install chromium
   ```
4. **Start Command:**
   ```
   npm run refresh-reports
   ```
5. **Schedule:** Use cron format, e.g. `0 9 * * 1` (Mondays 9am UTC).
6. **Environment:** Add `PERPLEXITY_API_KEY` (and any other secrets).
7. **Persistent Disk (optional):** If you want summaries to persist across deploys, add a disk mount at `/data` and update the script to write to that path. Otherwise, the job writes to `data/report-summaries.json` in the build; without a disk, this file is ephemeral.

## Option B: API Route + External Cron

If Render Cron cannot persist files or you prefer to run the refresh from your web service:

1. Create `app/api/cron/refresh-reports/route.ts` that:
   - Checks for a secret header (e.g. `x-cron-secret`) matching an env var
   - Runs the scrape + summarize logic
   - Writes to `data/report-summaries.json` (or a database)
   - Returns JSON status

2. Use an external cron service (e.g. cron-job.org, Uptime Robot) to `POST` to that URL with the secret on schedule.

3. Ensure your web service has `playwright` and Chromium installed. Add to Render Web Service build:
   ```
   npm install && npx playwright install chromium
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| PERPLEXITY_API_KEY | Yes | For AI summarization. Get from perplexity.ai |

## Data File

- **Path:** `data/report-summaries.json`
- **Format:** `{ "reportId": { "summary", "bullets", "lastFetched", "source", "error" } }`
- **Persistence:** On Render, without a persistent disk, the file is lost when the cron job container restarts. Consider committing a seed file or using a database for production.

## Manual Run

To run the refresh manually (e.g. for testing):

```bash
npm run refresh-reports
```

Requires `PERPLEXITY_API_KEY` in `.env.local` or environment.
