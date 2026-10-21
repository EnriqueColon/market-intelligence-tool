"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getPeerIntel } from "@/app/actions/peer-intel"
import type { PeerIntelPayload } from "@/app/services/peer-intel"
import type { PeerLayer } from "@/lib/peer-intel/edgar-contract"
import { layerName } from "@/lib/peer-intel/panel"
import { getErrorMessage } from "@/lib/error-utils"
import { ActiveRaises, NewLaunches } from "@/components/peer-intel/active-raises"
import { ManagerDrawer } from "@/components/peer-intel/manager-drawer"
import { RaiseEnvironment } from "@/components/peer-intel/raise-environment"

/**
 * Peers — what competing managers are doing about raising capital.
 *
 * The tool's other tabs serve deal sourcing: find a bank under CRE stress and
 * get to the loan pool first. This one serves the other side of the business.
 * When the firm is in front of an LP, the questions are who else is raising, at
 * what size, how fast, and who is losing money out the back door.
 *
 * Three layers, matching the scopes the Market Analytics tab already uses and
 * cumulative upward: Miami-Dade is the firms competing for the same deals and
 * allocations, Florida adds the rest of the state, and the US layer adds the
 * broader private credit market — which is also the only layer with any
 * quarterly data, since every peer that files periodic reports is national.
 *
 * Everything comes from SEC EDGAR: Form D for the raise, XBRL company facts for
 * the reporting vehicles. Nothing here is a survey, a subscription feed or a
 * model's guess.
 */

const LAYERS: readonly PeerLayer[] = ["miami-dade", "florida", "national"]

function LayerTabs({ value, onChange }: { value: PeerLayer; onChange: (layer: PeerLayer) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[#006D95]/20 bg-white p-1 shadow-sm">
      {LAYERS.map((layer) => (
        <button
          key={layer}
          type="button"
          onClick={() => onChange(layer)}
          className={[
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            value === layer
              ? "bg-[#006D95] text-white shadow-sm"
              : "text-[#006D95] hover:bg-[#006D95]/5",
          ].join(" ")}
        >
          {layerName(layer)}
        </button>
      ))}
    </div>
  )
}

export function PeerIntel() {
  const [layer, setLayer] = useState<PeerLayer>("miami-dade")
  const [payload, setPayload] = useState<PeerIntelPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedManager, setSelectedManager] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getPeerIntel(layer)
      .then((result) => {
        if (!active) return
        if (result.ok) setPayload(result.payload)
        else setError(result.error)
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [layer])

  // The drawer is keyed on a manager id, which only exists in the layer that
  // was loaded when it was opened. Closing it on a layer change avoids showing
  // "manager unavailable" to someone who simply switched scope.
  useEffect(() => {
    setSelectedManager(null)
  }, [layer])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Peers &amp; Private Credit</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            What competing managers are doing about raising capital — ongoing raises, fund sizes and progress, new
            launches, and where the data exists, redemption activity and portfolio stress. From SEC filings only.
          </p>
        </div>
        <LayerTabs value={layer} onChange={setLayer} />
      </div>

      {error && (
        <Card className="p-6 surface-primary">
          <h3 className="text-base font-semibold text-slate-800">Peer data unavailable</h3>
          <p className="mt-1 text-sm text-red-700">{error}</p>
          <p className="mt-2 text-xs text-slate-600">
            The tracker reads SEC EDGAR directly. A failure here is usually EDGAR being briefly unavailable; the weekly
            cron will rebuild this layer on its next run.
          </p>
        </Card>
      )}

      {loading && !error && (
        <>
          <Card className="p-6 surface-primary">
            <Skeleton className="h-5 w-72" />
            <Skeleton className="mt-3 h-16 w-full" />
            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </Card>
          <Card className="p-6 surface-primary">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-3 h-48 w-full" />
          </Card>
        </>
      )}

      {!loading && !error && payload && (
        <>
          <RaiseEnvironment cohort={payload.cohort} />
          <ActiveRaises cohort={payload.cohort} onSelectManager={setSelectedManager} />
          <NewLaunches cohort={payload.cohort} onSelectManager={setSelectedManager} />

          <ManagerDrawer
            cohort={payload.cohort}
            signals={payload.signals}
            peerId={selectedManager}
            onClose={() => setSelectedManager(null)}
          />

          <p className="text-[11px] leading-snug text-slate-500">
            {payload.cohort.totals.managers} managers and {payload.cohort.totals.vehicles} vehicles tracked in{" "}
            {layerName(layer)}, built {payload.diagnostics.asOf} from {payload.diagnostics.formDRequests} Form D and{" "}
            {payload.diagnostics.xbrlRequests} XBRL requests to SEC EDGAR. Rebuilt weekly.
            {payload.diagnostics.offeringFailures.length > 0 && (
              <>
                {" "}
                {payload.diagnostics.offeringFailures.length} vehicle
                {payload.diagnostics.offeringFailures.length === 1 ? "" : "s"} could not be read and{" "}
                {payload.diagnostics.offeringFailures.length === 1 ? "is" : "are"} excluded from the figures above.
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}
