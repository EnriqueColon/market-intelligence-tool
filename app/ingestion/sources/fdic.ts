import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const fdicSource: ProducerAdapter = {
  producerId: "fdic",
  seedUrls: [
    "https://www.fdic.gov/analysis/quarterly-banking-profile/",
    "https://www.fdic.gov/resources/publications/",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
