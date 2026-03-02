import { genericExtractReports } from "@/app/ingestion/sources/shared"
import type { ProducerAdapter } from "@/app/ingestion/sources/types"

export const cushmanWakefieldSource: ProducerAdapter = {
  producerId: "cushmanwakefield",
  seedUrls: [
    "https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats",
    "https://www.cushmanwakefield.com/en/insights",
  ],
  extractReports: (html, baseUrl) => genericExtractReports(html, baseUrl),
}
