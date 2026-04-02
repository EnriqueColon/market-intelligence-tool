"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Search, X, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { fetchEntityProfile } from "@/lib/participants-intel/services"
import { searchEntities } from "@/lib/participants-intel/services"
import type { EntityProfileRecord, SearchEntityResult } from "@/lib/participants-intel/types"

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n)
}

function pctFmt(n: number) {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}%`
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-white border border-slate-200 rounded-xl px-4 py-3 min-w-[120px]">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${accent ?? "text-slate-800"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

// ─── Profile card ─────────────────────────────────────────────────────────────

function EntityProfileCard({ profile }: { profile: EntityProfileRecord }) {
  const maxDeals = Math.max(...profile.topAssignors.map((a) => a.deals), 1)

  return (
    <div className="space-y-6 mt-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h4 className="text-base font-bold text-slate-800">{profile.name}</h4>
          {profile.lenderType && (
            <span className="text-[11px] text-slate-500">{profile.lenderType}</span>
          )}
        </div>
        {profile.aomRank != null && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            FL AOM Rank #{profile.aomRank}
          </span>
        )}
      </div>

      {/* KPI tiles */}
      <div className="flex flex-wrap gap-3">
        <StatTile
          label="AOMs Acquired"
          value={profile.aomsBought.toString()}
          sub="FL assignments received"
        />
        <StatTile
          label="Total Volume"
          value={profile.volumeBought > 0 ? compact(profile.volumeBought) : "—"}
          sub="mortgage principal acquired"
        />
        <StatTile
          label="Avg Deal Size"
          value={profile.avgDealSizeBought > 0 ? compact(profile.avgDealSizeBought) : "—"}
          sub="per assignment"
        />
        {profile.percentChange !== 0 && (
          <StatTile
            label="Momentum"
            value={pctFmt(profile.percentChange)}
            sub="vs prior period"
            accent={profile.percentChange > 0 ? "text-emerald-600" : "text-rose-600"}
          />
        )}
      </div>

      {/* Assignors breakdown */}
      {profile.topAssignors.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">
            Paper Received From — Top Assignors
          </h5>
          <div className="space-y-2">
            {profile.topAssignors.map((a) => {
              const barPct = (a.deals / maxDeals) * 100
              return (
                <div key={a.name} className="flex items-center gap-3">
                  <div className="w-56 shrink-0 text-xs font-medium text-slate-700 truncate" title={a.name}>{a.name}</div>
                  <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                    <div className="h-full bg-blue-400/60 rounded transition-all" style={{ width: `${Math.max(barPct, 2)}%` }} />
                  </div>
                  <div className="w-16 text-right text-xs tabular-nums text-slate-700 font-medium shrink-0">
                    {a.deals} AOM{a.deals !== 1 ? "s" : ""}
                  </div>
                  <div className="w-16 text-right text-xs tabular-nums text-slate-400 shrink-0">
                    {a.amount > 0 ? compact(a.amount) : "—"}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent deals */}
      {profile.recentDeals.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">
            Recent FL AOM Activity
          </h5>
          <div className="rounded-lg border border-slate-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Date</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Assigned From</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-500">Amount</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">County</th>
                </tr>
              </thead>
              <tbody>
                {profile.recentDeals.map((d, i) => (
                  <tr key={d.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-3 py-2 tabular-nums text-slate-500 whitespace-nowrap">{d.date || "—"}</td>
                    <td className="px-3 py-2 text-slate-700 font-medium max-w-[200px] truncate" title={d.counterparty}>{d.counterparty}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{d.amount && d.amount > 0 ? compact(d.amount) : "—"}</td>
                    <td className="px-3 py-2 text-slate-400 max-w-[140px] truncate">{d.county || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SectionEntitySearch() {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<SearchEntityResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState<SearchEntityResult | null>(null)
  const [profile, setProfile] = useState<EntityProfileRecord | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounced suggestion fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    setLoadingSuggestions(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchEntities(query.trim())
        setSuggestions(results.slice(0, 8))
        setShowSuggestions(results.length > 0)
      } catch {
        setSuggestions([])
      } finally {
        setLoadingSuggestions(false)
      }
    }, 380)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Dismiss dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const selectEntity = useCallback(async (entity: SearchEntityResult) => {
    setSelectedEntity(entity)
    setQuery(entity.name)
    setShowSuggestions(false)
    setSuggestions([])
    setProfile(null)
    setProfileError(null)
    setLoadingProfile(true)
    try {
      const payload = await fetchEntityProfile(entity.id, entity.name)
      if (payload.items.length > 0) {
        setProfile(payload.items[0])
      } else {
        setProfileError(`No Florida AOM activity found for "${entity.name}". This entity may operate outside FL or under a different registered name.`)
      }
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Failed to load entity profile.")
    } finally {
      setLoadingProfile(false)
    }
  }, [])

  const clearSearch = useCallback(() => {
    setQuery("")
    setSuggestions([])
    setShowSuggestions(false)
    setSelectedEntity(null)
    setProfile(null)
    setProfileError(null)
  }, [])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30 space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-slate-800">Entity Intelligence Search</h3>
        <p className="text-xs text-slate-500 mt-1">
          Search any firm, competitor, or lender to see their Florida AOM activity, deal flow, and sourcing relationships.
        </p>
      </div>

      {/* Search input */}
      <div ref={containerRef} className="relative max-w-lg">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (selectedEntity && e.target.value !== selectedEntity.name) {
                setSelectedEntity(null)
                setProfile(null)
                setProfileError(null)
              }
            }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
            placeholder="Search for a firm, lender, or competitor…"
            className="pl-9 pr-9 bg-white border-slate-200 focus-visible:ring-blue-500 text-sm"
          />
          {(query || loadingSuggestions) && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {loadingSuggestions
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <X className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
            {suggestions.map((s) => (
              <button
                key={s.id}
                className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0"
                onMouseDown={(e) => { e.preventDefault(); selectEntity(s) }}
              >
                <div className="font-medium text-slate-800 text-sm">{s.name}</div>
                {s.location && <div className="text-[11px] text-slate-400 mt-0.5">{s.location}</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading state */}
      {loadingProfile && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          Loading activity for <span className="font-medium text-slate-700">{selectedEntity?.name}</span>…
        </div>
      )}

      {/* Error state */}
      {profileError && !loadingProfile && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          {profileError}
        </div>
      )}

      {/* Profile result */}
      {profile && !loadingProfile && (
        <EntityProfileCard profile={profile} />
      )}

      {/* Empty / prompt state */}
      {!query && !profile && !loadingProfile && (
        <div className="py-6 text-center text-sm text-slate-400">
          Try searching for <span className="font-medium text-slate-500">Rialto</span>, <span className="font-medium text-slate-500">Ares</span>, <span className="font-medium text-slate-500">Fortress</span>, or any active FL lender
        </div>
      )}
    </Card>
  )
}
