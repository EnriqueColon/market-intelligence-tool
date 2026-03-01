 "use server"
 
 export type PublicFiling = {
   id: string
   company?: string
   cik?: string
  accession?: string
  documentName?: string
   filingDate?: string
   form?: string
   url?: string
  fundName?: string
  offeringAmount?: number
  amountSold?: number
  remainingAmount?: number
  investors?: number
  industryGroup?: string
  issuerType?: string
  stateOfIncorporation?: string
 }
 
 export type PublicNewsItem = {
   id: string
   title: string
   source?: string
   date?: string
   url?: string
  snippet?: string
 }
 
 export type CompetitorIntelResponse = {
   filings: PublicFiling[]
   news: PublicNewsItem[]
   notes: string[]
 }
 
export type FirmDossierResponse = {
  firm: string
  filings: PublicFiling[]
  notes: string[]
  totalHits?: number
  rawInRange?: number
  matchedInRange?: number
  aliasesUsed?: string[]
}

export type FirmAliasSuggestion = {
  name: string
  count: number
  sourceFields?: Array<"fundName" | "company">
  witness?: {
    witnessedAs?: "fundName" | "company"
    filingDate?: string
    url?: string
    cik?: string
    accession?: string
  }
  exampleFilingDate?: string
  exampleUrl?: string
}

 const SEC_SEARCH_ENDPOINT = "https://efts.sec.gov/LATEST/search-index"
const DEFAULT_QUERY =
  '"distressed debt" OR "commercial real estate" OR "real estate debt" OR "mortgage" OR "loan sale" OR "note sale" OR "special servicing"'
 
 function normalizeDate(date?: string) {
   if (!date) return undefined
   const parsed = new Date(date)
   if (Number.isNaN(parsed.getTime())) return date
   return parsed.toISOString().slice(0, 10)
 }

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

const MATCH_STOP = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "llc",
  "lp",
  "ltd",
  "limited",
  "plc",
  "group",
  "management",
  "partners",
  "partner",
  "capital",
  "realty",
  "real",
  "estate",
  "holdings",
  "fund",
  "funds",
  "advisors",
  "advisor",
  "investments",
  "investment",
  "private",
  "credit",
  "debt",
  "strategies",
  "strategy",
  "trust",
  "inc",
])

function words(haystack: string, needle: string) {
  const h = ` ${normalizeName(haystack)} `
  const n = ` ${normalizeName(needle)} `
  return h.includes(n)
}

function meaningfulTokens(value: string) {
  const toks = normalizeName(value).split(" ").filter(Boolean)
  return toks.filter((t) => t.length >= 4 && !MATCH_STOP.has(t))
}

function isLikelyFirmMatch(filing: PublicFiling, firm: string) {
  const firmKey = normalizeName(firm)
  if (!firmKey) return false
  const haystack = normalizeName(`${filing.company || ""} ${filing.fundName || ""}`)

  // Exact phrase match wins.
  if (words(haystack, firmKey)) return true

  // For short single-token names (e.g., "KKR", "AB") require word-boundary match.
  const firmTokens = firmKey.split(" ").filter(Boolean)
  if (firmTokens.length === 1) {
    return words(haystack, firmTokens[0])
  }

  // For multi-token firm names, require all meaningful tokens to appear.
  const meaningful = meaningfulTokens(firmKey)
  if (meaningful.length >= 2) {
    return meaningful.every((t) => words(haystack, t))
  }
  if (meaningful.length === 1) {
    // Single meaningful token: still require word-boundary and >= 6 chars to avoid "street" style collisions.
    return meaningful[0].length >= 6 ? words(haystack, meaningful[0]) : false
  }

  // Fallback: require full phrase match (already checked above), otherwise no match.
  return false
}

function isLikelyFirmMatchWithAliases(filing: PublicFiling, firm: string, aliases: string[]) {
  if (isLikelyFirmMatch(filing, firm)) return true
  // Aliases should be matched more strictly to avoid cross-contamination:
  // - treat the alias as a phrase (word-boundary), not "2 tokens is enough".
  const haystack = normalizeName(`${filing.company || ""} ${filing.fundName || ""}`)
  for (const alias of aliases) {
    const a = (alias || "").trim()
    if (!a) continue
    const aliasKey = normalizeName(a)
    if (!aliasKey) continue
    if (words(haystack, aliasKey)) return true
  }
  return false
}

function generateAliasSeeds(firm: string) {
  // Conservative seeds to improve recall without exploding false positives.
  const raw = firm.trim()
  if (!raw) return []
  const normalized = normalizeName(raw)
  const tokens = normalized.split(" ").filter(Boolean)

  const STOP = new Set([
    "inc",
    "incorporated",
    "corp",
    "corporation",
    "co",
    "company",
    "llc",
    "lp",
    "ltd",
    "limited",
    "plc",
    "group",
    "management",
    "partners",
    "partner",
    "capital",
    "realty",
    "real",
    "estate",
    "holdings",
    "fund",
    "funds",
    "advisors",
    "advisor",
    "investments",
    "investment",
    "private",
    "credit",
    "debt",
    "strategies",
    "strategy",
  ])

  const meaningful = tokens.filter((t) => t.length >= 4 && !STOP.has(t))
  const seeds: string[] = []

  seeds.push(raw)

  if (meaningful.length >= 2) {
    seeds.push(`${meaningful[0]} ${meaningful[1]}`)
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const s of seeds) {
    const key = normalizeName(s)
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out.slice(0, 6)
}
 
 function buildEdgarUrl(cik?: string, accession?: string) {
   if (!cik || !accession) return undefined
   const accessionNoDash = accession.replace(/-/g, "")
   return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDash}/${accession}-index.html`
 }

function padCik(cik?: string) {
  if (!cik) return undefined
  return cik.padStart(10, "0")
}
 
async function fetchSecFormDFilings(): Promise<PublicFiling[]> {
  const pageSize = 100
  const maxPages = 12
  const hits: any[] = []

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      keys: DEFAULT_QUERY,
      forms: "D",
      start: String(page * pageSize),
      count: String(pageSize),
    })

    const response = await fetch(`${SEC_SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: {
        "User-Agent": "MarketIntelligence/1.0 (research@marketintel.local)",
        "Accept": "application/json",
      },
      next: { revalidate: 3600 },
    })

    if (!response.ok) break
    const data = await response.json()
    const pageHits = data?.hits?.hits || []
    if (pageHits.length === 0) break
    hits.push(...pageHits)
    if (pageHits.length < pageSize) break
  }

  return hits.map((hit: any, index: number) => {
    const source = hit?._source || hit?.source || hit || {}
    const rawId = typeof hit?._id === "string" ? hit._id : ""
    const idParts = rawId.split(":")
    const documentName = idParts.length > 1 ? idParts[1] : undefined
    const company =
      source?.display_names?.[0] ||
      source?.company ||
      source?.company_name ||
      source?.companyName ||
      "Unknown"
    const accession = source?.adsh || source?.accession_no || source?.accession || ""
    const cikValue = source?.cik || source?.ciks?.[0]
    const cik = cikValue ? String(cikValue).replace(/^0+/, "") : undefined
    return {
      id: `sec-${accession || index}`,
      company,
      cik,
      accession,
      documentName,
      filingDate: normalizeDate(source?.file_date || source?.filed_at || source?.date),
      form: source?.form || "D",
      url: buildEdgarUrl(cik, accession),
    }
  })
}
 
function extractTag(block: string, tag: string) {
  const pattern = `<(?:[a-zA-Z0-9]+:)?${tag}>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`
  const match = block.match(new RegExp(pattern, "i"))
  if (!match) return undefined
  return match[1].replace(/<!\\[CDATA\\[(.*?)\\]\\]>/g, "$1").trim()
}

function stripHtml(value?: string) {
  if (!value) return undefined
  const withoutTags = value.replace(/<[^>]*>/g, " ")
  const collapsed = withoutTags.replace(/\s+/g, " ").trim()
  return collapsed || undefined
}

async function fetchSecFormDFilingsForFirm(
  firm: string,
  aliases: string[]
): Promise<{ filings: PublicFiling[]; total?: number }> {
  const pageSize = 100
  const maxPages = 8
  const hits: any[] = []

  const orTerms = [firm, ...aliases]
    .map((x) => (x || "").trim())
    .filter((x) => x.length > 0)
    .slice(0, 12)
    .map((x) => `"${x.replace(/"/g, "")}"`)
  const nameClause = orTerms.length > 1 ? `(${orTerms.join(" OR ")})` : orTerms[0] || `"${firm}"`
  // Use issuer/fund name matching for accuracy; keep the search broad enough to actually return filings.
  const firmQuery = nameClause

  let total: number | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      keys: firmQuery,
      forms: "D",
      start: String(page * pageSize),
      count: String(pageSize),
    })

    const response = await fetch(`${SEC_SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: {
        "User-Agent": "MarketIntelligence/1.0 (research@marketintel.local)",
        "Accept": "application/json",
      },
      next: { revalidate: 3600 },
    })

    if (!response.ok) break
    const data = await response.json()
    const pageHits = data?.hits?.hits || []
    if (typeof total !== "number") {
      const candidate = data?.hits?.total?.value
      if (typeof candidate === "number") total = candidate
    }
    if (pageHits.length === 0) break
    hits.push(...pageHits)
    if (pageHits.length < pageSize) break
  }

  const rawFilings = hits.map((hit: any, index: number) => {
    const source = hit?._source || hit?.source || hit || {}
    const rawId = typeof hit?._id === "string" ? hit._id : ""
    const idParts = rawId.split(":")
    const documentName = idParts.length > 1 ? idParts[1] : undefined
    const company =
      source?.display_names?.[0] ||
      source?.company ||
      source?.company_name ||
      source?.companyName ||
      "Unknown"
    const accession = source?.adsh || source?.accession_no || source?.accession || ""
    const cikValue = source?.cik || source?.ciks?.[0]
    const cik = cikValue ? String(cikValue).replace(/^0+/, "") : undefined
    return {
      id: `sec-firm-${accession || index}`,
      company,
      cik,
      accession,
      documentName,
      filingDate: normalizeDate(source?.file_date || source?.filed_at || source?.date),
      form: source?.form || "D",
      url: buildEdgarUrl(cik, accession),
    }
  })

  const deduped = new Map<string, PublicFiling>()
  rawFilings.forEach((f, idx) => {
    const key = `${f.cik || ""}-${f.accession || ""}-${f.documentName || ""}`
    if (!deduped.has(key)) deduped.set(key, { ...f, id: `${f.id}-${idx}` })
  })

  return { filings: Array.from(deduped.values()), total }
}

async function fetchSecFormDFilingsForAliasDiscovery(
  firm: string
): Promise<{ filings: PublicFiling[]; total?: number }> {
  const pageSize = 100
  const maxPages = 6
  const hits: any[] = []

  // Alias discovery should be broader than "distressed CRE debt" but still finance/RE focused.
  const discoveryQuery = `"${firm.replace(/"/g, "")}" AND ("real estate" OR mortgage OR debt OR credit OR "commercial real estate")`

  let total: number | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      keys: discoveryQuery,
      forms: "D",
      start: String(page * pageSize),
      count: String(pageSize),
    })

    const response = await fetch(`${SEC_SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: {
        "User-Agent": "MarketIntelligence/1.0 (research@marketintel.local)",
        "Accept": "application/json",
      },
      next: { revalidate: 3600 },
    })

    if (!response.ok) break
    const data = await response.json()
    const pageHits = data?.hits?.hits || []
    if (typeof total !== "number") {
      const candidate = data?.hits?.total?.value
      if (typeof candidate === "number") total = candidate
    }
    if (pageHits.length === 0) break
    hits.push(...pageHits)
    if (pageHits.length < pageSize) break
  }

  const filings = hits.map((hit: any, index: number) => {
    const source = hit?._source || hit?.source || hit || {}
    const rawId = typeof hit?._id === "string" ? hit._id : ""
    const idParts = rawId.split(":")
    const documentName = idParts.length > 1 ? idParts[1] : undefined
    const company =
      source?.display_names?.[0] ||
      source?.company ||
      source?.company_name ||
      source?.companyName ||
      "Unknown"
    const accession = source?.adsh || source?.accession_no || source?.accession || ""
    const cikValue = source?.cik || source?.ciks?.[0]
    const cik = cikValue ? String(cikValue).replace(/^0+/, "") : undefined
    return {
      id: `sec-alias-${accession || index}`,
      company,
      cik,
      accession,
      documentName,
      filingDate: normalizeDate(source?.file_date || source?.filed_at || source?.date),
      form: source?.form || "D",
      url: buildEdgarUrl(cik, accession),
    }
  })

  return { filings, total }
}

function extractAnyTag(block: string, tags: string[]) {
  for (const tag of tags) {
    const value = extractTag(block, tag)
    if (value) return value
  }
  return undefined
}

function parseNumber(value?: string) {
  if (!value) return undefined
  const normalized = value.replace(/[^0-9.-]/g, "")
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? undefined : parsed
}

function cleanIssuerName(value: string) {
  return value
    .replace(/\s*\(CIK\s*\d+\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchFormDDetails(filing: PublicFiling): Promise<Partial<PublicFiling>> {
  if (!filing.cik || !filing.accession) return {}
  const cikNoZero = filing.cik.replace(/^0+/, "")
  const padded = padCik(cikNoZero)
  if (!padded) return {}

  const submissionsUrl = `https://data.sec.gov/submissions/CIK${padded}.json`
  const submissionsResponse = await fetch(submissionsUrl, {
    headers: {
      "User-Agent": "MarketIntelligence/1.0 (research@marketintel.local)",
      "Accept": "application/json",
    },
    next: { revalidate: 3600 },
  })
  if (!submissionsResponse.ok) return {}
  const submissions = await submissionsResponse.json()
  const recent = submissions?.filings?.recent
  if (!recent?.accessionNumber || !Array.isArray(recent.accessionNumber)) return {}

  const index = recent.accessionNumber.findIndex((item: string) => item === filing.accession)
  if (index === -1) return {}
  const primaryDoc = recent.primaryDocument?.[index]
  if (!primaryDoc) return {}

  const accessionNoDash = filing.accession.replace(/-/g, "")
  const preferredDoc = filing.documentName || primaryDoc
  const xmlUrl = preferredDoc
    ? `https://www.sec.gov/Archives/edgar/data/${cikNoZero}/${accessionNoDash}/${preferredDoc}`
    : ""
  if (!xmlUrl) return {}
  const xmlResponse = await fetch(xmlUrl, {
    headers: {
      "User-Agent": "MarketIntelligence/1.0 (research@marketintel.local)",
      "Accept": "application/xml",
    },
    next: { revalidate: 3600 },
  })
  let xml = ""
  if (xmlResponse.ok) {
    xml = await xmlResponse.text()
  }

  const buildDetails = (payload: string) => ({
    fundName: extractAnyTag(payload, [
      "issuerName",
      "fundName",
      "entityName",
      "issuerNameList",
    ]),
    offeringAmount: parseNumber(
      extractAnyTag(payload, ["totalOfferingAmount", "offeringAmount", "offeringAmountTotal"])
    ),
    amountSold: parseNumber(
      extractAnyTag(payload, ["totalAmountSold", "amountSold", "amountSoldTotal"])
    ),
    remainingAmount: parseNumber(
      extractAnyTag(payload, ["totalRemaining", "remainingAmount", "remainingAmountTotal"])
    ),
    investors: parseNumber(
      extractAnyTag(payload, ["numberOfInvestors", "numberOfInvestorsTotal", "investorCount"])
    ),
    industryGroup: extractAnyTag(payload, [
      "industryGroupType",
      "industryGroupTypeDescription",
      "industryGroup",
    ]),
    issuerType: extractAnyTag(payload, ["issuerType", "issuerTypeDescription"]),
    stateOfIncorporation: extractAnyTag(payload, [
      "jurisdictionOfIncorporation",
      "jurisdictionOfIncorporationOrOrganization",
      "stateOfIncorporation",
    ]),
  })

  let details = buildDetails(xml)
  const hasDetail = Object.values(details).some((value) => value !== undefined)

  if (!hasDetail) {
    const indexUrl = `https://data.sec.gov/Archives/edgar/data/${cikNoZero}/${accessionNoDash}/index.json`
    const indexResponse = await fetch(indexUrl, {
      headers: {
        "User-Agent": "MarketIntelligence/1.0 (research@marketintel.local)",
        "Accept": "application/json",
      },
      next: { revalidate: 3600 },
    })
    if (indexResponse.ok) {
      const indexData = await indexResponse.json()
      const items = indexData?.directory?.item || []
      const xmlCandidates = items
        .map((item: any) => item?.name as string)
        .filter((name: string) => name && name.toLowerCase().endsWith(".xml"))
      const preferred =
        xmlCandidates.find((name: string) => name.toLowerCase().includes("primary_doc")) ||
        xmlCandidates.find((name: string) => name.toLowerCase().includes("formd")) ||
        xmlCandidates[0]
      if (preferred) {
        const fallbackUrl = `https://www.sec.gov/Archives/edgar/data/${cikNoZero}/${accessionNoDash}/${preferred}`
        const fallbackResponse = await fetch(fallbackUrl, {
          headers: {
            "User-Agent": "MarketIntelligence/1.0 (research@marketintel.local)",
            "Accept": "application/xml",
          },
          next: { revalidate: 3600 },
        })
        if (fallbackResponse.ok) {
          const fallbackXml = await fallbackResponse.text()
          details = buildDetails(fallbackXml)
        }
      }
    }
  }

  return details
}
 
 async function fetchNewsRss(): Promise<PublicNewsItem[]> {
   const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
     '("distressed debt" OR "loan sale" OR "note sale" OR "real estate debt")'
   )}&hl=en-US&gl=US&ceid=US:en`
 
   const response = await fetch(rssUrl, { next: { revalidate: 1800 } })
   if (!response.ok) return []
   const xml = await response.text()
 
   const items: PublicNewsItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
   let match: RegExpExecArray | null
   let index = 0
   while ((match = itemRegex.exec(xml))) {
     const block = match[1]
     const title = extractTag(block, "title") || "Untitled"
     const link = extractTag(block, "link")
     const pubDate = extractTag(block, "pubDate")
     const source = extractTag(block, "source")
    const description = stripHtml(extractTag(block, "description"))
     items.push({
       id: `news-${index}-${title.slice(0, 24)}`,
       title,
       url: link,
       date: normalizeDate(pubDate),
       source,
      snippet: description,
     })
     index += 1
   }
 
   return items.slice(0, 12)
 }
 
 export async function fetchCompetitorIntel(): Promise<CompetitorIntelResponse> {
   const notes: string[] = []
  const [filings, news] = await Promise.all([fetchSecFormDFilings(), fetchNewsRss()])

  const enriched = await Promise.all(
    filings.slice(0, 12).map(async (filing) => ({
      ...filing,
      ...(await fetchFormDDetails(filing)),
    }))
  )
 
  if (filings.length === 0) {
    notes.push("No Form D filings returned for the current query.")
  }
   if (news.length === 0) {
     notes.push("No public news items returned for the current query.")
   }
 
  return { filings: enriched, news, notes }
 }

export async function fetchFirmDossier(
  firm: string,
  options?: { rangeDays?: number; maxEnriched?: number; aliases?: string[] }
): Promise<FirmDossierResponse> {
  const notes: string[] = []
  const trimmed = (firm || "").trim()
  if (!trimmed)
    return {
      firm: trimmed,
      filings: [],
      notes: ["No firm name provided."],
      totalHits: 0,
      rawInRange: 0,
      matchedInRange: 0,
    }

  const savedAliases = (options?.aliases || [])
    .map((x) => (x || "").trim())
    .filter((x) => x.length > 0)
  const aliasSeeds = generateAliasSeeds(trimmed)
  const aliases = Array.from(new Set([...savedAliases, ...aliasSeeds]))

  const { filings, total } = await fetchSecFormDFilingsForFirm(trimmed, aliases)
  if (filings.length === 0) {
    notes.push("No Form D filings returned for this firm query.")
    return {
      firm: trimmed,
      filings: [],
      notes,
      totalHits: total ?? 0,
      rawInRange: 0,
      matchedInRange: 0,
      aliasesUsed: aliases,
    }
  }

  const rangeDays = options?.rangeDays ?? 730
  const maxEnriched = options?.maxEnriched ?? 50
  const now = Date.now()
  const inRange = filings.filter((filing) => {
    const date = filing.filingDate ? Date.parse(filing.filingDate) : NaN
    if (Number.isNaN(date)) return false
    return now - date <= rangeDays * 24 * 60 * 60 * 1000
  })

  // Enrich a limited number of the most recent filings in-range.
  const sorted = [...inRange].sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""))
  const head = sorted.slice(0, maxEnriched)
  const tail = sorted.slice(maxEnriched)

  const enrichedHead = await Promise.all(
    head.map(async (filing) => ({
      ...filing,
      ...(await fetchFormDDetails(filing)),
    }))
  )

  const combined = [...enrichedHead, ...tail]
  const matched = combined.filter((filing) => isLikelyFirmMatchWithAliases(filing, trimmed, aliases))

  notes.push(
    `EDGAR search hits: ${total ?? filings.length}. In range: ${sorted.length}. Matched: ${matched.length}.`
  )
  if (aliases.length > 0) {
    notes.push(`Aliases used: ${aliases.length}.`)
  }
  if (tail.length > 0) {
    notes.push(
      `Enriched ${enrichedHead.length} of ${sorted.length} filings in range for performance.`
    )
  }

  if (matched.length === 0) {
    notes.push(
      "Note: Many managers file through SPVs/fund issuers that may not include the manager brand in the issuer name. Add aliases (fund/issuer names) for better matching."
    )
  }

  return {
    firm: trimmed,
    filings: matched,
    notes,
    totalHits: total,
    rawInRange: sorted.length,
    matchedInRange: matched.length,
    aliasesUsed: aliases,
  }
}

export async function fetchFirmAliasSuggestions(
  firm: string,
  options?: { maxEnriched?: number }
): Promise<{ firm: string; suggestions: FirmAliasSuggestion[]; notes: string[] }> {
  const notes: string[] = []
  const trimmed = (firm || "").trim()
  if (!trimmed) return { firm: trimmed, suggestions: [], notes: ["No firm name provided."] }

  const { filings, total } = await fetchSecFormDFilingsForAliasDiscovery(trimmed)
  if (filings.length === 0) {
    return {
      firm: trimmed,
      suggestions: [],
      notes: ["No Form D filings returned for alias discovery."],
    }
  }

  const maxEnriched = options?.maxEnriched ?? 40
  const enriched = await Promise.all(
    filings.slice(0, maxEnriched).map(async (f) => ({
      ...f,
      ...(await fetchFormDDetails(f)),
    }))
  )

  const counts = new Map<
    string,
    {
      name: string
      count: number
      sourceFields: Set<"fundName" | "company">
      witness?: { witnessedAs: "fundName" | "company"; filing: PublicFiling }
    }
  >()
  const add = (name: string | undefined, filing: PublicFiling, field: "fundName" | "company") => {
    const raw = (name || "").trim()
    if (!raw || raw === "Unknown") return
    const cleaned = cleanIssuerName(raw)
    if (!cleaned) return
    const key = normalizeName(cleaned)
    if (!key) return
    const prev = counts.get(key)
    if (!prev) {
      const next = {
        name: cleaned,
        count: 1,
        sourceFields: new Set<"fundName" | "company">([field]),
        witness: { witnessedAs: field, filing },
      }
      counts.set(key, next)
    } else {
      prev.count += 1
      prev.sourceFields.add(field)
      // Prefer a witness that has a URL and a filingDate.
      const currentUrl = prev.witness?.filing?.url
      const candidateUrl = filing.url
      if ((!currentUrl && candidateUrl) || (!prev.witness?.filing?.filingDate && filing.filingDate)) {
        prev.witness = { witnessedAs: field, filing }
      }
    }
  }

  enriched.forEach((f) => {
    add(f.fundName, f, "fundName")
    add(f.company, f, "company")
  })

  const suggestions = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((s) => ({
      name: s.name,
      count: s.count,
      sourceFields: Array.from(s.sourceFields.values()),
      witness: s.witness
        ? {
            witnessedAs: s.witness.witnessedAs,
            filingDate: s.witness.filing.filingDate,
            url: s.witness.filing.url,
            cik: s.witness.filing.cik,
            accession: s.witness.filing.accession,
          }
        : undefined,
      exampleFilingDate: s.witness?.filing?.filingDate,
      exampleUrl: s.witness?.filing?.url,
    }))

  notes.push(`Alias discovery hits: ${total ?? filings.length}. Enriched: ${Math.min(maxEnriched, filings.length)}.`)
  return { firm: trimmed, suggestions, notes }
}
