import type { EntityId } from "@/lib/entity-sources"

export type ExtractedReport = {
  title: string
  landingUrl: string
  publishedDate?: string
}

export type ProducerAdapter = {
  producerId: Exclude<EntityId, "all">
  seedUrls: string[]
  extractReports: (html: string, baseUrl: string) => ExtractedReport[]
}
