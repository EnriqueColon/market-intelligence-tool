/** Collapses repeated legal developments before they reach the Legal Landscape tab. */

export type DedupableLegalItem = { title: string }

export function normalizeTitleForKey(title: string) {
  return (title || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * One development can reach us several times over — a joint rule restated once per issuing
 * agency, or the same action surfacing in two sections. Titles are official and verbatim, so
 * they identify the development far better than the URL, which differs per agency mirror.
 * First occurrence wins, which keeps the model's own ordering.
 */
export function dedupeByTitle<T extends DedupableLegalItem>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = normalizeTitleForKey(item.title)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
