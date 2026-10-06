import "server-only"
import { fetchFDICData } from "@/lib/fdic-client"
import { FDIC_ENDPOINTS } from "@/lib/fdic-config"
import {
  FAILURE_FIELDS,
  HISTORY_FIELDS,
  toFailureRecord,
  toStructureEvent,
  toStructureEventFromStatus,
  type FailureRecord,
  type RawFailureRow,
  type RawHistoryRow,
  type RawInstitutionStatusRow,
  type StructureEvent,
} from "@/lib/fdic-structure-events"

const STATUS_FIELDS = ["CERT", "NAME", "ACTIVE", "ENDEFYMD", "CHANGEC1"] as const

/**
 * Fetchers for the FDIC structure records. Shaping lives in
 * `lib/fdic-structure-events.ts`; this file only knows how to ask.
 *
 * Both endpoints accept a parenthesised OR list, so a scope's exits are
 * resolved in a few requests rather than one per bank. Batches are kept
 * modest: the FDIC gateway rejects very long query strings, and forty CERTs
 * is comfortably inside what it accepts.
 */

const BATCH = 40
/** Change codes in which an institution ceases to exist: failures and mergers. */
const EXIT_CODES = "[200 TO 299]"

export type ExitRecord = { event: StructureEvent | null; failure: FailureRecord | null }

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Why each of these banks stopped filing, keyed by CERT. A CERT with no
 * record maps to `{ event: null, failure: null }`, which the UI reads as
 * "stopped filing, nothing recorded yet".
 */
export async function fetchExitRecords(certs: string[]): Promise<Map<string, ExitRecord>> {
  const result = new Map<string, ExitRecord>()
  const unique = Array.from(new Set(certs.filter(Boolean)))
  for (const cert of unique) result.set(cert, { event: null, failure: null })
  if (unique.length === 0) return result

  await Promise.all(
    chunk(unique, BATCH).map(async (batch) => {
      const [history, failures] = await Promise.all([
        fetchFDICData<RawHistoryRow>(FDIC_ENDPOINTS.history, {
          filters: { OUT_CERT: batch, CHANGECODE: EXIT_CODES },
          fields: HISTORY_FIELDS,
          limit: batch.length * 3,
          sort_by: "EFFDATE",
          sort_order: "DESC",
        }),
        fetchFDICData<RawFailureRow>(FDIC_ENDPOINTS.failures, {
          filters: { CERT: batch },
          fields: FAILURE_FIELDS,
          limit: batch.length,
          sort_by: "FAILDATE",
          sort_order: "DESC",
        }),
      ])

      for (const row of history.data ?? []) {
        const event = toStructureEvent(row, String(row.OUT_CERT ?? ""))
        if (!event) continue
        const entry = result.get(event.cert)
        // Newest first from the API, so the first event seen for a CERT is kept.
        if (entry && !entry.event) entry.event = event
      }
      for (const row of failures.data ?? []) {
        const failure = toFailureRecord(row)
        if (!failure) continue
        const entry = result.get(failure.cert)
        if (entry && !entry.failure) entry.failure = failure
      }
    })
  )

  // `/history` can lag an event by weeks — two Florida banks that closed on
  // 30 September had no history row a week later — while `/institutions`
  // already showed them inactive with the code and date. Fill the gaps from
  // there so a bank that has demonstrably gone is not reported as "late".
  const unresolved = unique.filter((cert) => {
    const entry = result.get(cert)
    return entry && !entry.event && !entry.failure
  })
  await Promise.all(
    chunk(unresolved, BATCH).map(async (batch) => {
      const status = await fetchFDICData<RawInstitutionStatusRow>(FDIC_ENDPOINTS.institutions, {
        filters: { CERT: batch },
        fields: STATUS_FIELDS,
        limit: batch.length,
        sort_by: "CERT",
        sort_order: "ASC",
      })
      for (const row of status.data ?? []) {
        const event = toStructureEventFromStatus(row)
        if (!event) continue
        const entry = result.get(event.cert)
        if (entry && !entry.event) entry.event = event
      }
    })
  )

  return result
}

/**
 * Institutions this bank has absorbed, newest first. Found by `ACQ_CERT`,
 * since the event is filed under the acquirer.
 */
export async function fetchAcquisitionsBy(cert: string, limit = 12): Promise<StructureEvent[]> {
  if (!cert) return []
  const response = await fetchFDICData<RawHistoryRow>(FDIC_ENDPOINTS.history, {
    filters: { ACQ_CERT: cert, CHANGECODE: EXIT_CODES },
    fields: HISTORY_FIELDS,
    limit,
    sort_by: "EFFDATE",
    sort_order: "DESC",
  })
  return (response.data ?? [])
    .map((row) => toStructureEvent(row, cert))
    .filter((e): e is StructureEvent => e != null && e.kind === "acquisition")
}
