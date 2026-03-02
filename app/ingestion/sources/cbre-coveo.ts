import { FETCH_HEADERS } from "@/lib/report-scraper"
import { fetchWithTimeout } from "@/lib/http"

export type CbreCoveoItem = {
  title: string
  landingUrl: string
  publishedDate?: string
}

const DEFAULT_CBRE_COVEO_SEARCH_URL =
  "https://www.cbre.com/coveo/rest/search/v2?sitecoreItemUri=sitecore%3A%2F%2Fweb%2F%7BABD9123C-DF74-4C25-BB99-5A31D47C082F%7D%3Flang%3Den%26amp%3Bver%3D3&siteName=GlobalLIVEWeb"

export async function fetchCbreCoveoResults(params: {
  query: string
  numberOfResults: number
  firstResult: number
}): Promise<CbreCoveoItem[]> {
  const url = process.env.CBRE_COVEO_SEARCH_URL?.trim() || DEFAULT_CBRE_COVEO_SEARCH_URL
  const form = new URLSearchParams({
    q: params.query,
    aq: "",
    cq: "",
    searchHub: "search-insights-results",
    locale: "en",
    pipeline: "Default - None",
    firstResult: String(params.firstResult),
    numberOfResults: String(params.numberOfResults),
    sortCriteria: "relevancy",
    excerptLength: "200",
  })

  const res = await fetchWithTimeout(url, {
    method: "POST",
    cache: "no-store",
    timeoutMs: 8000,
    headers: {
      ...FETCH_HEADERS,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: form.toString(),
  })

  if (!res.ok) {
    throw new Error(`CBRE Coveo request failed: ${res.status}`)
  }

  const data = (await res.json()) as {
    results?: Array<{
      title?: string
      printableUri?: string
      clickUri?: string
      raw?: {
        title?: string
        printableuri?: string
        publishdate?: string
        date?: string
      }
    }>
  }

  const items = (data.results || [])
    .map((result) => {
      const title = (result.title || result.raw?.title || "").trim()
      const landingUrl = (
        result.raw?.printableuri ||
        result.printableUri ||
        result.clickUri ||
        ""
      ).trim()
      const publishedDate = (result.raw?.publishdate || result.raw?.date || "").trim() || undefined
      return { title, landingUrl, publishedDate }
    })
    .filter((item) => item.title && item.landingUrl && item.landingUrl.startsWith("http"))

  return Array.from(new Map(items.map((item) => [item.landingUrl, item])).values())
}
