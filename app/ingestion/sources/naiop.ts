import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const naiopSource: ProducerAdapter = {
  producerId: "naiop",
  seedUrls: [
    "https://www.naiop.org/research-and-publications/",
    "https://www.naiop.org/research-and-publications/research-reports/",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
