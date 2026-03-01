"use server"

import * as fs from "fs/promises"
import * as path from "path"
import { resolveDocument } from "@/lib/document-resolver"
import { summarizeReportText } from "@/lib/report-summarizer"
import { reportIdFromUrl } from "@/lib/report-id"
import type { ReportSummaryEntry } from "./fetch-report-summaries"

export type SummarizeFoundReportResult =
  | { ok: true; summary: ReportSummaryEntry }
  | { ok: false; error: string }

const SUMMARIES_PATH = path.join(process.cwd(), "data", "report-summaries.json")
const DATA_DIR = path.join(process.cwd(), "data")

export async function summarizeFoundReport(
  url: string,
  title: string,
  entityId: string
): Promise<SummarizeFoundReportResult> {
  try {
    const resolved = await resolveDocument(url)

    if (resolved.source === "failed") {
      const msg = resolved.error || "Could not fetch or extract content."
      const isBlocked =
        msg.includes("403") ||
        msg.includes("401") ||
        msg.includes("blocked") ||
        msg.includes("access denied")
      const hint = isBlocked
        ? " The report may be gated. Use 'Upload PDF / Paste text' if you have access."
        : ""
      return { ok: false, error: msg + hint }
    }

    if (!resolved.text || resolved.text.length < 100) {
      return {
        ok: false,
        error: "Insufficient content extracted. The page may require login or block automated access.",
      }
    }

    const sourceLabel = entityId === "all" || entityId === "watchlist" ? "Report" : entityId.toUpperCase()
    const aiSummary = await summarizeReportText(resolved.text, title, sourceLabel)

    if (!aiSummary || (!aiSummary.summary && aiSummary.bullets.length === 0)) {
      return {
        ok: false,
        error: "AI summarization failed. Ensure PERPLEXITY_API_KEY is set.",
      }
    }

    const reportId = reportIdFromUrl(resolved.finalUrl)
    const entry: ReportSummaryEntry = {
      reportId,
      summary: aiSummary.summary || "",
      bullets: aiSummary.bullets || [],
      lastFetched: new Date().toISOString(),
      source: resolved.source,
      error: null,
    }

    try {
      let existing: Record<string, ReportSummaryEntry> = {}
      try {
        const raw = await fs.readFile(SUMMARIES_PATH, "utf-8")
        const parsed = JSON.parse(raw)
        if (typeof parsed === "object" && parsed !== null) {
          existing = parsed
        }
      } catch {
        /* file may not exist */
      }
      existing[reportId] = entry
      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.writeFile(SUMMARIES_PATH, JSON.stringify(existing, null, 2), "utf-8")
    } catch (writeErr) {
      console.warn("[summarizeFoundReport] Could not save:", writeErr)
    }

    return { ok: true, summary: entry }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
