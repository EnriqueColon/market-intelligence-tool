/**
 * Cron script: scrapes report URLs, generates AI summaries, writes to data/report-summaries.json.
 * Run: npx tsx scripts/refresh-report-summaries.ts
 * Or: npm run refresh-reports
 *
 * Requires PERPLEXITY_API_KEY in .env.local or environment.
 */

import * as fs from "fs/promises"
import * as path from "path"

// Load .env.local so PERPLEXITY_API_KEY is available when run via npm run refresh-reports
try {
  const envPath = path.join(process.cwd(), ".env.local")
  const envContent = await fs.readFile(envPath, "utf-8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#")) {
      const eq = trimmed.indexOf("=")
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
        if (key && !process.env[key]) process.env[key] = val
      }
    }
  }
} catch {
  // .env.local may not exist; env vars may already be set
}

import { scrapeReport } from "../lib/report-scraper"
import { summarizeReportText } from "../lib/report-summarizer"
import { MARKET_RESEARCH_SECTIONS } from "../app/data/market-research-reports"

const DELAY_BETWEEN_REPORTS_MS = 3000
const DATA_DIR = path.join(process.cwd(), "data")
const SUMMARIES_PATH = path.join(DATA_DIR, "report-summaries.json")

type StoredSummary = {
  reportId: string
  summary: string
  bullets: string[]
  lastFetched: string
  source: "pdf" | "page" | "failed"
  error: string | null
}

async function loadExistingSummaries(): Promise<Record<string, StoredSummary>> {
  try {
    const raw = await fs.readFile(SUMMARIES_PATH, "utf-8")
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

async function saveSummaries(summaries: Record<string, StoredSummary>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(SUMMARIES_PATH, JSON.stringify(summaries, null, 2), "utf-8")
}

async function main() {
  const reports: { id: string; title: string; source: string; url: string }[] = []
  for (const section of MARKET_RESEARCH_SECTIONS) {
    for (const report of section.reports) {
      if (report.url) {
        reports.push({
          id: report.id,
          title: report.title,
          source: report.source,
          url: report.url,
        })
      }
    }
  }

  console.log(`[refresh-reports] Found ${reports.length} reports with URLs`)

  const existing = await loadExistingSummaries()
  const updated: Record<string, StoredSummary> = { ...existing }

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]
    console.log(`[${i + 1}/${reports.length}] Scraping: ${r.title}`)

    try {
      const scrapeResult = await scrapeReport(r.url)

      if (scrapeResult.source === "failed" || !scrapeResult.text || scrapeResult.text.length < 100) {
        updated[r.id] = {
          reportId: r.id,
          summary: "",
          bullets: [],
          lastFetched: new Date().toISOString(),
          source: "failed",
          error: scrapeResult.error || "No content extracted",
        }
        console.log(`  -> Failed: ${scrapeResult.error || "no content"}`)
      } else {
        const aiSummary = await summarizeReportText(scrapeResult.text, r.title, r.source)

        updated[r.id] = {
          reportId: r.id,
          summary: aiSummary?.summary || "",
          bullets: aiSummary?.bullets || [],
          lastFetched: new Date().toISOString(),
          source: scrapeResult.source,
          error: null,
        }
        console.log(`  -> OK (${scrapeResult.source}), summary: ${aiSummary ? "yes" : "no"}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updated[r.id] = {
        reportId: r.id,
        summary: "",
        bullets: [],
        lastFetched: new Date().toISOString(),
        source: "failed",
        error: msg,
      }
      console.log(`  -> Error: ${msg}`)
    }

    if (i < reports.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REPORTS_MS))
    }
  }

  await saveSummaries(updated)
  console.log(`[refresh-reports] Saved to ${SUMMARIES_PATH}`)
}

main().catch((err) => {
  console.error("[refresh-reports] Fatal:", err)
  process.exit(1)
})
