"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertTriangle,
  BookOpen,
  ExternalLink,
  Gavel,
  Landmark,
  Scale,
  ShieldAlert,
} from "lucide-react"
import {
  fetchLegalUpdates,
  type LegalItem,
  type LegalUpdatesResponse,
} from "@/app/actions/fetch-legal-updates"

// ── Section config ─────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    key: "regulatory" as const,
    label: "Regulatory Watch",
    description: "OCC, FDIC, Fed, CFPB, Florida OFR rule proposals & final rules affecting CRE lending and servicing",
    Icon: Landmark,
    color: "text-[#006D95]",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    key: "legislative" as const,
    label: "Legislative Tracker",
    description: "Florida and federal bills with active movement affecting foreclosure, lending, property rights, and CRE",
    Icon: BookOpen,
    color: "text-violet-600",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
  },
  {
    key: "enforcement" as const,
    label: "Enforcement & Litigation",
    description: "Bank enforcement actions, major CRE bankruptcies, court receiverships, and lender liability cases",
    Icon: ShieldAlert,
    color: "text-rose-600",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
  },
]

// ── Jurisdiction badge colors ──────────────────────────────────────────────────

function JurisdictionBadge({ jurisdiction }: { jurisdiction: LegalItem["jurisdiction"] }) {
  const map: Record<LegalItem["jurisdiction"], string> = {
    Federal: "bg-slate-100 text-slate-600 border-slate-200",
    Florida: "bg-teal-50 text-teal-700 border-teal-200",
    "Multi-State": "bg-amber-50 text-amber-700 border-amber-200",
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${map[jurisdiction]}`}>
      {jurisdiction}
    </span>
  )
}

// ── Single card ────────────────────────────────────────────────────────────────

function LegalCard({ item, sectionKey }: { item: LegalItem; sectionKey: typeof SECTIONS[number]["key"] }) {
  const section = SECTIONS.find((s) => s.key === sectionKey)!

  return (
    <Card className="bg-white border-slate-200 p-4 space-y-3">
      {/* Top row: badges + date */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${section.badgeClass}`}>
          {section.label}
        </span>
        <JurisdictionBadge jurisdiction={item.jurisdiction} />
        {item.status && (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
            {item.status}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">{item.date}</span>
      </div>

      {/* Title */}
      <div>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-start gap-1.5 text-sm font-semibold text-slate-800 hover:text-[#006D95]"
          >
            {item.title}
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 opacity-50 group-hover:opacity-100" />
          </a>
        ) : (
          <h3 className="text-sm font-semibold text-slate-800">{item.title}</h3>
        )}
        {item.source && (
          <p className="text-xs text-slate-500 mt-0.5">{item.source}</p>
        )}
      </div>

      {/* Summary */}
      {item.summary && (
        <p className="text-sm text-slate-600 leading-relaxed">{item.summary}</p>
      )}

      {/* Why It Matters callout */}
      {item.whyItMatters && (
        <div className="flex items-start gap-2.5 rounded-lg bg-teal-50 border border-teal-100 px-3 py-2.5">
          <Gavel className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#006D95]" />
          <p className="text-xs text-teal-900 leading-relaxed">
            <span className="font-semibold">Why it matters: </span>
            {item.whyItMatters}
          </p>
        </div>
      )}
    </Card>
  )
}

// ── Skeleton loader ────────────────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-4 space-y-3 bg-white border-slate-200">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full ml-auto" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="rounded-lg bg-teal-50 px-3 py-2.5 space-y-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type ActiveSection = "all" | "regulatory" | "legislative" | "enforcement"
type ActiveJurisdiction = "all" | "Federal" | "Florida" | "Multi-State"

export function LegalUpdates() {
  const [data, setData] = useState<LegalUpdatesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<ActiveSection>("all")
  const [activeJurisdiction, setActiveJurisdiction] = useState<ActiveJurisdiction>("all")

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetchLegalUpdates()
      .then((res) => { if (mounted) setData(res) })
      .catch(() => { if (mounted) setData({ items: [], generatedAt: new Date().toISOString(), notes: ["Failed to load legal intelligence."] }) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.items.filter((item) => {
      if (activeSection !== "all" && item.section !== activeSection) return false
      if (activeJurisdiction !== "all" && item.jurisdiction !== activeJurisdiction) return false
      return true
    })
  }, [data, activeSection, activeJurisdiction])

  // Group filtered items by section for display
  const grouped = useMemo(() => {
    const map: Record<string, LegalItem[]> = {}
    for (const item of filtered) {
      if (!map[item.section]) map[item.section] = []
      map[item.section].push(item)
    }
    return map
  }, [filtered])

  const sectionCounts = useMemo(() => {
    if (!data) return {}
    const counts: Record<string, number> = {}
    for (const item of data.items) {
      counts[item.section] = (counts[item.section] ?? 0) + 1
    }
    return counts
  }, [data])

  return (
    <div className="space-y-5">

      {/* Header */}
      <Card className="p-5 border-slate-200/80 bg-slate-50/30">
        <div className="flex items-start gap-3">
          <Scale className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#006D95]" />
          <div>
            <h2 className="text-base font-semibold text-slate-800">Legal Landscape Intelligence</h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Live regulatory, legislative, and enforcement intelligence relevant to distressed CRE debt investing — sourced via AI-assisted web search and updated each session.
            </p>
          </div>
        </div>
      </Card>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Section filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveSection("all")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeSection === "all"
                ? "bg-[#006D95] border-[#006D95] text-white"
                : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
            }`}
          >
            All sections
          </button>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activeSection === s.key
                  ? "bg-[#006D95] border-[#006D95] text-white"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
              }`}
            >
              {s.label}
              {sectionCounts[s.key] ? (
                <span className="ml-1 opacity-70">({sectionCounts[s.key]})</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Jurisdiction divider */}
        <div className="h-5 w-px bg-slate-200 mx-1 hidden sm:block" />

        {/* Jurisdiction filters */}
        {(["all", "Federal", "Florida", "Multi-State"] as const).map((j) => (
          <button
            key={j}
            onClick={() => setActiveJurisdiction(j)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeJurisdiction === j
                ? "bg-slate-700 border-slate-700 text-white"
                : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
            }`}
          >
            {j === "all" ? "All jurisdictions" : j}
          </button>
        ))}
      </div>

      {/* Notes / errors */}
      {data?.notes && data.notes.length > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <ul className="space-y-1">
              {data.notes.map((note, i) => (
                <li key={i} className="text-xs text-amber-800">{note}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <div key={s.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <s.Icon className={`h-4 w-4 ${s.color}`} />
                <Skeleton className="h-4 w-40" />
              </div>
              <SectionSkeleton />
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {!loading && (
        <>
          {filtered.length === 0 ? (
            <Card className="p-8 border-slate-200 bg-slate-50 text-center">
              <Scale className="mx-auto h-8 w-8 text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">No items match the selected filters.</p>
            </Card>
          ) : (
            <div className="space-y-8">
              {SECTIONS.filter((s) => grouped[s.key]?.length).map((section) => (
                <div key={section.key} className="space-y-3">
                  {/* Section heading */}
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <section.Icon className={`h-4 w-4 flex-shrink-0 ${section.color}`} />
                    <h3 className="text-sm font-semibold text-slate-800">{section.label}</h3>
                    <span className="text-xs text-slate-400">
                      {grouped[section.key].length} item{grouped[section.key].length !== 1 ? "s" : ""}
                    </span>
                    <p className="text-xs text-slate-400 hidden sm:block ml-1">— {section.description}</p>
                  </div>

                  {/* Cards */}
                  <div className="space-y-3">
                    {grouped[section.key].map((item) => (
                      <LegalCard key={item.id} item={item} sectionKey={section.key} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Generated timestamp */}
      {data && !loading && (
        <p className="text-xs text-slate-400 text-right">
          Intelligence sourced {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}
