/**
 * Which filing represents an institution in the report cohort.
 *
 * The charts, the ZIP/PDF exports and the analyst narrative all start from
 * `buildExportData`, which groups the FDIC rows by institution and keeps one
 * filing each. Two things used to go wrong there.
 *
 * It picked "latest" by sorting on `Date.parse(reportDate)`, but FDIC report
 * dates arrive as `YYYYMMDD`, which `Date.parse` cannot read, so the comparator
 * returned NaN and the sort left the API's order untouched. The API sorts by
 * assets, so a shrinking bank was represented by whichever quarter its balance
 * sheet was largest, not the newest one.
 *
 * It also kept an institution's last filing even when that filing predated the
 * quarter everything else on the page was reporting. A bank that failed or was
 * absorbed between quarters stayed in the cohort on its final — usually worst —
 * figures, and because the capital base of a failing bank is close to zero it
 * led the CRE-to-capital charts long after it had ceased to exist. The
 * screening table already refused that (see `screening.ts`); the report path
 * did not, so the two halves of the tab disagreed about who was in the cohort.
 *
 * `pickHeadlineFiling` applies the table's rule: an institution is in the
 * cohort only if it filed for the headline quarter, and it is represented by
 * that filing. Anything else — failed, merged, deregistered, or simply late —
 * is held out rather than shown as current.
 */

type Dated = { reportDate?: string }

/**
 * `YYYYMMDD` for an FDIC report date in either of the shapes that reach us
 * (`20260630` from the API, `2026-06-30` from demo data). Mirrors
 * `normalizeReportDate` in `screening.ts`; duplicated so this module stays
 * import-free and runnable under node's test runner.
 */
export function normalizeReportDate(dateStr: string | undefined): string {
  if (!dateStr) return ""
  if (/^\d{8}$/.test(dateStr)) return dateStr
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[1] + m[2] + m[3]
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  return `${y}${mo}${da}`
}

/** Newest report date in the set, as `YYYYMMDD`; empty string when none. */
export function headlineQuarter(items: readonly Dated[]): string {
  let newest = ""
  for (const item of items) {
    const norm = normalizeReportDate(item.reportDate)
    if (norm && norm > newest) newest = norm
  }
  return newest
}

/**
 * The institution's filing for the headline quarter, or `null` if it did not
 * file for that quarter and therefore does not belong in the cohort.
 */
export function pickHeadlineFiling<T extends Dated>(items: readonly T[], headline: string): T | null {
  if (!headline) return null
  for (const item of items) {
    if (normalizeReportDate(item.reportDate) === headline) return item
  }
  return null
}
