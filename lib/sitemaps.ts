import { fetchWithTimeout } from "@/lib/http"

export type SitemapEntry = { loc: string; lastmod?: string }

function isSitemapIndex(xml: string): boolean {
  return /<\s*sitemapindex\b/i.test(xml)
}

export async function fetchSitemapXml(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: 8000,
      cache: "no-store",
      redirect: "follow",
      headers: {
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error("[sitemap] fetch failed", {
        url,
        status: res.status,
        ct: res.headers.get("content-type"),
        body: body.slice(0, 200),
      })
      return null
    }
    return await res.text()
  } catch {
    return null
  }
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  const seen = new Set<string>()

  if (isSitemapIndex(xml)) {
    const re = /<\s*sitemap\b[^>]*>([\s\S]*?)<\s*\/\s*sitemap\s*>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(xml)) !== null) {
      const block = match[1]
      const locMatch = block.match(/<\s*loc\s*>([\s\S]*?)<\s*\/\s*loc\s*>/i)
      const lastmodMatch = block.match(/<\s*lastmod\s*>([\s\S]*?)<\s*\/\s*lastmod\s*>/i)
      const loc = (locMatch?.[1] || "").trim()
      if (!loc || seen.has(loc)) continue
      seen.add(loc)
      entries.push({
        loc,
        lastmod: (lastmodMatch?.[1] || "").trim() || undefined,
      })
    }
    return entries
  }

  const re = /<\s*url\b[^>]*>([\s\S]*?)<\s*\/\s*url\s*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    const block = match[1]
    const locMatch = block.match(/<\s*loc\s*>([\s\S]*?)<\s*\/\s*loc\s*>/i)
    const lastmodMatch = block.match(/<\s*lastmod\s*>([\s\S]*?)<\s*\/\s*lastmod\s*>/i)
    const loc = (locMatch?.[1] || "").trim()
    if (!loc || seen.has(loc)) continue
    seen.add(loc)
    entries.push({
      loc,
      lastmod: (lastmodMatch?.[1] || "").trim() || undefined,
    })
  }
  return entries
}

export async function getSitemapEntries(urls: string[], maxEntries: number): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = []
  const seenLoc = new Set<string>()
  const seenSitemaps = new Set<string>()
  const queue = [...urls]

  while (queue.length > 0 && out.length < maxEntries) {
    const sitemapUrl = queue.shift()!
    if (seenSitemaps.has(sitemapUrl)) continue
    seenSitemaps.add(sitemapUrl)

    const xml = await fetchSitemapXml(sitemapUrl)
    if (!xml) continue

    const parsed = parseSitemap(xml)
    if (isSitemapIndex(xml)) {
      for (const child of parsed) {
        if (out.length >= maxEntries) break
        if (!seenSitemaps.has(child.loc)) queue.push(child.loc)
      }
      continue
    }

    for (const item of parsed) {
      if (out.length >= maxEntries) break
      if (seenLoc.has(item.loc)) continue
      seenLoc.add(item.loc)
      out.push(item)
    }
  }

  return out
}
