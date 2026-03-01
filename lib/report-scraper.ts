/**
 * Report scraper: fetches report pages, finds PDFs or extracts page content,
 * then returns extracted text for summarization.
 */

import * as cheerio from "cheerio"
import { chromium } from "playwright"
import path from "path"
import os from "os"

const DELAY_MS = 2500
const FETCH_TIMEOUT_MS = 15_000
const PLAYWRIGHT_TIMEOUT_MS = 30_000
const MAX_PDF_PAGES = 20

export const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Referer: "https://www.google.com/",
}

export type ScrapeResult = {
  text: string
  source: "pdf" | "page" | "failed"
  error?: string
}

function resolveUrl(base: string, href: string): string {
  if (!href || href.startsWith("http://") || href.startsWith("https://")) {
    return href
  }
  try {
    const baseUrl = new URL(base)
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function safeTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

/**
 * Lightweight: fetch HTML, parse with Cheerio, find PDF links or extract page text.
 */
async function scrapeLightweight(url: string): Promise<ScrapeResult> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!res.ok) {
      return { text: "", source: "failed", error: `HTTP ${res.status}` }
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase()

    if (contentType.includes("application/pdf")) {
      const ab = await res.arrayBuffer()
      const buf = Buffer.from(ab)
      const { extractTextWithFallbacks } = require("../app/actions/pdf-text-extraction.js") as {
        extractTextWithFallbacks: (pdfBytes: Buffer, opts?: { maxPages?: number }) => Promise<{ text: string }>
      }
      const ex = await extractTextWithFallbacks(buf, { maxPages: MAX_PDF_PAGES })
      const text = (ex.text || "").trim()
      return text ? { text: safeTruncate(text, 45_000), source: "pdf" } : { text: "", source: "failed", error: "PDF extraction returned empty" }
    }

    const html = await res.text()
    const $ = cheerio.load(html)

    const pdfLinks: string[] = []
    $('a[href]').each((_, el) => {
      const href = $(el).attr("href") || ""
      const text = $(el).text().toLowerCase()
      if (href.includes(".pdf") || text.includes("pdf") || text.includes("download") || text.includes("report")) {
        const resolved = resolveUrl(url, href)
        if (resolved && resolved.startsWith("http")) {
          pdfLinks.push(resolved)
        }
      }
    })

    if (pdfLinks.length > 0) {
      const pdfUrl = pdfLinks[0]
      const pdfRes = await fetch(pdfUrl, {
        cache: "no-store",
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (pdfRes.ok) {
        const ab = await pdfRes.arrayBuffer()
        const buf = Buffer.from(ab)
        const { extractTextWithFallbacks } = require("../app/actions/pdf-text-extraction.js") as {
          extractTextWithFallbacks: (pdfBytes: Buffer, opts?: { maxPages?: number }) => Promise<{ text: string }>
        }
        const ex = await extractTextWithFallbacks(buf, { maxPages: MAX_PDF_PAGES })
        const text = (ex.text || "").trim()
        if (text) {
          return { text: safeTruncate(text, 45_000), source: "pdf" }
        }
      }
    }

    const mainContent = $("article, main, .content, .report, .insight, [role=main], body").first()
    const pageText = mainContent.length ? mainContent.text() : $("body").text()
    const stripped = stripHtml(pageText || html).trim()
    if (stripped.length > 200) {
      return { text: safeTruncate(stripped, 45_000), source: "page" }
    }

    return { text: "", source: "failed", error: "No sufficient content extracted" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: "", source: "failed", error: msg }
  }
}

/**
 * Heavy: use Playwright to load page with JS, look for PDF links or content.
 */
async function scrapeWithPlaywright(url: string): Promise<ScrapeResult> {
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    page.setDefaultTimeout(PLAYWRIGHT_TIMEOUT_MS)

    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null)

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 })
    await page.waitForTimeout(2000)

    const pdfLinks = await page.$$eval('a[href*=".pdf"]', (links) =>
      links.map((a) => (a as HTMLAnchorElement).href).filter(Boolean)
    )

    if (pdfLinks.length > 0) {
      const pdfUrl = pdfLinks[0]
      const pdfRes = await fetch(pdfUrl, {
        cache: "no-store",
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (pdfRes.ok) {
        const ab = await pdfRes.arrayBuffer()
        const buf = Buffer.from(ab)
        const { extractTextWithFallbacks } = require("../app/actions/pdf-text-extraction.js") as {
          extractTextWithFallbacks: (pdfBytes: Buffer, opts?: { maxPages?: number }) => Promise<{ text: string }>
        }
        const ex = await extractTextWithFallbacks(buf, { maxPages: MAX_PDF_PAGES })
        const text = (ex.text || "").trim()
        if (text) {
          return { text: safeTruncate(text, 45_000), source: "pdf" }
        }
      }
    }

    const selectors = [
      '[data-download]',
      '.download-pdf',
      'a:has-text("Download")',
      'a:has-text("PDF")',
      'button:has-text("Download")',
      '[class*="download"]',
      '[class*="report"]',
    ]

    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el) {
          await el.click()
          await page.waitForTimeout(3000)
          break
        }
      } catch {
        // ignore
      }
    }

    const download = await downloadPromise
    if (download) {
      const savePath = path.join(os.tmpdir(), `report-${Date.now()}.pdf`)
      await download.saveAs(savePath)
      const fs = require("fs/promises")
      const buf = await fs.readFile(savePath)
      await fs.unlink(savePath).catch(() => {})
      const { extractTextWithFallbacks } = require("../app/actions/pdf-text-extraction.js") as {
        extractTextWithFallbacks: (pdfBytes: Buffer, opts?: { maxPages?: number }) => Promise<{ text: string }>
      }
      const ex = await extractTextWithFallbacks(buf, { maxPages: MAX_PDF_PAGES })
      const text = (ex.text || "").trim()
      if (text) {
        return { text: safeTruncate(text, 45_000), source: "pdf" }
      }
    }

    const pageText = await page.evaluate(() => {
      const main = document.querySelector("article, main, .content, .report, [role=main]") || document.body
      return main?.innerText || document.body?.innerText || ""
    })
    const stripped = (pageText || "").replace(/\s+/g, " ").trim()
    if (stripped.length > 200) {
      return { text: safeTruncate(stripped, 45_000), source: "page" }
    }

    return { text: "", source: "failed", error: "Playwright: no sufficient content" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: "", source: "failed", error: msg }
  } finally {
    await browser?.close()
  }
}

/**
 * Find a direct PDF URL from a report page. Returns the URL if the page is a PDF or links to one.
 * Uses lightweight fetch + Cheerio only (no Playwright).
 */
export async function findPdfUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!res.ok) return null

    const contentType = (res.headers.get("content-type") || "").toLowerCase()
    if (contentType.includes("application/pdf")) {
      return url
    }

    const html = await res.text()
    const $ = cheerio.load(html)

    const pdfLinks: string[] = []
    $('a[href]').each((_, el) => {
      const href = $(el).attr("href") || ""
      const text = $(el).text().toLowerCase()
      const likelyPdf = href.includes(".pdf") || text.includes("pdf") || text.includes("download") || text.includes("report")
      if (likelyPdf) {
        const resolved = resolveUrl(url, href)
        if (resolved && resolved.startsWith("http") && !pdfLinks.includes(resolved)) {
          pdfLinks.push(resolved)
        }
      }
    })

    for (const pdfUrl of pdfLinks) {
      try {
        const headRes = await fetch(pdfUrl, {
          method: "HEAD",
          cache: "no-store",
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(10_000),
        })
        if (!headRes.ok) continue // Skip 404, 403, etc.
        const ct = (headRes.headers.get("content-type") || "").toLowerCase()
        if (ct.includes("application/pdf")) return pdfUrl
      } catch {
        // Try GET if HEAD fails (some servers don't support HEAD)
        try {
          const getRes = await fetch(pdfUrl, {
            cache: "no-store",
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(10_000),
          })
          if (!getRes.ok) continue // Skip 404, 403, etc.
          const ct = (getRes.headers.get("content-type") || "").toLowerCase()
          if (ct.includes("application/pdf")) return pdfUrl
        } catch {
          // skip
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Scrape a report URL: try lightweight first, fall back to Playwright.
 * Use lightweightOnly: true when Playwright is not available (e.g. serverless, missing chromium).
 */
export async function scrapeReport(url: string, opts?: { lightweightOnly?: boolean }): Promise<ScrapeResult> {
  const lightweight = await scrapeLightweight(url)
  if (lightweight.source !== "failed" && lightweight.text.length > 100) {
    return lightweight
  }
  if (opts?.lightweightOnly) {
    return lightweight
  }
  await new Promise((r) => setTimeout(r, DELAY_MS))
  return scrapeWithPlaywright(url)
}
