import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const uliSource: ProducerAdapter = {
  producerId: "uli",
  seedUrls: [
    "https://www.uli.org/research/",
    "https://www.uli.org/research/centers-initiatives/center-for-capital-markets/",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
