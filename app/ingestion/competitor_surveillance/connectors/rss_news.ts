import type { Connector, ConnectorResult, RunContext, SurveillanceEvent } from "../base"
import { getDb } from "../storage/db"
import { getCompetitors, parseAliases } from "../storage/queries"

const RSS_URL =
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent(
    '("distressed debt" OR "loan sale" OR "note sale" OR "real estate debt" OR "commercial real estate" OR "special servicing")'
  ) +
  "&hl=en-US&gl=US&ceid=US:en"
const MAX_AGE_DAYS = 14

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, "i")
  const m = block.match(re)
  if (!m) return ""
  return m[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim()
}

function stripHtml(v?: string): string {
  if (!v) return ""
  return v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

function normalizeDate(date?: string): string | undefined {
  if (!date) return undefined
  const p = new Date(date)
  if (Number.isNaN(p.getTime())) return undefined
  return p.toISOString().slice(0, 10)
}

function isWithinDays(dateStr: string | undefined, days: number): boolean {
  const d = dateStr ? Date.parse(dateStr) : NaN
  if (Number.isNaN(d)) return false
  return Date.now() - d <= days * 86400000
}

function words(haystack: string, needle: string): boolean {
  const h = ` ${haystack.toLowerCase()} `
  const n = ` ${needle.toLowerCase()} `
  return h.includes(n)
}

async function fetchRssItems(): Promise<Array<{ title: string; link: string; pubDate: string; description: string }>> {
  const res = await fetch(RSS_URL, {
    headers: {
      "User-Agent": "MarketIntelligence/1.0 (surveillance@marketintel.local)",
      Accept: "application/rss+xml, application/xml",
    },
    next: { revalidate: 1800 },
  })
  if (!res.ok) return []
  const xml = await res.text()
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = []
  const re = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const block = m[1]
    const title = stripHtml(extractTag(block, "title")) || "Untitled"
    const link = extractTag(block, "link")
    const pubDate = extractTag(block, "pubDate")
    const description = stripHtml(extractTag(block, "description"))
    if (link && title) {
      items.push({ title, link, pubDate, description })
    }
  }
  return items
}

export const rssNewsConnector: Connector = {
  key: "rss_news",
  name: "News / RSS",
  sourceType: "news",
  isConfigured: () => true,
  async run(ctx: RunContext): Promise<ConnectorResult> {
    const db = getDb()
    const competitors = getCompetitors(db)
    const items = await fetchRssItems()
    const events: SurveillanceEvent[] = []

    for (const item of items) {
      if (!isWithinDays(normalizeDate(item.pubDate) || item.pubDate, MAX_AGE_DAYS)) continue
      const text = `${item.title} ${item.description}`.toLowerCase()
      for (const comp of competitors) {
        const aliases = parseAliases(comp.aliases_json)
        const match =
          words(text, comp.name) || aliases.some((a) => a && words(text, a))
        if (!match) continue
        events.push({
          competitor_id: comp.id,
          source_type: "news",
          event_type: "press_mention",
          title: item.title,
          summary: item.description || undefined,
          event_date: normalizeDate(item.pubDate),
          url: item.link,
          raw_json: JSON.stringify({ source: "rss", pubDate: item.pubDate }),
        })
        break
      }
    }

    return {
      events,
      records: events.length,
      status: "ok",
    }
  },
}
