"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  searchParticipantFirms,
  loadParticipantProfile,
  loadParticipantProfileFromWatchlist,
  type ParticipantCandidate,
  type FirmProfile,
} from "@/app/actions/participant-lookup"
import { fetchWatchlistFirms } from "@/app/actions/fetch-watchlist"

const DEBOUNCE_MS = 300

export function ParticipantLookup({
  onProfileLoaded,
}: {
  onProfileLoaded: (profile: FirmProfile) => void
}) {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<ParticipantCandidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<ParticipantCandidate | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [watchlistFirms, setWatchlistFirms] = useState<Array<{ canonical_name: string; category: string }>>([])
  const [watchlistSelected, setWatchlistSelected] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true
    fetchWatchlistFirms()
      .then((list) => {
        if (mounted) setWatchlistFirms(list)
      })
      .catch(() => {
        if (mounted) setWatchlistFirms([])
      })
    return () => {
      mounted = false
    }
  }, [])

  const fetchSuggestions = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setSuggestions([])
      setNotes([])
      return
    }
    setSearchLoading(true)
    try {
      const result = await searchParticipantFirms(trimmed)
      setSuggestions(result.candidates)
      setNotes(result.notes)
    } catch {
      setSuggestions([])
      setNotes(["Search failed."])
    } finally {
      setSearchLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(query)
      debounceRef.current = null
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, fetchSuggestions])

  const handleLoadProfile = async (candidate?: ParticipantCandidate | null) => {
    const toLoad = candidate ?? selectedCandidate ?? (query.trim() ? { canonicalName: query.trim(), aliasText: query.trim(), confidence: 0.5, source: "aom" as const } : null)
    if (!toLoad) {
      setNotes(["Enter a firm name or select from the list below."])
      return
    }
    setProfileLoading(true)
    setNotes([])
    try {
      const idOrName = toLoad.firmId != null ? String(toLoad.firmId) : toLoad.canonicalName
      const profile = await loadParticipantProfile(idOrName)
      if (profile.error) {
        setNotes([profile.error])
      } else {
        onProfileLoaded(profile)
        setSelectedCandidate(toLoad)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Load failed"
      setNotes([msg])
    } finally {
      setProfileLoading(false)
    }
  }

  const handleSelectCandidate = (c: ParticipantCandidate) => {
    setSelectedCandidate(c)
    setQuery(c.aliasText)
  }

  const handleWatchlistSelect = async (name: string) => {
    setWatchlistSelected(name)
    setQuery(name)
    setSelectedCandidate(null)
    setProfileLoading(true)
    setNotes([])
    try {
      const profile = await loadParticipantProfileFromWatchlist(name)
      onProfileLoaded(profile)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Load failed"
      setNotes([msg])
    } finally {
      setProfileLoading(false)
    }
  }

  return (
    <Card className="p-6">
      <h4 className="text-sm font-semibold text-foreground mb-1">Participant Lookup</h4>
      <p className="text-xs text-muted-foreground mb-3">
        Search for a firm or market participant by name. Load profile to see AOM metrics, aliases, and affiliated entities.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {watchlistFirms.length > 0 && (
          <select
            value={watchlistSelected}
            onChange={(e) => {
              const v = e.target.value
              setWatchlistSelected(v)
              if (v) handleWatchlistSelect(v)
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground min-w-[180px]"
            title="Select from watchlist to auto-load profile"
          >
            <option value="">Watchlist…</option>
            {watchlistFirms.map((f) => (
              <option key={f.canonical_name} value={f.canonical_name}>
                {f.canonical_name}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1 min-w-[200px]">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedCandidate(null)
              setWatchlistSelected("")
            }}
            placeholder="e.g. Rialto, NewRez, Wilmington Savings"
            className="w-full"
          />
        </div>
        <Button
          onClick={() => handleLoadProfile()}
          disabled={profileLoading || (!query.trim() && !selectedCandidate)}
        >
          {profileLoading ? "Loading…" : "Load Profile"}
        </Button>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Matching participants (click to load profile)</p>
          <div className="rounded-md border border-border bg-muted/30 max-h-48 overflow-auto">
            {suggestions.map((c, i) => (
              <button
                key={`${c.canonicalName}-${c.aliasText}-${i}`}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/70 border-b border-border last:border-b-0 flex items-center justify-between gap-2 ${
                  selectedCandidate?.aliasText === c.aliasText ? "bg-primary/10 font-medium" : ""
                }`}
                onClick={() => {
                  handleSelectCandidate(c)
                  handleLoadProfile(c)
                }}
              >
                <span className="truncate">{c.aliasText}</span>
                {c.confidence < 1 && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {Math.round(c.confidence * 100)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{notes.join(" ")}</p>
      )}
      {searchLoading && (
        <p className="mt-2 text-xs text-muted-foreground">Searching…</p>
      )}
    </Card>
  )
}
