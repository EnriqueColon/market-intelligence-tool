"use server"

/**
 * Institutions a department is tracking.
 *
 * Distinct from `data/watchlist.json`, which is curated reference data — 45
 * named distressed-credit firms with aliases, used to match news and
 * counterparties. That is a versioned file and belongs in the repository. This
 * is user state: FDIC institutions, keyed by CERT, that a department has chosen
 * to follow, and it belongs in Postgres.
 *
 * Keyed by department rather than by person because the tool has no user
 * identity, only a shared password. Entries are therefore visible to and
 * editable by everyone in the department, which is intended.
 *
 * Every function reports whether persistence was actually available. The
 * previous filesystem-backed watchlist wrote to `data/watchlist.json`, which is
 * read-only on Vercel, so it worked locally and silently did nothing in
 * production. Returning `ok: false` instead of an empty success is what lets the
 * interface say so rather than appear to work and lose the write.
 */

import { sql, isDbEnabled } from "@/lib/db"
import { parseDepartment, type Department } from "@/lib/department"

export type WatchlistEntry = {
  cert: string
  institutionName: string | null
  note: string | null
  addedAt: string
}

export type WatchlistResult =
  | { ok: true; entries: WatchlistEntry[] }
  | { ok: false; reason: "no-database" | "invalid-department"; entries: [] }

const UNAVAILABLE = (reason: "no-database" | "invalid-department"): WatchlistResult => ({
  ok: false,
  reason,
  entries: [],
})

let tableReady = false

/**
 * Created on first use, matching `research_feed_cache`, so no separate
 * migration step is needed to bring an environment up.
 */
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS department_watchlist (
      department       TEXT NOT NULL,
      cert             TEXT NOT NULL,
      institution_name TEXT,
      note             TEXT,
      added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (department, cert)
    )
  `
  tableReady = true
}

export async function getDepartmentWatchlist(department: string): Promise<WatchlistResult> {
  const dept = parseDepartment(department)
  if (!dept) return UNAVAILABLE("invalid-department")
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
      FROM department_watchlist
      WHERE department = ${dept}
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
    console.error("[department-watchlist] read failed:", err)
    return UNAVAILABLE("no-database")
  }
}

export async function addToDepartmentWatchlist(
  department: string,
  cert: string,
  institutionName?: string,
  note?: string
): Promise<WatchlistResult> {
  const dept = parseDepartment(department)
  if (!dept) return UNAVAILABLE("invalid-department")
  if (!isDbEnabled()) return UNAVAILABLE("no-database")

  const id = String(cert ?? "").trim()
  if (!id) return UNAVAILABLE("invalid-department")

  try {
    await ensureTable()
    // Re-adding refreshes the name and note rather than erroring, so the caller
    // does not have to check membership first.
    await sql`
      INSERT INTO department_watchlist (department, cert, institution_name, note)
      VALUES (${dept}, ${id}, ${institutionName ?? null}, ${note ?? null})
      ON CONFLICT (department, cert) DO UPDATE
        SET institution_name = COALESCE(EXCLUDED.institution_name, department_watchlist.institution_name),
            note             = COALESCE(EXCLUDED.note, department_watchlist.note)
    `
    return getDepartmentWatchlist(dept)
  } catch (err) {
    console.error("[department-watchlist] add failed:", err)
    return UNAVAILABLE("no-database")
  }
}

export async function removeFromDepartmentWatchlist(
  department: string,
  cert: string
): Promise<WatchlistResult> {
  const dept = parseDepartment(department)
  if (!dept) return UNAVAILABLE("invalid-department")
  if (!isDbEnabled()) return UNAVAILABLE("no-database")

  try {
    await ensureTable()
    await sql`
      DELETE FROM department_watchlist
      WHERE department = ${dept} AND cert = ${String(cert).trim()}
    `
    return getDepartmentWatchlist(dept)
  } catch (err) {
    console.error("[department-watchlist] remove failed:", err)
    return UNAVAILABLE("no-database")
  }
}
