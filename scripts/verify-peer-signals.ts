/**
 * Step 4 acceptance: build each layer's payload uncached, check the signals and
 * measure what would be stored.
 *
 *   npm run verify:peer-signals                     # Miami-Dade
 *   npm run verify:peer-signals -- --layer national
 *   npm run verify:peer-signals -- --all            # all three, plus scope independence
 *
 * Read-only: uses `buildPeerIntelUncached`, so nothing is written to the cache.
 * The size measurement is the one that matters — Vercel's Data Cache allows
 * 2 MB per entry on every plan, and the bank cohort had to be chunked for
 * exactly this reason.
 */

import type { PeerLayer } from "../lib/peer-intel/edgar-contract"
import { PEER_SIGNALS, peerSignalSpec } from "../lib/peer-intel/signals"
import { buildPeerIntelPayload, type PeerIntelPayload } from "../app/services/peer-intel"

const CACHE_ENTRY_LIMIT = 2 * 1024 * 1024

let failures = 0

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

function usd(v: number | "indefinite" | null): string {
  if (v === "indefinite") return "indefinite"
  if (v == null) return "—"
  const sign = v < 0 ? "-" : ""
  const a = Math.abs(v)
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  return `${sign}$${Math.round(a).toLocaleString()}`
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function run(layer: PeerLayer): Promise<PeerIntelPayload> {
  console.log(`\n${"=".repeat(78)}\nLayer "${layer}"`)
  const started = Date.now()
  const payload = await buildPeerIntelPayload(layer, new Date().toISOString().slice(0, 10))
  const elapsed = (Date.now() - started) / 1000
  const d = payload.diagnostics
  const requests = d.formDRequests + d.xbrlRequests

  console.log(`\nBuilt in ${elapsed.toFixed(1)}s, ${requests} requests (${d.formDRequests} Form D, ${d.xbrlRequests} XBRL).`)
  check("the build fits warm-cache's 300s ceiling", elapsed < 240, `${elapsed.toFixed(1)}s, ${(240 - elapsed).toFixed(0)}s headroom`)
  check("no private vehicle is missing its Form D", d.offeringFailures.length === 0, `${d.offeringFailures.length} gap(s)`)
  check("every registered vehicle's metrics were read", d.metricFailures.length === 0)
  if (d.registeredWithoutFormD.length) {
    console.log(`  note  ${d.registeredWithoutFormD.length} registered vehicle(s) file no Form D, as expected`)
  }

  // The measurement that decides whether this needs chunking.
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
  check(
    "the cached entry fits Vercel's 2 MB per-entry limit",
    bytes < CACHE_ENTRY_LIMIT,
    `${kb(bytes)} of ${kb(CACHE_ENTRY_LIMIT)} (${((bytes / CACHE_ENTRY_LIMIT) * 100).toFixed(0)}%)`
  )
  const withoutFilings = Buffer.byteLength(
    JSON.stringify({
      ...payload,
      cohort: {
        ...payload.cohort,
        managers: payload.cohort.managers.map((m) => ({ ...m, raises: m.raises.map((r) => ({ ...r, raise: { ...r.raise, filings: [] } })) })),
      },
    }),
    "utf8"
  )
  console.log(`  note  ${kb(bytes - withoutFilings)} of that is the Form D filing trails; dropping them would leave ${kb(withoutFilings)}`)

  const t = payload.cohort.totals
  console.log(`\n— Raise environment`)
  console.log(`  managers ${t.managers} (${t.managersRaising} in market) · raises ${t.raiseCount} (${t.activeRaiseCount} open)`)
  console.log(`  raised ${usd(t.totalRaised)} · sought ${usd(t.totalSought)} (${t.indefiniteTargets} indefinite) · launches ${t.newLaunchCount} · cut ${t.targetCutCount}`)

  console.log(`\n— Signal firing rates (over judged managers)`)
  for (const row of payload.firingRates) {
    const spec = peerSignalSpec(row.key)!
    console.log(
      `  ${row.key.padEnd(24)} ${spec.family.padEnd(12)} fired ${String(row.fired).padStart(2)}  quiet ${String(row.quiet).padStart(2)}  unjudged ${String(row.unjudged).padStart(2)}  ` +
        `rate ${row.rate == null ? "—" : `${(row.rate * 100).toFixed(0)}%`}`
    )
  }
  check(
    "no signal fires on more than 70% of judged managers",
    payload.firingRates.every((r) => r.rate == null || r.rate <= 0.7),
    "a signal that fires on most of the cohort tells you nothing"
  )
  check(
    "every signal has at least one judged manager, or is honestly unjudged",
    payload.firingRates.every((r) => r.fired + r.quiet > 0 || r.unjudged === payload.signals.length),
    "a partially-judged signal with no verdicts would be a bug"
  )

  console.log(`\n— Managers with the most fired signals`)
  const ranked = [...payload.signals]
    .map((s) => ({ ...s, total: s.firedKeys.length }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
  for (const m of ranked) {
    console.log(`  ${m.manager.slice(0, 28).padEnd(28)} ${m.actionCount}a ${m.pressureCount}p  ${m.firedKeys.join(", ")}`)
  }

  const self = payload.signals.find((s) => s.peerId === "safe-harbor-capital-partners")
  if (self) {
    console.log(`\n— Safe Harbor's own signals`)
    for (const s of self.signals) {
      const spec = peerSignalSpec(s.key)!
      const mark = s.state === "fired" ? "●" : s.state === "quiet" ? "○" : "·"
      console.log(`  ${mark} ${spec.label.padEnd(26)} ${s.state.padEnd(9)} ${s.detail ?? s.missing ?? ""}`)
    }
  }

  return payload
}

/** The acceptance rule: a manager's signals must not change with the layer. */
function checkScopeIndependence(byLayer: Map<PeerLayer, PeerIntelPayload>) {
  console.log(`\n${"=".repeat(78)}\n— Scope independence`)
  const layers = [...byLayer.keys()]
  const local = byLayer.get("miami-dade")
  if (!local || layers.length < 2) {
    console.log("  skipped: needs at least two layers")
    return
  }
  let compared = 0
  let differences = 0
  for (const manager of local.signals) {
    for (const layer of layers) {
      if (layer === "miami-dade") continue
      const other = byLayer.get(layer)!.signals.find((s) => s.peerId === manager.peerId)
      if (!other) continue
      compared++
      if (JSON.stringify(manager.signals) !== JSON.stringify(other.signals)) {
        differences++
        console.log(`  FAIL  ${manager.manager}: signals differ between miami-dade and ${layer}`)
      }
    }
  }
  check(
    "a manager's signals are identical in every layer it appears in",
    differences === 0,
    `${compared} comparison(s), ${differences} difference(s)`
  )
}

async function main() {
  console.log(`Peer signals verification — ${new Date().toISOString().slice(0, 10)}, live against SEC`)
  const all = process.argv.includes("--all")
  const layers: PeerLayer[] = all
    ? ["miami-dade", "florida", "national"]
    : [arg("layer", "miami-dade") as PeerLayer]

  const byLayer = new Map<PeerLayer, PeerIntelPayload>()
  for (const layer of layers) byLayer.set(layer, await run(layer))
  if (byLayer.size > 1) checkScopeIndependence(byLayer)

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
