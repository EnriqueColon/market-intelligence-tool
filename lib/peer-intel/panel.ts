/**
 * What the peer tab says in words, built from the figures on it.
 *
 * The readings here are **deterministic, not model calls** — the same decision
 * as the Balance-Sheet Actions panel (`buildReading` in
 * `lib/analytics/bank-behavior-panel.ts`). Building the sentence from the
 * figures already on the panel satisfies "every figure is checked against the
 * data" by construction, costs nothing per open, and cannot drift from the
 * table. So there is no figure-checker and no fallback path.
 *
 * Pure: aggregates in, strings out.
 */

import { buildFilingIndexUrl } from "./edgar-contract"
import type { ManagerRaises, PeerCohort, VehicleRaise } from "./cohort"
import { activeRaises, newLaunches, selfPositioning } from "./cohort"
import { peerSignalSpec, type ManagerSignals, type PeerSignalKey } from "./signals"

export function money(value: number | "indefinite" | null | undefined): string {
  if (value === "indefinite") return "no stated cap"
  if (value == null) return "not reported"
  const sign = value < 0 ? "−" : ""
  const a = Math.abs(value)
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`
  return `${sign}$${Math.round(a)}`
}

export function percent(value: number | null | undefined, digits = 0): string {
  return value == null ? "not reported" : `${(value * 100).toFixed(digits)}%`
}

/** `2026-07-23` to `July 2026`, for prose that should not read like a log line. */
export function monthYear(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return "an unknown date"
  const [y, m] = iso.split("-").map(Number)
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"]
  return `${months[m - 1]} ${y}`
}

const LAYER_NAMES: Record<string, string> = {
  "miami-dade": "Miami-Dade",
  florida: "Florida",
  national: "the US",
}

export function layerName(layer: string): string {
  return LAYER_NAMES[layer] ?? layer
}

/**
 * The reading above the Raise Environment figures.
 *
 * Answers, in order: how many competitors are in the market, how much they are
 * asking for, what has just launched, who is cutting back, and — where the data
 * exists — whether money is going in or coming out. Every clause is dropped
 * rather than hedged when its figure is missing.
 */
export function buildEnvironmentReading(cohort: PeerCohort): string {
  const t = cohort.totals
  const where = layerName(cohort.layer)
  const sentences: string[] = []

  if (!t.managersRaising) {
    sentences.push(
      `None of the ${t.managers} tracked ${where} managers has filed an open offering recently, so there is no live raise to compare against.`
    )
    return sentences.join(" ")
  }

  sentences.push(
    `${t.managersRaising} of ${t.managers} tracked ${where} managers are in the market, across ${t.activeRaiseCount} open ${t.activeRaiseCount === 1 ? "raise" : "raises"}.`
  )

  if (t.totalSought != null) {
    const indefinite = t.indefiniteTargets
      ? `, and a further ${t.indefiniteTargets} ${t.indefiniteTargets === 1 ? "offering states" : "offerings state"} no cap`
      : ""
    sentences.push(`They have raised ${money(t.totalRaised)} in total against stated offerings of ${money(t.totalSought)}${indefinite}.`)
  } else {
    sentences.push(`They have raised ${money(t.totalRaised)} in total; no offering in this layer states a cap, so there is no target to measure against.`)
  }

  if (t.newLaunchCount) {
    sentences.push(
      `${t.newLaunchCount} ${t.newLaunchCount === 1 ? "fund has" : "funds have"} opened in the last twelve months.`
    )
  }
  if (t.targetCutCount) {
    sentences.push(
      `${t.targetCutCount} ${t.targetCutCount === 1 ? "manager has" : "managers have"} reduced what they are asking for, which is not something a manager announces.`
    )
  }

  if (cohort.coverage.registeredVehicles === 0) {
    sentences.push(
      `Every peer in this layer is a private fund, so this is the raise and nothing else: portfolios, performance and redemptions are not reported at any point in a private fund's life.`
    )
  }

  return sentences.join(" ")
}

/**
 * Where the firm's own raise sits.
 *
 * Deliberately blunt in both directions — the point of putting Safe Harbor on
 * the same axes as its peers is to see the unflattering comparison as readily
 * as the flattering one.
 */
export function buildSelfReading(cohort: PeerCohort): string | null {
  const pos = selfPositioning(cohort)
  if (!pos) {
    const self = cohort.self
    if (!self) return null
    const open = self.raises.find((r) => r.role === "fund" && r.open)
    if (!open) {
      return `Safe Harbor has no open offering on file in this layer, so there is nothing to compare against its peers.`
    }
    return `Fewer than three peer raises in ${layerName(cohort.layer)} can be compared against ${open.vehicleName}, so no ranking is shown — a position among two funds would not mean anything.`
  }

  const r = pos.selfRaise.raise
  const total = pos.peerCount + 1
  const ahead = pos.rankBySold - 1
  const parts: string[] = [
    `${pos.selfRaise.vehicleName} has raised ${money(r.sold)}${r.progress != null ? ` of its ${money(r.target)} offering (${percent(r.progress, 1)})` : ""}, which ranks ${pos.rankBySold} of ${total} open raises in ${layerName(cohort.layer)}.`,
  ]
  parts.push(
    ahead === 0
      ? `No peer raise in this layer is larger.`
      : `${ahead} peer ${ahead === 1 ? "raise is" : "raises are"} larger.`
  )
  parts.push(
    `The median open peer raise has taken ${money(pos.medianSold)}${pos.medianProgress != null ? ` and is ${percent(pos.medianProgress, 1)} subscribed` : ""}.`
  )
  if (r.sold != null) {
    const vsMedian = r.sold - pos.medianSold
    parts.push(
      vsMedian >= 0
        ? `Safe Harbor is ${money(vsMedian)} above that median.`
        : `Safe Harbor is ${money(Math.abs(vsMedian))} below that median.`
    )
  }
  if (r.targetCut && r.targetHigh != null) {
    const peersCut = cohort.managers.filter((m) => !m.isSelf && m.targetCutCount > 0).length
    parts.push(
      `Its offering was cut from ${money(r.targetHigh)}${
        peersCut === 0
          ? `, and no other manager in this layer has cut one`
          : `; ${peersCut} other ${peersCut === 1 ? "manager has" : "managers have"} also cut`
      }.`
    )
  }
  return parts.join(" ")
}

/**
 * One manager's reading, for the drawer.
 *
 * Built from the signals that actually fired plus the figures behind them, so
 * it cannot say anything the panel does not show. Where a whole family is
 * unjudged it says why, because "no redemption signal" and "redemptions not
 * reported" mean very different things to a reader.
 */
export function buildManagerReading(manager: ManagerRaises, signals: ManagerSignals): string {
  const sentences: string[] = []
  const fired = new Set(signals.firedKeys)
  const stateOf = (key: PeerSignalKey) => signals.signals.find((s) => s.key === key)
  const detail = (key: PeerSignalKey) => stateOf(key)?.detail?.replace(/^[^:]+:\s*/, "") ?? null

  const open = manager.raises.filter((r) => r.role === "fund" && r.open)
  if (!manager.raises.length) {
    return `No readable Form D filing was found for ${manager.manager}, so nothing can be said about its fundraising.`
  }

  sentences.push(
    open.length
      ? `${manager.manager} has ${open.length} open ${open.length === 1 ? "raise" : "raises"} of ${manager.raiseCount} in the registry, and has raised ${money(manager.totalRaised)} across all vintages.`
      : `${manager.manager} has no open raise on file; the newest of its ${manager.raiseCount} ${manager.raiseCount === 1 ? "fund" : "funds"} last filed in ${monthYear(manager.lastFiled)}, and it has raised ${money(manager.totalRaised)} across all vintages.`
  )

  if (fired.has("newVehicle")) {
    sentences.push(`It has opened a new fund in the last twelve months${detail("newVehicle") ? ` (${detail("newVehicle")})` : ""}.`)
  }
  if (fired.has("raiseAccelerating")) {
    sentences.push(`Capital is arriving faster than it was: ${detail("raiseAccelerating")}.`)
  }
  if (fired.has("targetCut")) {
    sentences.push(`It has reduced what it is asking for — ${detail("targetCut")} — which a manager does not announce.`)
  }
  if (fired.has("raiseStalled")) {
    sentences.push(`One of its offerings is open on paper but has not been amended for a year (${detail("raiseStalled")}); Form D carries no closed flag, so a fund that quietly closed reads the same way.`)
  }

  if (fired.has("netOutflow")) {
    sentences.push(`Its semi-liquid vehicle is paying out more than it is taking in — net flow of ${detail("netOutflow")}.`)
  }
  if (fired.has("redemptionAcceleration")) {
    sentences.push(`Redemptions are running above anything that vehicle has seen before: ${detail("redemptionAcceleration")}.`)
  }
  if (fired.has("pikBuild")) {
    sentences.push(`More of its income is being paid in kind, which usually means borrowers cannot pay cash — ${detail("pikBuild")}.`)
  }
  if (fired.has("portfolioShrink")) {
    sentences.push(`Its book is shrinking: ${detail("portfolioShrink")}.`)
  }

  if (!fired.size) {
    sentences.push(`No signal fired on the measures available for it.`)
  }

  // Say what could not be judged, and why — the distinction a reader needs.
  const liquidity = stateOf("netOutflow")
  if (liquidity?.state === "unjudged") {
    sentences.push(
      liquidity.missing?.includes("listed")
        ? `Its liquidity signals are not judged: its shares trade, so repurchases are a buyback rather than investors being paid out.`
        : `Liquidity and portfolio figures are not observable for this manager — a private fund reports none of them.`
    )
  } else if (stateOf("pikBuild")?.state === "unjudged" && stateOf("pikBuild")?.missing?.includes("not tagged")) {
    sentences.push(`Payment-in-kind income is not tagged by this filer, so the PIK signal is not judged.`)
  }

  return sentences.join(" ")
}

/** The fired signals in a stable display order: action first, then pressure. */
export function orderedSignals(signals: ManagerSignals): ManagerSignals["signals"] {
  const weight = (key: PeerSignalKey) => {
    const spec = peerSignalSpec(key)
    return spec?.side === "action" ? 0 : 1
  }
  return [...signals.signals].sort((a, b) => {
    const stateRank = (s: string) => (s === "fired" ? 0 : s === "quiet" ? 1 : 2)
    return stateRank(a.state) - stateRank(b.state) || weight(a.key) - weight(b.key) || a.key.localeCompare(b.key)
  })
}

/**
 * Copy Snapshot for a manager, matching the institution drawer's behaviour.
 *
 * Plain text, because it is pasted into an email or a memo.
 */
export function buildManagerSnapshot(
  manager: ManagerRaises,
  signals: ManagerSignals,
  cohort: PeerCohort
): string {
  const lines: string[] = [
    `${manager.manager} — ${manager.location}`,
    `Layer: ${layerName(manager.layer)} · relevance: ${manager.relevance}`,
    `Raised across all vintages: ${money(manager.totalRaised)}`,
    `Raises: ${manager.raiseCount} (${manager.openRaiseCount} open)${manager.lastFiled ? ` · last filed ${manager.lastFiled}` : ""}`,
    "",
  ]

  if (manager.raises.length) {
    lines.push("Raises:")
    for (const r of manager.raises) {
      lines.push(
        `  ${r.vehicleName}${r.role === "sleeve" ? " (sleeve)" : ""} — ` +
          `offering ${money(r.raise.target)}, raised ${money(r.raise.sold)}` +
          `${r.raise.progress != null ? ` (${percent(r.raise.progress, 1)})` : ""}` +
          `${r.raise.investorCount != null ? `, ${r.raise.investorCount} investors` : ""}` +
          `${r.raise.lastFiled ? `, last filed ${r.raise.lastFiled}` : ""}` +
          `${r.raise.targetCut && r.raise.targetHigh != null ? `, cut from ${money(r.raise.targetHigh)}` : ""}`
      )
    }
    lines.push("")
  }

  const firedSignals = signals.signals.filter((s) => s.state === "fired")
  lines.push(firedSignals.length ? "Signals fired:" : "Signals fired: none")
  for (const s of firedSignals) {
    lines.push(`  ${peerSignalSpec(s.key)?.label ?? s.key}${s.detail ? ` — ${s.detail}` : ""}`)
  }

  const unjudged = signals.signals.filter((s) => s.state === "unjudged")
  if (unjudged.length) {
    lines.push("", "Not judged:")
    for (const s of unjudged) {
      lines.push(`  ${peerSignalSpec(s.key)?.label ?? s.key}${s.missing ? ` — ${s.missing}` : ""}`)
    }
  }

  lines.push("", "Reading:", buildManagerReading(manager, signals))
  lines.push("", `Source: SEC EDGAR Form D and XBRL company facts, as of ${cohort.asOf}. Form D figures are self-reported by the issuer and unaudited.`)
  return lines.join("\n")
}

/** The rows the Active Raises table shows, with the firm's own raise first. */
export function activeRaiseRows(cohort: PeerCohort): Array<VehicleRaise & { manager: string; peerId: string; isSelf: boolean }> {
  const selfId = cohort.self?.peerId
  return activeRaises(cohort)
    .map((r) => ({ ...r, isSelf: r.peerId === selfId }))
    .sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
      return (b.raise.sold ?? -1) - (a.raise.sold ?? -1)
    })
}

/**
 * The SEC filing a raise's headline figures came from.
 *
 * The strongest provenance available: rather than asking a reader to trust the
 * table, link them to the document it was read from. Always the newest filing
 * in the trail, because that is the one `target`, `sold` and `investorCount`
 * are taken from.
 */
export function filingUrl(raise: VehicleRaise["raise"]): string | null {
  const newest = raise.filings[raise.filings.length - 1]
  if (!newest?.accession || !newest.cik) return null
  try {
    return buildFilingIndexUrl(newest.cik, newest.accession)
  } catch {
    return null
  }
}

/** Every filing behind a raise, newest first, for the drawer's trail. */
export function filingTrail(raise: VehicleRaise["raise"]): Array<{
  formType: string
  filedAt: string
  url: string | null
  sold: number | null
  target: number | "indefinite" | null
}> {
  return [...raise.filings].reverse().map((f) => {
    let url: string | null = null
    try {
      url = f.accession && f.cik ? buildFilingIndexUrl(f.cik, f.accession) : null
    } catch {
      url = null
    }
    return { formType: f.formType, filedAt: f.filedAt, url, sold: f.totalSold, target: f.offeringAmount }
  })
}

export function newLaunchRows(cohort: PeerCohort): Array<VehicleRaise & { manager: string; peerId: string }> {
  return newLaunches(cohort)
}
