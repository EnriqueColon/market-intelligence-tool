"use server"

import { unstable_cache } from "next/cache"
import type { PeerLayer } from "@/lib/peer-intel/edgar-contract"
import { buildPeerIntelPayload, type PeerIntelPayload } from "@/app/services/peer-intel"

/**
 * A week. Unlike the bank caches there is no published quarter to key on — SEC
 * filings arrive continuously — so the key carries an ISO week instead, and a
 * new week is a new entry. Inside a week the entry is served as-is, which suits
 * data whose inputs are quarterly reports and annual amendments.
 */
const PEER_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

/** `2026-W43`. Stable within a week, in every timezone the deployment runs in. */
export async function isoWeek(date = new Date()): Promise<string> {
  return isoWeekOf(date)
}

function isoWeekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // ISO weeks run Monday-Sunday and belong to the year containing their Thursday.
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

export type PeerIntelResult = { ok: true; payload: PeerIntelPayload } | { ok: false; error: string }

/**
 * The cached layer payload.
 *
 * Keyed on the layer and the ISO week, revalidated weekly, and **successes
 * only** — a failed build throws inside the cached function, so `unstable_cache`
 * stores nothing and a bad SEC day cannot pin an error in the cache for a week.
 *
 * Bump the key version when `PeerIntelPayload` changes shape, or cached entries
 * keep serving the old one until the week turns.
 */
export async function getPeerIntel(layer: PeerLayer, asOf?: string): Promise<PeerIntelResult> {
  const day = asOf ?? new Date().toISOString().slice(0, 10)
  try {
    const cached = unstable_cache(
      async () => buildPeerIntelPayload(layer, day),
      ["peer-intel-v1", layer, isoWeekOf(new Date(day))],
      { revalidate: PEER_REVALIDATE_SECONDS }
    )
    return { ok: true, payload: await cached() }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load the peer tracker for this layer.",
    }
  }
}
