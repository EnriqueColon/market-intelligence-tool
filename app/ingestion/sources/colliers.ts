import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const colliersSource: ProducerAdapter = {
  producerId: "colliers",
  seedUrls: [
    "https://www.colliers.com/en/research",
    "https://www.colliers.com/en/insights",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
