import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const cbreSource: ProducerAdapter = {
  producerId: "cbre",
  // Legacy fallback seed URLs; run-ingestion.ts now uses CBRE Coveo API directly.
  seedUrls: [
    "https://www.cbre.com/insights/reports",
    "https://www.cbre.com/insights/books",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
