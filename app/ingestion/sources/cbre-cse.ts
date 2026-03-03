import { fetchWithTimeout } from "@/lib/http"

export type CseItem = {
  title: string
  landingUrl: string
  publishedDate?: string
}

export async function fetchCbreViaCse(params: {
  query: string
  num: number
}): Promise<CseItem[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim()
  const cx = process.env.GOOGLE_CSE_ID?.trim()
  if (!apiKey || !cx) {
    throw new Error("Missing GOOGLE_CSE_API_KEY/GOOGLE_CSE_ID")
  }

  const q = new URLSearchParams({
    key: apiKey,
    cx,
    q: params.query,
    num: String(params.num),
  })

  const res = await fetchWithTimeout(
    `https://www.googleapis.com/customsearch/v1?${q.toString()}`,
    {
      cache: "no-store",
      timeoutMs: 8000,
    }
  )

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "")
    throw new Error(`Google CSE ${res.status}: ${bodyText.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    items?: Array<{
      title?: string
      link?: string
      pagemap?: {
        metatags?: Array<Record<string, string>>
      }
    }>
  }

  const items = (data.items || [])
    .map((item) => {
      const title = (item.title || "").trim()
      const landingUrl = (item.link || "").trim()
      const publishedDate =
        item.pagemap?.metatags?.[0]?.["article:published_time"] || undefined
      return { title, landingUrl, publishedDate }
    })
    .filter((item) => item.title && item.landingUrl.startsWith("http"))

  return Array.from(new Map(items.map((item) => [item.landingUrl, item])).values())
}
