"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { FirmProfile } from "@/app/actions/participant-lookup"

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

function formatNumber(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return numberFormatter.format(value)
}

export function FirmProfilePanel({
  profile,
  onViewFlows,
  onDismiss,
}: {
  profile: FirmProfile
  onViewFlows: (name: string) => void
  onDismiss?: () => void
}) {
  const { canonicalName, category, aliases, metrics, topCounterparties, entities } = profile

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-foreground">Firm Profile</h4>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss} className="shrink-0 -mr-2 -mt-1">
            Dismiss
          </Button>
        )}
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-base font-semibold text-foreground">{canonicalName}</p>
          {category && (
            <p className="text-xs text-muted-foreground mt-0.5">Category: {category}</p>
          )}
        </div>

        {aliases.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Aliases</p>
            <div className="flex flex-wrap gap-1">
              {aliases.map((a) => (
                <Badge key={a} variant="secondary" className="text-xs">
                  {a}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-md border border-border p-2">
            <p className="text-xs text-muted-foreground">Inbound</p>
            <p className="text-sm font-semibold">{formatNumber(metrics.inbound)}</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="text-xs text-muted-foreground">Outbound</p>
            <p className="text-sm font-semibold">{formatNumber(metrics.outbound)}</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="text-xs text-muted-foreground">Net</p>
            <p className={`text-sm font-semibold ${metrics.net > 0 ? "text-emerald-600" : metrics.net < 0 ? "text-rose-600" : ""}`}>
              {metrics.net > 0 ? "+" : ""}{formatNumber(metrics.net)}
            </p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-sm font-semibold">{formatNumber(metrics.total)}</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="text-xs text-muted-foreground">Last Seen</p>
            <p className="text-sm font-semibold">{metrics.lastSeen || "—"}</p>
          </div>
        </div>

        {topCounterparties.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Top Counterparties</p>
            <ul className="text-sm text-foreground space-y-0.5">
              {topCounterparties.map((c) => (
                <li key={c.name} className="truncate">
                  {c.name} ({formatNumber(c.count)})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Affiliated Entities / Vehicles</p>
          {entities.length > 0 ? (
            <ul className="text-sm text-foreground space-y-0.5">
              {entities.map((e) => (
                <li key={e.name} className="truncate">
                  {e.name} <span className="text-muted-foreground">({e.type}, {e.source})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Not configured. TODO: SEC/UCC connectors.</p>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onViewFlows(canonicalName)}
        >
          View flows
        </Button>
      </div>
    </Card>
  )
}
