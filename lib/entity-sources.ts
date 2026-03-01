/**
 * Central registry of approved report publishers (entities) and their allowed domains.
 * Used for Search Industry Reports: entity dropdown and strict domain allowlist filtering.
 */

export type EntityId =
  | "all"
  | "watchlist"
  | "cbre"
  | "jll"
  | "mba"
  | "mhn"
  | "commercialsearch"

export type EntityRecord = {
  id: EntityId
  label: string
  /** Base domains for this entity. Subdomains are allowed (e.g. www.cbre.com, us.cbre.com). */
  domains: string[]
}

/** Allowed domains per entity. Subdomains of each are allowed. */
export const ENTITY_SOURCES: EntityRecord[] = [
  {
    id: "cbre",
    label: "CBRE",
    domains: ["cbre.com", "cbre.us"],
  },
  {
    id: "jll",
    label: "JLL",
    domains: ["jll.com"],
  },
  {
    id: "mba",
    label: "MBA",
    domains: ["mba.org"],
  },
  {
    id: "mhn",
    label: "MHN",
    domains: ["multihousingnews.com"],
  },
  {
    id: "commercialsearch",
    label: "CommercialSearch",
    domains: ["commercialsearch.com"],
  },
]

/** Watchlist = CBRE + JLL (main CRE research firms). */
export const WATCHLIST_ENTITY_IDS: EntityId[] = ["cbre", "jll"]

/** Get domains for entityId. For "all" returns all domains; for "watchlist" returns watchlist domains. */
export function getDomainsForEntity(entityId: EntityId): string[] {
  if (entityId === "all") {
    return ENTITY_SOURCES.flatMap((e) => e.domains)
  }
  if (entityId === "watchlist") {
    return ENTITY_SOURCES.filter((e) => WATCHLIST_ENTITY_IDS.includes(e.id)).flatMap((e) => e.domains)
  }
  const entity = ENTITY_SOURCES.find((e) => e.id === entityId)
  return entity ? entity.domains : []
}

/** Get entity label for display. */
export function getEntityLabel(entityId: EntityId): string {
  if (entityId === "all") return "All (Approved Sources)"
  if (entityId === "watchlist") return "Watchlist (Approved Sources)"
  const entity = ENTITY_SOURCES.find((e) => e.id === entityId)
  return entity ? entity.label : "Unknown"
}

/** Dropdown options for the Search UI. */
export const ENTITY_DROPDOWN_OPTIONS: { value: EntityId; label: string }[] = [
  { value: "all", label: "All (Approved Sources)" },
  { value: "watchlist", label: "Watchlist (Approved Sources)" },
  ...ENTITY_SOURCES.map((e) => ({ value: e.id as EntityId, label: e.label })),
]
