/**
 * Builds Google Custom Search query strings with site: restrictions.
 */

import { getDomainsForEntity, type EntityId } from "./entity-sources"

/**
 * Build query string for Google Custom Search API.
 * - Single entity: site:domain1 OR site:domain2 ... keyword
 * - Adds "report" synonyms to improve relevance for industry reports
 */
export function buildSearchQuery(
  entityId: EntityId,
  keyword: string,
  preferPdf: boolean
): string {
  const domains = getDomainsForEntity(entityId)
  if (domains.length === 0) {
    return keyword.trim()
  }

  const siteClause =
    domains.length === 1
      ? `site:${domains[0]}`
      : `(${domains.map((d) => `site:${d}`).join(" OR ")})`

  const reportTerms = "report OR outlook OR survey OR rankings"
  const combined = [keyword.trim(), reportTerms].filter(Boolean).join(" ")

  let query = `${siteClause} ${combined}`.trim()

  if (preferPdf) {
    query += " filetype:pdf"
  }

  return query
}
