/**
 * Report-date arithmetic for FDIC quarters.
 *
 * Lives here rather than beside its caller because `app/actions/executive-brief.ts`
 * is a `"use server"` module, and Next.js permits only async exports from those —
 * a synchronous helper exported from there fails the build, and an unexported one
 * cannot be tested. Both of these are pure and worth testing directly.
 */

/**
 * Report dates arrive as either `20251231` or `2025-12-31` depending on the
 * path, and quarters are compared as strings, so they have to agree on a form
 * before any comparison means anything.
 */
export function normalizeQuarter(dateStr: string | undefined | null): string {
  if (!dateStr) return ""
  if (/^\d{8}$/.test(dateStr)) return dateStr
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? m[1] + m[2] + m[3] : dateStr
}

/**
 * Whole quarters from `earlier` to `later`, both `YYYYMMDD`.
 *
 * Counts calendar quarters rather than differencing days, because call reports
 * land on quarter ends of unequal length and a day-based difference rounds
 * 20250630 → 20250930 to the wrong number of quarters.
 *
 * Returns 0 for anything unparseable, so a malformed date reads as "not stale"
 * rather than as a fabricated multi-year gap.
 */
export function quartersBetween(earlier: string, later: string): number {
  if (!/^\d{8}$/.test(earlier) || !/^\d{8}$/.test(later)) return 0
  const index = (q: string) => Number(q.slice(0, 4)) * 4 + Math.ceil(Number(q.slice(4, 6)) / 3)
  return index(later) - index(earlier)
}

/** `20251231` → `Q4 2025`. Anything else is passed through untouched. */
export function formatQuarter(repdte: string): string {
  if (!/^\d{8}$/.test(repdte)) return repdte
  const year = repdte.slice(0, 4)
  const quarter = Math.ceil(Number(repdte.slice(4, 6)) / 3)
  return `Q${quarter} ${year}`
}
