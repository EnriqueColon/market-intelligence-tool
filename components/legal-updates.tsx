"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ExternalLink, Scale } from "lucide-react"
import { fetchLegalUpdates, type LegalUpdate, type LegalUpdatesResponse } from "@/app/actions/fetch-legal-updates"

type JurisdictionFilter = "all" | "Federal" | "Florida"
type CategoryFilter = "all" | "Bill" | "Rule"

const JURISDICTION_OPTIONS: { value: JurisdictionFilter; label: string }[] = [
  { value: "all", label: "All jurisdictions" },
  { value: "Federal", label: "Federal" },
  { value: "Florida", label: "Florida" },
]

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "Bill", label: "Bills" },
  { value: "Rule", label: "Rules" },
]

export function LegalUpdates() {
  const [updates, setUpdates] = useState<LegalUpdate[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [jurisdiction, setJurisdiction] = useState<JurisdictionFilter>("all")
  const [category, setCategory] = useState<CategoryFilter>("all")

  useEffect(() => {
    let mounted = true

    async function loadUpdates() {
      setLoading(true)
      try {
        const response: LegalUpdatesResponse = await fetchLegalUpdates()
        if (!mounted) return
        setUpdates(response.updates)
        setNotes(response.notes)
      } catch (err) {
        if (!mounted) return
        const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
        setUpdates([])
        setNotes([`Failed to load legal updates: ${message}`])
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadUpdates()
    return () => {
      mounted = false
    }
  }, [])

  const filteredUpdates = useMemo(() => {
    return updates.filter((update) => {
      if (jurisdiction !== "all" && update.jurisdiction !== jurisdiction) return false
      if (category !== "all" && update.category !== category) return false
      return true
    })
  }, [updates, jurisdiction, category])

  return (
    <div className="space-y-4">
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-[#006D95]" />
              <h2 className="text-base font-semibold text-slate-800">Legal Updates</h2>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Federal and Florida legislative and regulatory updates relevant to CRE distressed debt.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value as JurisdictionFilter)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800"
            >
              {JURISDICTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as CategoryFilter)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {notes.length > 0 && (
        <Card className="p-4 border-dashed border-slate-200/80 bg-slate-50/30">
          <ul className="text-sm text-slate-600 space-y-1">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
      )}

      {loading ? (
        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <div className="space-y-2">
            <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
          </div>
        </Card>
      ) : filteredUpdates.length === 0 ? (
        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <p className="text-sm text-slate-600">No legal updates matched these filters.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredUpdates.map((update) => (
            <Card key={update.id} className="p-4 bg-white border-slate-200">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{update.jurisdiction}</Badge>
                    <Badge variant="outline">{update.category}</Badge>
                    {update.billNumber && update.url ? (
                      <a
                        href={update.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-slate-600 hover:text-primary"
                      >
                        <Badge variant="outline">{update.billNumber}</Badge>
                      </a>
                    ) : (
                      update.billNumber && <Badge variant="outline">{update.billNumber}</Badge>
                    )}
                    <span className="text-xs text-slate-600">{update.source}</span>
                    {update.date && (
                      <span className="text-xs text-slate-600">{update.date}</span>
                    )}
                  </div>
                  {update.url ? (
                    <a
                      href={update.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base font-semibold text-slate-800 hover:text-primary"
                    >
                      {update.title}
                    </a>
                  ) : (
                    <h3 className="text-base font-semibold text-slate-800">{update.title}</h3>
                  )}
                  {update.summary && (
                    <p className="text-sm text-slate-600 line-clamp-3">{update.summary}</p>
                  )}
                  {update.status && (
                    <p className="text-xs text-slate-600">Latest action: {update.status}</p>
                  )}
                </div>
                {update.url && (
                  <ExternalLink className="h-4 w-4 text-slate-600" />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
