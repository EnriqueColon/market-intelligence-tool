import * as cheerio from "cheerio"
import { FETCH_HEADERS } from "@/lib/report-scraper"
import { fetchWithTimeout } from "@/lib/http"
import { isAssetUrlAllowedFromLanding, isHostnameAllowed, extractHostname } from "@/lib/domain-allowlist"
import { getLandingDomainsForEntity, type EntityId } from "@/lib/entity-sources"

export type ResolvedReport = {
  landingUrl: string
  documentUrl: string
  documentType: "pdf" | "html"
  title?: string
  blockedByAllowlist?: boolean
}

type Candidate = {
  url: string
  score: number
}

const PDF_HINTS = ["report", "outlook", "forecast", "research", "market", "download", "insight", "survey"]

function scorePdfCandidate(href: string, linkText: string): number {
  const h = href.toLowerCase()
  const t = linkText.toLowerCase()
  let score = 0
  if (h.includes(".pdf")) score += 5
  for (const hint of PDF_HINTS) {
    if (h.includes(hint)) score += 2
    if (t.includes(hint)) score += 1
  }
  return score
}

async function isPdfUrl(url: string): Promise<boolean> {
  try {
    const head = await fetchWithTimeout(url, {
      method: "HEAD",
      cache: "no-store",
      headers: FETCH_HEADERS,
      timeoutMs: 8000,
    })
    if (head.ok) {
      const ct = (head.headers.get("content-type") || "").toLowerCase()
      if (ct.includes("application/pdf")) return true
    }
  } catch {
    // Fall through to GET.
  }

  try {
    const getRes = await fetchWithTimeout(url, {
      cache: "no-store",
      headers: FETCH_HEADERS,
      timeoutMs: 8000,
    })
    if (!getRes.ok) return false
    const ct = (getRes.headers.get("content-type") || "").toLowerCase()
    return ct.includes("application/pdf")
  } catch {
    return false
  }
}

export async function resolveReportDocument(landingUrl: string, entityId: EntityId): Promise<ResolvedReport> {
  const lower = landingUrl.toLowerCase()
  if (lower.endsWith(".pdf")) {
    return {
      landingUrl,
      documentUrl: landingUrl,
      documentType: "pdf",
    }
  }

  const landingHost = extractHostname(landingUrl)
  const landingAllowed = isHostnameAllowed(landingHost, getLandingDomainsForEntity(entityId))
  if (!landingAllowed) {
    return {
      landingUrl,
      documentUrl: landingUrl,
      documentType: "html",
      blockedByAllowlist: true,
    }
  }

  try {
    const res = await fetchWithTimeout(landingUrl, {
      cache: "no-store",
      headers: FETCH_HEADERS,
      timeoutMs: 8000,
    })
    if (!res.ok) {
      return { landingUrl, documentUrl: landingUrl, documentType: "html" }
    }
    const html = await res.text()
    const $ = cheerio.load(html)
    const pageTitle = $("title").first().text().trim() || undefined

    const candidates: Candidate[] = []
    let blockedByAllowlist = false
    $("a[href]").each((_, el) => {
      const href = ($(el).attr("href") || "").trim()
      if (!href) return
      const linkText = $(el).text() || ""
      let absolute = ""
      try {
        absolute = new URL(href, landingUrl).toString()
      } catch {
        return
      }

      const combined = `${absolute} ${linkText}`.toLowerCase()
      const likelyPdf =
        combined.includes(".pdf") ||
        combined.includes("download") ||
        combined.includes("report") ||
        combined.includes("outlook") ||
        combined.includes("research") ||
        combined.includes("market") ||
        combined.includes("asset") ||
        combined.includes("media") ||
        combined.includes("/insights/")
      if (!likelyPdf) return

      if (!isAssetUrlAllowedFromLanding(landingUrl, absolute, entityId)) {
        blockedByAllowlist = true
        return
      }

      candidates.push({
        url: absolute,
        score: scorePdfCandidate(absolute, linkText),
      })
    })

    const uniqueCandidates = Array.from(
      new Map(candidates.map((c) => [c.url, c])).values()
    ).sort((a, b) => b.score - a.score)

    for (const candidate of uniqueCandidates) {
      if (await isPdfUrl(candidate.url)) {
        return {
          landingUrl,
          documentUrl: candidate.url,
          documentType: "pdf",
          title: pageTitle,
          blockedByAllowlist,
        }
      }
    }

    return {
      landingUrl,
      documentUrl: landingUrl,
      documentType: "html",
      title: pageTitle,
      blockedByAllowlist,
    }
  } catch {
    return { landingUrl, documentUrl: landingUrl, documentType: "html" }
  }
}
