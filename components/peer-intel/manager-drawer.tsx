"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { PeerCohort } from "@/lib/peer-intel/cohort"
import {
  buildManagerReading,
  buildManagerSnapshot,
  filingTrail,
  money,
  orderedSignals,
  percent,
} from "@/lib/peer-intel/panel"
import { peerById } from "@/lib/peer-intel/registry"
import { peerSignalSpec, type ManagerSignals, type SignalState } from "@/lib/peer-intel/signals"

/**
 * One manager, in full.
 *
 * Mirrors the institution drawer: signal chips with the firing rule on hover,
 * the figures behind them, a deterministic reading and Copy Snapshot. Three
 * things are deliberately different — there are no eight-quarter trend panels
 * for a private fund because it reports nothing quarterly, the sleeves of a
 * raise are listed here rather than in the table, and an unjudged signal says
 * *why* it could not be judged.
 *
 * `sm:max-w-5xl`, not `max-w-5xl`: the base `DialogContent` carries
 * `sm:max-w-lg`, which is a media-query rule and beats a bare `max-w-*` on
 * every desktop viewport. That trap rendered the institution drawer 512px wide
 * for weeks — see the README's traps section.
 */

const CHIP: Record<SignalState, string> = {
  fired: "border-red-200 bg-red-50 text-red-900",
  quiet: "border-slate-200 bg-white text-slate-500",
  unjudged: "border-dashed border-slate-300 bg-slate-50 text-slate-400",
}

const PRESSURE_FIRED = "border-amber-200 bg-amber-50 text-amber-900"

function SignalChips({ signals }: { signals: ManagerSignals }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {orderedSignals(signals).map((result) => {
        const spec = peerSignalSpec(result.key)
        if (!spec) return null
        const className =
          result.state === "fired" && spec.side === "pressure" ? PRESSURE_FIRED : CHIP[result.state]
        const title = [spec.meaning, spec.rule, result.detail ?? result.missing ?? ""]
          .filter(Boolean)
          .join("\n\n")
        return (
          <span
            key={result.key}
            title={title}
            className={`cursor-help rounded border px-2 py-0.5 text-[11px] font-medium ${className}`}
          >
            {spec.label}
            {result.state === "unjudged" && <span className="ml-1 font-normal">not judged</span>}
          </span>
        )
      })}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200/80 bg-white px-4 py-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  )
}

export function ManagerDrawer({
  cohort,
  signals,
  peerId,
  onClose,
}: {
  cohort: PeerCohort
  signals: ManagerSignals[]
  peerId: string | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const manager = useMemo(
    () => (peerId ? cohort.managers.find((m) => m.peerId === peerId) ?? null : null),
    [cohort, peerId]
  )
  const managerSignalSet = useMemo(
    () => (peerId ? signals.find((s) => s.peerId === peerId) ?? null : null),
    [signals, peerId]
  )
  const registryEntry = peerId ? peerById(peerId) : undefined

  async function copySnapshot() {
    if (!manager || !managerSignalSet) return
    try {
      await navigator.clipboard.writeText(buildManagerSnapshot(manager, managerSignalSet, cohort))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // A clipboard the browser will not grant is not worth an error dialog.
      setCopied(false)
    }
  }

  return (
    <Dialog open={Boolean(peerId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] sm:max-w-5xl max-h-[90vh] overflow-y-auto p-6">
        {!manager || !managerSignalSet ? (
          <>
            <DialogHeader>
              <DialogTitle>Manager unavailable</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-600">
              This manager is not in the current layer. Switch to a wider layer to see it.
            </p>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">{manager.manager}</DialogTitle>
              <p className="text-xs text-slate-600">
                {manager.location} · {manager.relevance === "direct" ? "direct peer" : "adjacent strategy"}
                {manager.isSelf && " · this firm"}
              </p>
            </DialogHeader>

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                {manager.raiseCount} {manager.raiseCount === 1 ? "raise" : "raises"} ·{" "}
                {manager.openRaiseCount} open · {money(manager.totalRaised)} raised across all vintages
              </div>
              <Button size="sm" variant="outline" onClick={copySnapshot}>
                {copied ? "Copied" : "Copy Snapshot"}
              </Button>
            </div>

            <div className="mt-4 grid gap-3">
              <Section title="Signals">
                <SignalChips signals={managerSignalSet} />
                <p className="mt-2 text-[11px] text-slate-500">
                  Red is an action the manager has taken, amber a pressure it is under, outline a measure that was
                  judged and stayed quiet, dashed a measure that could not be judged. Hover for the firing rule.
                  Signals read only this manager&apos;s own filings, so they are the same in every layer.
                </p>
              </Section>

              <Section title="Reading">
                <p className="text-sm leading-relaxed text-slate-700">
                  {buildManagerReading(manager, managerSignalSet)}
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Built from the figures on this panel, not written by a model, so it cannot say anything the panel does
                  not show.
                </p>
              </Section>

              <Section title="Raises">
                {manager.raises.length === 0 ? (
                  <p className="text-sm text-slate-600">No readable Form D filing was found for this manager.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fund</th>
                          <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Offering</th>
                          <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Raised</th>
                          <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Subscribed</th>
                          <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Investors</th>
                          <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last filed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manager.raises.map((r) => (
                          <tr key={r.cik} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-1.5 text-sm text-slate-700">
                              {r.vehicleName}
                              {r.role === "sleeve" && (
                                <span
                                  className="ml-2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500"
                                  title="A feeder or parallel vehicle of a larger raise. Its capital is part of that raise, so it is not counted as a separate fund."
                                >
                                  sleeve
                                </span>
                              )}
                              {!r.open && (
                                <span className="ml-2 text-[10px] text-slate-400">no filing in 4+ quarters</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right text-sm tabular-nums text-slate-700">{money(r.raise.target)}</td>
                            <td className="px-2 py-1.5 text-right text-sm tabular-nums text-slate-700">{money(r.raise.sold)}</td>
                            <td className="px-2 py-1.5 text-right text-sm tabular-nums text-slate-700">
                              {r.raise.progress == null ? "—" : percent(r.raise.progress, 1)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-sm tabular-nums text-slate-700">{r.raise.investorCount ?? "—"}</td>
                            <td className="px-2 py-1.5 text-sm whitespace-nowrap text-slate-700">
                              {r.raise.lastFiled ?? "—"}
                              {filingTrail(r.raise)[0]?.url && (
                                <>
                                  {" "}
                                  <a
                                    href={filingTrail(r.raise)[0].url as string}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-[#006D95] underline"
                                    title="Open on sec.gov"
                                  >
                                    filing
                                  </a>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section title="Filing trail">
                {manager.raises.length === 0 ? (
                  <p className="text-sm text-slate-600">No filings found.</p>
                ) : (
                  <div className="space-y-2">
                    {manager.raises.map((r) => (
                      <div key={`trail-${r.cik}`}>
                        <div className="text-xs font-medium text-slate-700">{r.vehicleName}</div>
                        <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                          {filingTrail(r.raise).map((f) => (
                            <li key={`${r.cik}-${f.filedAt}-${f.formType}`} className="text-[11px] text-slate-600">
                              {f.url ? (
                                <a
                                  href={f.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#006D95] underline"
                                  title={`Form ${f.formType} filed ${f.filedAt} — raised ${money(f.sold)} against an offering of ${money(f.target)}`}
                                >
                                  {f.formType} · {f.filedAt}
                                </a>
                              ) : (
                                <span>
                                  {f.formType} · {f.filedAt}
                                </span>
                              )}
                              <span className="ml-1 text-slate-400">{money(f.sold)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  Every amendment, newest first, with the amount sold as at that filing. Each links to the document on
                  sec.gov — these are the filings every figure in this drawer was read from.
                </p>
              </Section>

              {registryEntry && (
                <Section title="Why this manager is tracked">
                  <p className="text-sm leading-relaxed text-slate-700">{registryEntry.evidence}</p>
                  {registryEntry.website && (
                    <a
                      href={registryEntry.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-[#006D95] underline"
                    >
                      {registryEntry.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </Section>
              )}
            </div>

            <p className="mt-4 text-[11px] leading-snug text-slate-500">
              Source: SEC EDGAR Form D and XBRL company facts, as of {cohort.asOf}. Form D figures are self-reported by
              the issuer and unaudited, and &ldquo;raised&rdquo; is cumulative since the offering opened rather than a
              period figure.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
