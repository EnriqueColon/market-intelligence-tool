import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const federalReserveSource: ProducerAdapter = {
  producerId: "federalreserve",
  seedUrls: [
    "https://www.federalreserve.gov/publications.htm",
    "https://www.federalreserve.gov/econres.htm",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
