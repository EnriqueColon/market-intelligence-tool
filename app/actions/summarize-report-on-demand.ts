"use server"

import * as fs from "fs/promises"
import * as path from "path"
import { scrapeReport } from "@/lib/report-scraper"
import { summarizeReportText } from "@/lib/report-summarizer"
import type { ReportSummaryEntry } from "./fetch-report-summaries"

export type SummarizeReportResult =
  | { ok: true; summary: ReportSummaryEntry }
  | { ok: false; error: string }

const SUMMARIES_PATH = path.join(process.cwd(), "data", "report-summaries.json")
const DATA_DIR = path.join(process.cwd(), "data")

export async function summarizeReportOnDemand(
  reportId: string,
  url: string,
  title: string,
  source: string
): Promise<SummarizeReportResult> {
  try {
    // Use lightweight-only to avoid Playwright (requires npx playwright install)
    const scrapeResult = await scrapeReport(url, { lightweightOnly: true })

    if (scrapeResult.source === "failed" || !scrapeResult.text || scrapeResult.text.length < 100) {
      const baseMsg = scrapeResult.error || "Could not extract content from report."
      const hint =
        scrapeResult.error?.includes("403")
          ? " Use Link to Source, copy the text, then paste below to summarize."
          : " Try running `npm run refresh-reports` (requires `npx playwright install`) for JS-heavy pages."
      return { ok: false, error: baseMsg + hint }
    }

    const aiSummary = await summarizeReportText(scrapeResult.text, title, source)

    if (!aiSummary || (!aiSummary.summary && aiSummary.bullets.length === 0)) {
      return {
        ok: false,
        error: "AI summarization failed. Ensure PERPLEXITY_API_KEY is set.",
      }
    }

    const entry: ReportSummaryEntry = {
      reportId,
      summary: aiSummary.summary || "",
      bullets: aiSummary.bullets || [],
      lastFetched: new Date().toISOString(),
      source: scrapeResult.source,
      error: null,
    }

    try {
      const existing: Record<string, ReportSummaryEntry> = {}
      try {
        const raw = await fs.readFile(SUMMARIES_PATH, "utf-8")
        const parsed = JSON.parse(raw)
        if (typeof parsed === "object" && parsed !== null) {
          Object.assign(existing, parsed)
        }
      } catch {
        // File may not exist
      }
      existing[reportId] = entry
      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.writeFile(SUMMARIES_PATH, JSON.stringify(existing, null, 2), "utf-8")
    } catch (writeErr) {
      // Still return the summary even if we couldn't persist
      console.warn("[summarizeReportOnDemand] Could not save to file:", writeErr)
    }

    return { ok: true, summary: entry }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

/**
 * Summarize from pasted content (ethical workaround when source blocks scraping).
 * User opens report via Link to Source, copies text, pastes here. No scraping.
 */
export async function summarizeReportFromPastedText(
  reportId: string,
  title: string,
  source: string,
  pastedText: string
): Promise<SummarizeReportResult> {
  const trimmed = pastedText.trim()
  if (trimmed.length < 100) {
    return {
      ok: false,
      error: "Please paste at least 100 characters from the report.",
    }
  }

  try {
    const aiSummary = await summarizeReportText(trimmed, title, source)

    if (!aiSummary || (!aiSummary.summary && aiSummary.bullets.length === 0)) {
      return {
        ok: false,
        error: "AI summarization failed. Ensure PERPLEXITY_API_KEY is set.",
      }
    }

    const entry: ReportSummaryEntry = {
      reportId,
      summary: aiSummary.summary || "",
      bullets: aiSummary.bullets || [],
      lastFetched: new Date().toISOString(),
      source: "page",
      error: null,
    }

    try {
      const existing: Record<string, ReportSummaryEntry> = {}
      try {
        const raw = await fs.readFile(SUMMARIES_PATH, "utf-8")
        const parsed = JSON.parse(raw)
        if (typeof parsed === "object" && parsed !== null) {
          Object.assign(existing, parsed)
        }
      } catch {
        /* file may not exist */
      }
      existing[reportId] = entry
      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.writeFile(SUMMARIES_PATH, JSON.stringify(existing, null, 2), "utf-8")
    } catch (writeErr) {
      console.warn("[summarizeReportFromPastedText] Could not save:", writeErr)
    }

    return { ok: true, summary: entry }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
