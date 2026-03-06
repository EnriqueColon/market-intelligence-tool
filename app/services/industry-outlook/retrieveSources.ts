import type { RetrievedSource } from "@/app/services/industry-outlook/schema"

const RSS_TIMEOUT_MS = 12_000
const URL_RESOLVE_TIMEOUT_MS = 4_000

type QuerySpec = {
  region: "national" | "florida" | "miami"
  label: string
  query: string
}

const QUERIES: QuerySpec[] = [
  {
    region: "national",
    label: "US distressed CRE debt",
    query:
      '"commercial real estate" (CMBS OR "special servicing" OR delinquency OR "note sale" OR "loan sale" OR foreclosure OR workout OR receivership) debt',
  },
  {
    region: "florida",
    label: "Florida distressed CRE debt",
    query:
      'Florida ("commercial real estate" OR CRE) (foreclosure OR workout OR "loan sale" OR "note sale" OR "special servicing" OR CMBS OR delinquency)',
  },
  {
    region: "miami",
    label: "Miami distressed CRE debt",
    query:
      '"Miami" OR "Miami-Dade" ("commercial real estate" OR CRE) (foreclosure OR workout OR "loan sale" OR "note sale" OR "special servicing" OR CMBS OR delinquency)',
  },
]

async function fetchWithTimeout(input: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers()
    headers.set("User-Agent", "MarketIntelligence/1.0 (industry-outlook@marketintel.local)")
    headers.set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8")
    headers.set("Accept-Language", "en-US,en;q=0.9")
    return await fetch(input, { headers, signal: controller.signal, cache: "no-store" })
  } finally {
    clearTimeout(id)
  }
}

async function resolveGoogleNewsRedirect(url: string): Promise<string> {
  try {
    const parsed = new URL(url)
    const isGoogleNews =
      parsed.hostname.toLowerCase().includes("news.google.com") &&
      parsed.pathname.includes("/rss/articles/")
    if (!isGoogleNews) return url

    const res = await fetchWithTimeout(url, URL_RESOLVE_TIMEOUT_MS)
    const finalUrl = (res.url || "").trim()
    if (!finalUrl) return url

    try {
      const finalParsed = new URL(finalUrl)
      if (finalParsed.hostname.toLowerCase().includes("news.google.com")) {
        return url
      }
      if (finalUrl.startsWith("http://") || finalUrl.startsWith("https://")) {
        return finalUrl
      }
    } catch {
      return url
    }
    return url
  } catch {
    return url
  }
}

function extractTag(block: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  const match = block.match(regex)
  return match ? match[1].trim() : ""
}

function stripHtml(value: string) {
  return (value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function parseRssItems(xml: string) {
  const out: Array<{ title: string; link: string; dateRaw: string; source: string; description: string }> = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(xml))) {
    const block = m[1]
    out.push({
      title: extractTag(block, "title") || "Untitled",
      link: extractTag(block, "link") || "",
      dateRaw: extractTag(block, "pubDate") || extractTag(block, "dc:date") || "",
      source: extractTag(block, "source") || "",
      description: extractTag(block, "description") || "",
    })
  }
  return out
}

function parseAtomItems(xml: string) {
  const out: Array<{ title: string; link: string; dateRaw: string; source: string; summary: string }> = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = entryRegex.exec(xml))) {
    const block = m[1]
    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/i)
    out.push({
      title: extractTag(block, "title") || "Untitled",
      link: linkMatch ? linkMatch[1] : "",
      dateRaw: extractTag(block, "updated") || extractTag(block, "published") || "",
      source: extractTag(block, "source") || "",
      summary: extractTag(block, "summary") || extractTag(block, "content") || "",
    })
  }
  return out
}

function toSource(
  region: RetrievedSource["region"],
  title: string,
  url: string,
  source: string,
  dateRaw: string,
  snippet: string
): RetrievedSource | null {
  const cleanUrl = (url || "").trim()
  if (!cleanUrl || !title) return null
  return {
    title: stripHtml(title),
    url: cleanUrl,
    region,
    publisher: stripHtml(source),
    date: dateRaw || undefined,
    snippet: stripHtml(snippet),
  }
}

function dedupeSources(items: RetrievedSource[]) {
  const seen = new Set<string>()
  const out: RetrievedSource[] = []
  for (const item of items) {
    const key = item.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function googleNewsRssUrl(query: string) {
  return `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" }).toString()}`
}

async function fetchQuery(spec: QuerySpec): Promise<RetrievedSource[]> {
  const url = googleNewsRssUrl(spec.query)
  const res = await fetchWithTimeout(url, RSS_TIMEOUT_MS)
  if (!res.ok) return []
  const xml = await res.text()
  const isAtom = xml.slice(0, 400).toLowerCase().includes("<feed")
  const sources: RetrievedSource[] = []
  if (isAtom) {
    for (const entry of parseAtomItems(xml)) {
      const source = toSource(spec.region, entry.title, entry.link, entry.source, entry.dateRaw, entry.summary)
      if (source) sources.push(source)
    }
  } else {
    for (const item of parseRssItems(xml)) {
      const source = toSource(spec.region, item.title, item.link, item.source, item.dateRaw, item.description)
      if (source) sources.push(source)
    }
  }
  return sources
}

export async function retrieveSources(): Promise<RetrievedSource[]> {
  const results = await Promise.all(QUERIES.map((spec) => fetchQuery(spec)))
  const flat = dedupeSources(results.flat())

  const byRegion = {
    national: flat.filter((x) => x.region === "national"),
    florida: flat.filter((x) => x.region === "florida"),
    miami: flat.filter((x) => x.region === "miami"),
  }

  const picked: RetrievedSource[] = []
  picked.push(...byRegion.national.slice(0, 4))
  picked.push(...byRegion.florida.slice(0, 3))
  picked.push(...byRegion.miami.slice(0, 3))

  const remaining = flat.filter((x) => !picked.includes(x))
  for (const item of remaining) {
    if (picked.length >= 10) break
    picked.push(item)
  }

  const selected = picked.slice(0, 10)
  const resolved = await Promise.all(
    selected.map(async (item) => ({
      ...item,
      url: await resolveGoogleNewsRedirect(item.url),
    }))
  )
  return dedupeSources(resolved)
}
