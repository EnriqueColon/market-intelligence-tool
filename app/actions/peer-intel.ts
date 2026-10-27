"use server"

import { unstable_cache } from "next/cache"
import type { PeerLayer } from "@/lib/peer-intel/edgar-contract"
import { buildLayerAdv, buildPeerIntelPayload, type PeerIntelPayload } from "@/app/services/peer-intel"

/**
 * A week. The inputs are quarterly reports and annual amendments, so nothing is
 * gained by rebuilding more often.
 */
const PEER_REVALIDATE_SECONDS = 60 * 60 * 24 * 7

export type PeerIntelResult = { ok: true; payload: PeerIntelPayload } | { ok: false; error: string }

/**
 * The cached layer payload.
 *
 * **The cache key is deliberately stable** — layer and version only, with no
 * date in it. An earlier version keyed on the ISO week, which looked tidy and
 * quietly broke the thing that matters: `revalidate` serves a *stale* entry
 * immediately and refreshes behind the request, but a key that changes every
 * week has no stale entry to serve, so the first visitor of every week waited
 * out a full rebuild — 28 seconds for Miami-Dade, over a minute for the US
 * layer. With a stable key that happens once, ever, and every visit afterwards
 * is served from the cache while the refresh happens out of band.
 *
 * Successes only: a failed build throws inside the cached function, so nothing
 * is stored and a bad SEC day cannot pin an error in the cache for a week.
 *
 * Bump the version when `PeerIntelPayload` changes shape, or cached entries
 * keep serving the old one for up to a week.
 */
export async function getPeerIntel(layer: PeerLayer, asOf?: string): Promise<PeerIntelResult> {
  const day = asOf ?? new Date().toISOString().slice(0, 10)
  try {
    const cached = unstable_cache(
      // `day` is not in the key, so it is not a cache input; it only dates the
      // payload that gets stored. A rebuild a week later stamps the new date.
      async () => buildPeerIntelPayload(layer, day),
      // v4 (2026-10-27): each raise carries its Form D `fileNumber`, the key
      // that links it to the adviser's Form ADV record. A v3 entry has none, so
      // its ADV links would fall back to name matching for up to a week.
      // v3 (2026-10-26): each raise carries `terms` and `exemptionChanges`, and
      // related persons a `kind` and `clarification`.
      ["peer-intel-v4", layer],
      { revalidate: PEER_REVALIDATE_SECONDS, tags: [`peer-intel`, `peer-intel:${layer}`] }
    )
    const payload = await cached()
    // The ADV extract is a committed file, not a fetch: rebuilding its views
    // here means a newly deployed extract shows at once, while the cached
    // payload still carries the cohort it is linked against.
    return { ok: true, payload: { ...payload, adv: buildLayerAdv(layer, payload.cohort) } }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load the peer tracker for this layer.",
    }
  }
}
