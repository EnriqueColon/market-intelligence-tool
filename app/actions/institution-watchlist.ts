"use server"

/**
 * Institutions the team is tracking, keyed on FDIC CERT.
 *
 * One shared list. The tool has a single shared password and no user accounts, so there is
 * exactly one team, and a list scoped to anything narrower than that was modelling a
 * distinction that does not exist here.
 *
 * This replaced `department_watchlist`, which keyed the same rows by a department read from a
 * cookie. That bought nothing: the cookie was a preference rather than an identity, so anyone
 * could change which list they were writing to from the browser console, and nothing in the
 * interface ever wrote to the table at all. It also forced the department into the cache key of
 * anything that read it, which `docs/NEXT_VERSION_PLAN.md` warns against directly. Rows from the
 * old table are carried over on first use and the old table is left in place — see `ensureTable`.
 *
 * Distinct from `data/watchlist.json`, which is curated reference data: 45 named distressed-credit
 * firms with aliases, used to match news and counterparties. That is versioned and belongs in the
 * repository. This is team state and belongs in Postgres.
 *
 * Every function reports whether persistence was actually available. An earlier filesystem-backed
 * watchlist wrote to `data/watchlist.json`, which is read-only on Vercel, so it worked locally and
 * silently did nothing in production. Returning `ok: false` rather than an empty success is what
 * lets the interface say so instead of appearing to work and losing the write.
 */

import { sql, isDbEnabled } from "@/lib/db"

export type WatchlistEntry = {
  cert: string
  institutionName: string | null
  note: string | null
  addedAt: string
}

export type WatchlistResult =
  | { ok: true; entries: WatchlistEntry[] }
  | { ok: false; reason: "no-database" | "invalid-cert"; entries: [] }

const UNAVAILABLE = (reason: "no-database" | "invalid-cert"): WatchlistResult => ({
  ok: false,
  reason,
  entries: [],
})

let tableReady = false

/**
 * Created on first use, matching `research_feed_cache`, so no separate migration step is needed
 * to bring an environment up.
 *
 * The carry-over from `department_watchlist` collapses that table's composite key by taking the
 * earliest entry per CERT, since the same institution tracked by two departments is one
 * institution to a shared list. `ON CONFLICT DO NOTHING` makes it safe to run every time.
 *
 * The old table is deliberately **not** dropped. Nothing in the interface ever wrote to it, so it
 * is expected to be empty and this is almost certainly a no-op — but "almost certainly" is not a
 * reason to run an irreversible statement against production data on a cache-warming request.
 * Drop it by hand once you have looked.
 */
async function ensureTable(): Promise<void> {
  if (tableReady) return

  await sql`
    CREATE TABLE IF NOT EXISTS institution_watchlist (
      cert             TEXT PRIMARY KEY,
      institution_name TEXT,
      note             TEXT,
      added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  try {
    await sql`
      INSERT INTO institution_watchlist (cert, institution_name, note, added_at)
      SELECT cert,
             (ARRAY_AGG(institution_name ORDER BY added_at))[1],
             (ARRAY_AGG(note ORDER BY added_at))[1],
             MIN(added_at)
      FROM department_watchlist
      GROUP BY cert
      ON CONFLICT (cert) DO NOTHING
    `
  } catch {
    // The old table not existing is the normal case on any environment brought up after this
    // change, and is not a failure.
  }

  tableReady = true
}

export async function getWatchlist(): Promise<WatchlistResult> {
  if (!isDbEnabled()) return UNAVAILABLE("no-database")

  try {
    await ensureTable()
    const { rows } = await sql<{
      cert: string
      institution_name: string | null
      note: string | null
      added_at: string
    }>`
      SELECT cert, institution_name, note, added_at
      FROM institution_watchlist
      ORDER BY added_at DESC
    `
    return {
      ok: true,
      entries: rows.map((r) => ({
        cert: r.cert,
        institutionName: r.institution_name,
        note: r.note,
        addedAt: new Date(r.added_at).toISOString(),
      })),
    }
  } catch (err) {
    console.error("[institution-watchlist] read failed:", err)
    return UNAVAILABLE("no-database")
  }
}

export async function addToWatchlist(
  cert: string,
  institutionName?: string,
  note?: string
): Promise<WatchlistResult> {
  const id = String(cert ?? "").trim()
  if (!id) return UNAVAILABLE("invalid-cert")
  if (!isDbEnabled()) return UNAVAILABLE("no-database")

  try {
    await ensureTable()
    // Re-adding refreshes the name and note rather than erroring, so the caller does not have to
    // check membership first.
    await sql`
      INSERT INTO institution_watchlist (cert, institution_name, note)
      VALUES (${id}, ${institutionName ?? null}, ${note ?? null})
      ON CONFLICT (cert) DO UPDATE
        SET institution_name = COALESCE(EXCLUDED.institution_name, institution_watchlist.institution_name),
            note             = COALESCE(EXCLUDED.note, institution_watchlist.note)
    `
    return getWatchlist()
  } catch (err) {
    console.error("[institution-watchlist] add failed:", err)
    return UNAVAILABLE("no-database")
  }
}

export async function removeFromWatchlist(cert: string): Promise<WatchlistResult> {
  const id = String(cert ?? "").trim()
  if (!id) return UNAVAILABLE("invalid-cert")
  if (!isDbEnabled()) return UNAVAILABLE("no-database")

  try {
    await ensureTable()
    await sql`DELETE FROM institution_watchlist WHERE cert = ${id}`
    return getWatchlist()
  } catch (err) {
    console.error("[institution-watchlist] remove failed:", err)
    return UNAVAILABLE("no-database")
  }
}
