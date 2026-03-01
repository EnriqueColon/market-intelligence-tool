/**
 * Hostname matching for strict domain allowlist filtering.
 * Allows exact match or subdomain of each listed domain.
 */

import { getDomainsForEntity, type EntityId } from "./entity-sources.ts"

/**
 * Extract hostname from URL (no port, lowercase).
 * Returns empty string if URL is invalid.
 */
export function extractHostname(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.toLowerCase()
  } catch {
    return ""
  }
}

/**
 * Check if hostname is allowed: exact match or subdomain of any allowed domain.
 * Subdomain: hostname.endsWith("." + domain) e.g. www.cbre.com for domain cbre.com
 */
export function isHostnameAllowed(hostname: string, allowedDomains: string[]): boolean {
  const h = hostname.toLowerCase().trim()
  if (!h) return false

  for (const domain of allowedDomains) {
    const d = domain.toLowerCase().trim()
    if (!d) continue
    if (h === d) return true
    if (h.endsWith("." + d)) return true
  }
  return false
}

/**
 * Filter results to only those whose URL hostname is in the allowlist for the given entity.
 */
export function filterByAllowlist<T extends { url: string }>(
  items: T[],
  entityId: EntityId
): T[] {
  const domains = getDomainsForEntity(entityId)
  return items.filter((item) => {
    const hostname = extractHostname(item.url)
    return isHostnameAllowed(hostname, domains)
  })
}
