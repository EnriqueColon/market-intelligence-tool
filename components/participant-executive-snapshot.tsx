"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  fetchParticipantActivitySummary,
  type ParticipantActivitySummary,
  type TopMover,
  type NewEntrant,
  type TopPair,
  type Alert,
} from "@/app/actions/fetch-participant-activity-summary"

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "Global Distressed Credit", label: "Global" },
  { value: "CRE Debt Platforms", label: "CRE Platforms" },
  { value: "Servicer / Trustee / Infrastructure", label: "Servicer/Trustee" },
  { value: "Florida / Southeast Distressed", label: "Florida/Southeast" },
  { value: "Regional / Secondary Buyers", label: "Regional" },
]

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

function formatNum(n?: number) {
  if (n === undefined || Number.isNaN(n)) return "—"
  return numberFormatter.format(n)
}

function TopMoversCard({ items, title, period }: { items: TopMover[]; title: string; period: string }) {
  return (
    <Card className="p-4">
      <h5 className="text-sm font-semibold text-foreground mb-2">{title}</h5>
      <p className="text-xs text-muted-foreground mb-3">{period}</p>
      <div className="space-y-2 max-h-48 overflow-auto">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data</p>
        ) : (
          items.map((m, i) => (
            <div key={`${m.firm}-${i}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium">{m.firm}</span>
              <span className="tabular-nums shrink-0">
                {period.includes("30") ? (
                  <>
                    net {m.net_30d != null && m.net_30d >= 0 ? "+" : ""}
                    {formatNum(m.net_30d)} / {formatNum(m.total_30d)} total
                  </>
                ) : (
                  <>
                    net {m.net_90d != null && m.net_90d >= 0 ? "+" : ""}
                    {formatNum(m.net_90d)} / {formatNum(m.total_90d)} total
                  </>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function NewEntrantsCard({ items }: { items: NewEntrant[] }) {
  return (
    <Card className="p-4">
      <h5 className="text-sm font-semibold text-foreground mb-2">New Entrants</h5>
      <p className="text-xs text-muted-foreground mb-3">First seen in last 90 days (≥5 events)</p>
      <div className="space-y-2 max-h-48 overflow-auto">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No new entrants</p>
        ) : (
          items.map((n, i) => (
            <div key={`${n.firm}-${i}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium">{n.firm}</span>
              <span className="tabular-nums shrink-0">
                {formatNum(n.total_90d)} since {n.firstSeen}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function TopPairsCard({ items }: { items: TopPair[] }) {
  return (
    <Card className="p-4">
      <h5 className="text-sm font-semibold text-foreground mb-2">Top Relationships</h5>
      <p className="text-xs text-muted-foreground mb-3">Assignor → Assignee (90d)</p>
      <div className="space-y-2 max-h-48 overflow-auto">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data</p>
        ) : (
          items.map((p, i) => (
            <div key={`${p.assignor}-${p.assignee}-${i}`} className="text-xs">
              <span className="truncate">{p.assignor}</span>
              <span className="text-muted-foreground mx-1">→</span>
              <span className="truncate">{p.assignee}</span>
              <span className="tabular-nums text-muted-foreground ml-1">({formatNum(p.count)})</span>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function AlertsCard({ items }: { items: Alert[] }) {
  const variant = (type: string) => {
    if (type === "Spike") return "destructive"
    if (type === "New Entrant") return "default"
    return "secondary"
  }
  return (
    <Card className="p-4">
      <h5 className="text-sm font-semibold text-foreground mb-2">Alerts</h5>
      <p className="text-xs text-muted-foreground mb-3">Rules-based (Spike, New Entrant, Concentration)</p>
      <div className="space-y-2 max-h-48 overflow-auto">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No alerts</p>
        ) : (
          items.map((a, i) => (
            <div key={`${a.firm}-${a.type}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={variant(a.type) as "default" | "secondary" | "destructive"} className="text-[10px]">
                {a.type}
              </Badge>
              <span className="font-medium">{a.firm}</span>
              <span className="text-muted-foreground">{a.message}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch") return true
  return err instanceof Error && err.message?.toLowerCase().includes("failed to fetch")
}

export function ParticipantExecutiveSnapshot() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<ParticipantActivitySummary | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [category, setCategory] = useState("")

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError(undefined)
      try {
        const data = await fetchParticipantActivitySummary({
          watchlistOnly,
          category: category || undefined,
        })
        if (mounted) {
          setSummary(data)
          setError(undefined)
        }
      } catch (err) {
        if (mounted) {
          setSummary(undefined)
          setError(
            isNetworkError(err)
              ? "Unable to connect. Ensure the dev server is running (npm run dev) and refresh."
              : err instanceof Error
                ? err.message
                : "Failed to load snapshot."
          )
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [watchlistOnly, category])

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Executive Snapshot (Lane C)</h3>
          <p className="text-sm text-muted-foreground">
            Who is actively acquiring, what changed in 30/90 days, new entrants, strengthening relationships.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={watchlistOnly}
              onChange={(e) => setWatchlistOnly(e.target.checked)}
              className="rounded border-border"
            />
            Watchlist Only
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value || "all"} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading snapshot…</p>
      ) : error ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">{error}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <TopMoversCard
            items={summary?.topMovers30d ?? []}
            title="Top Movers (30d)"
            period="Highest net & total"
          />
          <TopMoversCard
            items={summary?.topMovers90d ?? []}
            title="Top Movers (90d)"
            period="Highest net & total"
          />
          <NewEntrantsCard items={summary?.newEntrants90d ?? []} />
          <TopPairsCard items={summary?.topPairs90d ?? []} />
          <AlertsCard items={summary?.alerts ?? []} />
        </div>
      )}

      {summary?.notes?.length ? (
        <div className="mt-3 text-xs text-muted-foreground">{summary.notes.join(" ")}</div>
      ) : null}
    </Card>
  )
}
