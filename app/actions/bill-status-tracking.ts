"use server"

/**
 * The one piece of the Legal Landscape that outlives a day.
 *
 * Everything else in the feed is a cache keyed to the calendar day: regenerated each morning,
 * never stored, so yesterday's state does not exist. That is why the Legislative Tracker could
 * report a bill's stage and never report that it had moved, which is the part a reader cannot get
 * by reading the bill themselves.
 *
 * This table is the minimum needed to answer "what changed": one row per bill, holding the status
 * we last saw and the one before it. Not a full action history — govtrack already publishes that,
 * and a second copy of a public record would be a synchronisation problem in exchange for nothing.
 *
 * The comparison itself is in `lib/legal-updates-movement.ts` so it can be tested without a
 * database. This file is only the storage.
 *
 * **No `assertSafeToMutateProductionData` here, deliberately.** `lib/environment.ts` reserves that
 * guard for irreversible writes and says so: an upsert into a tracking table is recoverable, and
 * the worst case is a preview deployment recording a status a day early. Compare
 * `DELETE FROM research_reports`, which is what the guard exists for.
 */

import { isDbEnabled, sql } from "@/lib/db"
import {
  diffStatus,
  type BillMovement,
  type StoredBillStatus,
} from "@/lib/legal-updates-movement"

export type TrackedBill = {
  /** From `billKeyFor`. Stable across rewordings of the same bill. */
  key: string
  title: string
  status: string
  /** `YYYY-MM-DD`. */
  statusDate: string
}

let tableReady = false

/**
 * Created on first use, matching `institution_watchlist` and `research_feed_cache`, so bringing an
 * environment up needs no migration step.
 */
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS bill_status_history (
      bill_key             TEXT PRIMARY KEY,
      title                TEXT,
      status               TEXT NOT NULL,
      status_date          TEXT NOT NULL,
      previous_status      TEXT,
      previous_status_date TEXT,
      changed_at           TIMESTAMPTZ,
      first_seen           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  tableReady = true
}

/**
 * Records what the record currently says and returns the transitions worth showing.
 *
 * Returns an empty map when there is no database, which is the normal case on the dev preview —
 * the section then behaves exactly as it did before, showing each bill's stage without saying
 * whether it moved. Silence is the right degradation: inventing "no movement" would be a claim.
 *
 * Dates are stored as `TEXT` rather than `DATE` because the record supplies `YYYY-MM-DD` strings
 * and every comparison in the feed is a string comparison. Round-tripping them through a date type
 * introduces a timezone at the one point where none of this has a timezone.
 */
export async function trackBillStatuses(bills: TrackedBill[]): Promise<Map<string, BillMovement>> {
  const movements = new Map<string, BillMovement>()
  if (!isDbEnabled() || bills.length === 0) return movements

  try {
    await ensureTable()

    // `sql.query` rather than the template tag, because the tag types its values as primitives
    // and this needs to pass an array to `ANY`. One round trip for the whole set either way.
    const { rows } = await sql.query<{
      bill_key: string
      status: string
      status_date: string
      previous_status: string | null
      previous_status_date: string | null
    }>(
      `SELECT bill_key, status, status_date, previous_status, previous_status_date
       FROM bill_status_history
       WHERE bill_key = ANY($1)`,
      [bills.map((b) => b.key)]
    )

    const stored = new Map<string, StoredBillStatus>(
      rows.map((r) => [
        r.bill_key,
        {
          status: r.status,
          statusDate: r.status_date,
          previousStatus: r.previous_status,
          previousStatusDate: r.previous_status_date,
        },
      ])
    )

    for (const bill of bills) {
      const { movement, next } = diffStatus(stored.get(bill.key), {
        status: bill.status,
        statusDate: bill.statusDate,
      })
      if (movement) movements.set(bill.key, movement)

      // `changed_at` only advances on a real transition, so it records when the bill moved rather
      // than when the feed last ran.
      await sql`
        INSERT INTO bill_status_history (
          bill_key, title, status, status_date, previous_status, previous_status_date, changed_at
        )
        VALUES (
          ${bill.key}, ${bill.title}, ${next.status}, ${next.statusDate},
          ${next.previousStatus}, ${next.previousStatusDate},
          ${movement ? new Date().toISOString() : null}
        )
        ON CONFLICT (bill_key) DO UPDATE SET
          title                = EXCLUDED.title,
          status               = EXCLUDED.status,
          status_date          = EXCLUDED.status_date,
          previous_status      = EXCLUDED.previous_status,
          previous_status_date = EXCLUDED.previous_status_date,
          changed_at           = COALESCE(EXCLUDED.changed_at, bill_status_history.changed_at),
          last_seen            = NOW()
      `
    }
  } catch {
    // A tracking table being unreachable must not take the feed with it. The section then reads
    // as it did before this existed, which is worse but not broken.
    return movements
  }

  return movements
}
