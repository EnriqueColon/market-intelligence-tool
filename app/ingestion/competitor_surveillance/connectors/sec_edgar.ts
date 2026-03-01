import type { Connector, ConnectorResult, RunContext, SurveillanceEvent } from "../base"
import { getDb } from "../storage/db"
import { getCompetitors, parseAliases } from "../storage/queries"

const SEC_SEARCH = "https://efts.sec.gov/LATEST/search-index"
const PAGE_SIZE = 50
const MAX_PAGES = 4
const RATE_LIMIT_MS = 200

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function normalizeDate(date?: string): string | undefined {
  if (!date) return undefined
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toISOString().slice(0, 10)
}

function buildEdgarUrl(cik?: string, accession?: string): string | undefined {
  if (!cik || !accession) return undefined
  const noDash = accession.replace(/-/g, "")
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${noDash}/${accession}-index.html`
}

function words(haystack: string, needle: string): boolean {
  const h = ` ${haystack.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `
  const n = ` ${needle.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `
  return h.includes(n)
}

function isMatch(filingCompany: string, competitorName: string, aliases: string[]): boolean {
  const haystack = (filingCompany || "").toLowerCase()
  if (words(haystack, competitorName)) return true
  for (const a of aliases) {
    if (!a?.trim()) continue
    if (words(haystack, a)) return true
  }
  return false
}

async function fetchSecFormDForFirm(
  firm: string,
  aliases: string[]
): Promise<Array<{ company: string; accession: string; cik?: string; filingDate?: string; form?: string }>> {
  const orTerms = [firm, ...aliases]
    .filter((x) => (x || "").trim().length > 0)
    .slice(0, 8)
    .map((x) => `"${(x || "").replace(/"/g, "")}"`)
  const query = orTerms.length > 1 ? `(${orTerms.join(" OR ")})` : orTerms[0] || `"${firm}"`
  const hits: any[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      keys: query,
      forms: "D",
      start: String(page * PAGE_SIZE),
      count: String(PAGE_SIZE),
    })
    const res = await fetch(`${SEC_SEARCH}?${params.toString()}`, {
      headers: {
        "User-Agent": "MarketIntelligence/1.0 (surveillance@marketintel.local)",
        Accept: "application/json",
      },
    })
    if (!res.ok) break
    const data = await res.json()
    const pageHits = data?.hits?.hits || []
    if (pageHits.length === 0) break
    hits.push(...pageHits)
    await sleep(RATE_LIMIT_MS)
  }

  return hits.map((hit: any) => {
    const s = hit?._source || hit?.source || {}
    const accession = s?.adsh || s?.accession_no || s?.accession || ""
    const cik = s?.cik || s?.ciks?.[0]
    return {
      company: s?.display_names?.[0] || s?.company || s?.company_name || "Unknown",
      accession,
      cik: cik ? String(cik).replace(/^0+/, "") : undefined,
      filingDate: normalizeDate(s?.file_date || s?.filed_at || s?.date),
      form: s?.form || "D",
    }
  })
}

export const secEdgarConnector: Connector = {
  key: "sec_edgar",
  name: "SEC EDGAR (Form D)",
  sourceType: "sec_edgar",
  isConfigured: () => true,
  async run(ctx: RunContext): Promise<ConnectorResult> {
    const db = getDb()
    const competitors = getCompetitors(db)
    const events: SurveillanceEvent[] = []

    for (const comp of competitors) {
      const aliases = parseAliases(comp.aliases_json)
      try {
        const filings = await fetchSecFormDForFirm(comp.name, aliases)
        for (const f of filings) {
          if (!isMatch(f.company, comp.name, aliases)) continue
          const eventType = f.form === "D/A" ? "fundraise_amendment" : "fundraise"
          events.push({
            competitor_id: comp.id,
            source_type: "sec_edgar",
            event_type: eventType,
            title: `Form ${f.form}: ${f.company}`,
            summary: f.company,
            event_date: f.filingDate,
            url: buildEdgarUrl(f.cik, f.accession),
            raw_json: JSON.stringify({ company: f.company, accession: f.accession, cik: f.cik }),
          })
        }
        await sleep(RATE_LIMIT_MS)
      } catch (err) {
        console.warn("sec_edgar:", comp.name, err)
      }
    }

    return {
      events,
      records: events.length,
      status: events.length > 0 ? "ok" : "partial",
      message: events.length > 0 ? undefined : "No Form D filings matched competitors",
    }
  },
}
