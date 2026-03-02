import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const jllSource: ProducerAdapter = {
  producerId: "jll",
  seedUrls: [
    "https://www.jll.com/en-us/insights",
    "https://www.jll.com/en-us/research",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
