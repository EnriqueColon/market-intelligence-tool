/**
 * Participant activity classification and role detection.
 * Purely functional, no side effects.
 * Used by AOM rollups and Executive Snapshot.
 */

import { normalize_name } from "@/lib/participant-intel"

/** Role classification for AOM participants */
export type ParticipantRole =
  | "Accumulator"
  | "Distributor"
  | "Intermediary"
  | "Registry/Utility"
  | "Agency/Gov"
  | null

const REGISTRY_KEYWORDS = ["MERS", "REGISTRATION", "ELECTRONIC"]
const AGENCY_KEYWORDS = ["HUD", "SECRETARY", "SBA", "FANNIE", "FREDDIE"]

/** Threshold for net to qualify as Accumulator/Distributor */
const NET_THRESHOLD = 5

/** Threshold for "high" inbound/outbound in Intermediary check */
const HIGH_VOLUME_THRESHOLD = 10

/**
 * Classify a participant's role based on AOM metrics and name.
 */
export function classifyParticipantRole(
  firmName: string,
  inbound90d: number,
  outbound90d: number,
  net90d: number
): ParticipantRole {
  const norm = normalize_name(firmName)

  // Registry/Utility: keyword match
  if (REGISTRY_KEYWORDS.some((k) => norm.includes(k))) {
    return "Registry/Utility"
  }

  // Agency/Gov: keyword match
  if (AGENCY_KEYWORDS.some((k) => norm.includes(k))) {
    return "Agency/Gov"
  }

  // Accumulator: net_90d > threshold AND inbound_90d high
  if (net90d > NET_THRESHOLD && inbound90d >= HIGH_VOLUME_THRESHOLD) {
    return "Accumulator"
  }

  // Distributor: net_90d < -threshold AND outbound_90d high
  if (net90d < -NET_THRESHOLD && outbound90d >= HIGH_VOLUME_THRESHOLD) {
    return "Distributor"
  }

  // Intermediary: inbound + outbound high BUT net near 0
  const total = inbound90d + outbound90d
  if (total >= HIGH_VOLUME_THRESHOLD * 2 && Math.abs(net90d) <= NET_THRESHOLD) {
    return "Intermediary"
  }

  return null
}
