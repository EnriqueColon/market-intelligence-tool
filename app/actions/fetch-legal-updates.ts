"use server"

export type LegalUpdate = {
  id: string
  billNumber?: string
  title: string
  summary?: string
  source: string
  jurisdiction: "Federal" | "Florida"
  category: "Bill" | "Rule"
  status?: string
  date?: string
  url?: string
}

export type LegalUpdatesResponse = {
  updates: LegalUpdate[]
  sources: {
    federalRegister: boolean
    legiscan: boolean
  }
  notes: string[]
}

const DEFAULT_TERMS = [
  "commercial real estate",
  "real estate",
  "commercial property",
  "commercial mortgage",
  "mortgage",
  "lending",
  "loan",
  "foreclosure",
  "distressed debt",
  "debt",
  "CMBS",
  "office",
  "retail",
  "industrial",
  "multifamily",
  "apartment",
  "landlord",
  "tenant",
  "lease",
  "property tax",
]

const SEARCH_QUERY = DEFAULT_TERMS.map((term) => `"${term}"`).join(" OR ")
const FLORIDA_FALLBACK_QUERY = `"real estate" OR "commercial" OR "mortgage" OR "loan"`

const LEGISCAN_API_KEY = process.env.LEGISCAN_API_KEY

function normalizeDate(date?: string) {
  if (!date) return undefined
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toISOString().slice(0, 10)
}

function getLatestAction(history?: Array<{ date?: string; action?: string }>) {
  if (!Array.isArray(history)) return undefined
  let latest: { date?: string; action?: string; time: number } | undefined

  for (const entry of history) {
    if (!entry?.date) continue
    const time = Date.parse(entry.date)
    if (Number.isNaN(time)) continue
    if (!latest || time > latest.time) {
      latest = { date: entry.date, action: entry.action, time }
    }
  }

  if (!latest) return undefined
  return { date: latest.date, action: latest.action }
}

async function fetchLegiScanBillDetail(
  billId: string | number
): Promise<Partial<LegalUpdate>> {
  if (!LEGISCAN_API_KEY) return {}

  const params = new URLSearchParams({
    key: LEGISCAN_API_KEY,
    op: "getBill",
    id: String(billId),
  })

  const url = `https://api.legiscan.com/?${params.toString()}`
  const response = await fetch(url, { next: { revalidate: 3600 } })
  if (!response.ok) return {}

  const data = await response.json()
  if (data?.status !== "OK") return {}

  const bill = data?.bill
  if (!bill) return {}

  const latestAction = getLatestAction(bill.history)

  return {
    title: bill.title || undefined,
    summary: bill.description || undefined,
    billNumber: bill.bill_number || undefined,
    url: bill.url || undefined,
    status: latestAction?.action || undefined,
    date: normalizeDate(latestAction?.date || bill.status_date),
  }
}

async function fetchFederalRegisterUpdates(query: string): Promise<LegalUpdate[]> {
  const params = new URLSearchParams({
    per_page: "10",
    order: "newest",
    "conditions[term]": query,
  })

  const fields = [
    "title",
    "abstract",
    "publication_date",
    "document_number",
    "html_url",
    "type",
    "agencies",
  ]

  fields.forEach((field) => params.append("fields[]", field))

  const url = `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`
  const response = await fetch(url, { next: { revalidate: 3600 } })
  if (!response.ok) return []

  const data = await response.json()
  const results = Array.isArray(data?.results) ? data.results : []

  return results.map((item: any) => ({
    id: `fr-${item.document_number || item.html_url}`,
    title: item.title || "Untitled Federal Register Item",
    summary: item.abstract || undefined,
    source: "Federal Register",
    jurisdiction: "Federal",
    category: "Rule",
    status: item.type || "Rule",
    date: normalizeDate(item.publication_date),
    url: item.html_url || undefined,
  }))
}

async function fetchFloridaUpdates(
  query: string,
  year: string = "2"
): Promise<{ updates: LegalUpdate[]; note?: string }> {
  if (!LEGISCAN_API_KEY) return []

  const params = new URLSearchParams({
    key: LEGISCAN_API_KEY,
    op: "getSearch",
    state: "FL",
    query,
    year,
    page: "1",
  })

  const url = `https://api.legiscan.com/?${params.toString()}`
  const response = await fetch(url, { next: { revalidate: 3600 } })
  if (!response.ok) {
    return { updates: [], note: `LegiScan request failed (${response.status}).` }
  }

  const data = await response.json()
  if (data?.status !== "OK") {
    const message = data?.alert?.message || "LegiScan returned status ERROR."
    return { updates: [], note: message }
  }

  const searchResult = data.searchresult || {}
  const entries = Array.isArray(searchResult.results)
    ? searchResult.results
    : Object.entries(searchResult)
        .filter(([key]) => key !== "summary")
        .map(([, value]) => value)

  const sortedEntries = [...entries].sort((a: any, b: any) => {
    const aTime = a?.last_action_date ? Date.parse(a.last_action_date) : 0
    const bTime = b?.last_action_date ? Date.parse(b.last_action_date) : 0
    return bTime - aTime
  })

  const limitedEntries = sortedEntries.slice(0, 10)
  const billIds = limitedEntries
    .map((item: any) => item.bill_id)
    .filter((id: any) => id !== undefined && id !== null)

  const detailPairs = await Promise.all(
    billIds.slice(0, 10).map(async (id: number | string) => {
      const detail = await fetchLegiScanBillDetail(id)
      return [String(id), detail] as const
    })
  )

  const detailMap = new Map(detailPairs)

  const updates = limitedEntries.map((item: any) => {
    const detail = detailMap.get(String(item.bill_id)) || {}
    return {
      id: `fl-${item.bill_id || item.bill_number}`,
      billNumber: detail.billNumber || item.bill_number || undefined,
      title: detail.title || item.title || "Untitled Florida Bill",
      summary: detail.summary || item.description || undefined,
      source: "LegiScan",
      jurisdiction: "Florida",
      category: "Bill",
      status: detail.status || item.last_action || undefined,
      date: detail.date || normalizeDate(item.last_action_date),
      url: detail.url || item.url || undefined,
    }
  })

  const total = searchResult?.summary?.count
  const note =
    updates.length === 0
      ? `LegiScan returned 0 results for FL query (year=${year}).`
      : undefined

  return { updates, note: total ? `${note || ""} Total matches: ${total}.`.trim() : note }
}

async function fetchFloridaUpdatesWithFallback(): Promise<{ updates: LegalUpdate[]; notes: string[] }> {
  const notes: string[] = []
  const primary = await fetchFloridaUpdates(SEARCH_QUERY, "1")
  if (primary.note) notes.push(primary.note)
  if (primary.updates.length > 0) return { updates: primary.updates, notes }

  const fallback = await fetchFloridaUpdates(FLORIDA_FALLBACK_QUERY, "1")
  if (fallback.note) notes.push(fallback.note)
  return { updates: fallback.updates, notes }
}

export async function fetchLegalUpdates(): Promise<LegalUpdatesResponse> {
  const notes: string[] = []
  const sources = {
    federalRegister: true,
    legiscan: Boolean(LEGISCAN_API_KEY),
  }

  if (!LEGISCAN_API_KEY) {
    notes.push("Set LEGISCAN_API_KEY to enable Florida bill updates from LegiScan.")
  }

  const [federalRegister, florida] = await Promise.all([
    fetchFederalRegisterUpdates(SEARCH_QUERY),
    fetchFloridaUpdatesWithFallback(),
  ])

  if (florida.notes.length > 0) {
    notes.push(...florida.notes)
  }

  const updates = [...federalRegister, ...florida.updates]
    .filter((item) => item.title)
    .sort((a, b) => {
      const aTime = a.date ? new Date(a.date).getTime() : 0
      const bTime = b.date ? new Date(b.date).getTime() : 0
      return bTime - aTime
    })

  return { updates, sources, notes }
}
