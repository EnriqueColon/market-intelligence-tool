"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, Search, Bot } from "lucide-react"
import {
  PROPERTY_TYPES,
  REGIONS,
  COUNTRIES,
  MARKET_OPTIONS,
  INSIGHTS_TOPICS,
  CBRE_MARKET_REPORTS,
  CBRE_INSIGHTS,
  type PropertyType,
} from "@/lib/cbre-options"
import { buildCbreLinks, type CbreLinkCandidate, type CbreQuery, type CbreTab } from "@/lib/cbre-link-builder"
import type { ReportEntry } from "@/app/data/market-research-reports"

interface CbreFindDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  report?: ReportEntry | null
  isVercel?: boolean
}

const DEFAULT_QUERY: CbreQuery = {
  tab: "market-reports",
  geographyLevel: "national",
  geographyValue: "",
  propertyType: "office",
  reportType: "market-outlook",
  timePreference: "most-recent",
  region: "",
  country: "",
  market: "",
  topic: "",
  keyword: "",
}

function getDirectReportUrl(report: ReportEntry | null | undefined): string | null {
  if (!report) return null
  const url = report.url || report.pdfUrl || ""
  return url.toLowerCase().includes("cbre.com") ? url : null
}

export function CbreFindDialog({ open, onOpenChange, report, isVercel = false }: CbreFindDialogProps) {
  const [query, setQuery] = useState<CbreQuery>(DEFAULT_QUERY)
  const [results, setResults] = useState<CbreLinkCandidate[] | null>(null)
  const [automating, setAutomating] = useState(false)
  const [automateError, setAutomateError] = useState<string | null>(null)

  const directReportUrl = getDirectReportUrl(report)
  const bestMatch = buildCbreLinks(query, { directReportUrl })[0]

  const updateQuery = (updates: Partial<CbreQuery>) => {
    setQuery((q) => ({ ...q, ...updates }))
  }

  const updateTab = (tab: CbreTab) => {
    updateQuery({ tab })
  }

  useEffect(() => {
    if (open) {
      setResults(buildCbreLinks(query, { directReportUrl }))
    }
  }, [open, directReportUrl, query])

  const handleGenerateLinks = () => {
    setResults(buildCbreLinks(query, { directReportUrl }))
  }

  const handleOpenBestMatch = () => {
    const best = buildCbreLinks(query, { directReportUrl })[0]
    if (best?.url) window.open(best.url, "_blank", "noopener,noreferrer")
  }

  const handleOpenSection = () => {
    const url = query.tab === "market-reports" ? CBRE_MARKET_REPORTS : CBRE_INSIGHTS
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const handleReset = () => {
    setQuery(DEFAULT_QUERY)
    setResults(null)
    setAutomateError(null)
  }

  const handleOpenWithAutomation = async () => {
    setAutomating(true)
    setAutomateError(null)
    try {
      const res = await fetch("/api/cbre-automate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab: query.tab,
          propertyType: query.propertyType !== "all" ? query.propertyType : undefined,
          region: query.region || undefined,
          country: query.country || undefined,
          market: query.market || undefined,
          topic: query.topic || undefined,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || "Automation failed")
      }
    } catch (e) {
      setAutomateError((e as Error).message)
    } finally {
      setAutomating(false)
    }
  }

  const confidenceVariant = (c: "High" | "Medium" | "Low") =>
    c === "High" ? "default" : c === "Medium" ? "secondary" : "outline"

  const FilterSelect = ({
    label,
    value,
    options,
    onChange,
    size,
  }: {
    label: string
    value: string
    options: readonly { value: string; label: string }[]
    onChange: (value: string) => void
    size?: number
  }) => (
    <div className="space-y-2.5">
      <label className="text-sm font-medium !text-[#FFFFFF]">{label}</label>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setResults(null)
        }}
        size={size}
        className={`w-full rounded-md border !border-[#FFFFFF] !bg-[#FFFFFF]/10 !text-[#FFFFFF] px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#FFFFFF]/50 focus:outline-none focus:!border-[#FFFFFF] [&>option]:bg-[#006D95] [&>option]:text-[#FFFFFF] ${size ? "" : "min-h-[2.5rem]"}`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl max-h-[90vh] overflow-hidden flex flex-col !border-2 !border-[#006D95] !bg-[#006D95] [&_[data-slot=dialog-close]]:!text-white [&_[data-slot=dialog-close]]:hover:!text-white [&_[data-slot=dialog-close]_svg]:!text-white"
      >
        <div className="flex flex-col flex-1 min-h-0 !text-[#FFFFFF]">
        <DialogHeader className="shrink-0 pb-2">
          <DialogTitle className="!text-[#FFFFFF]">Find on CBRE</DialogTitle>
          <DialogDescription className="!text-[#FFFFFF] opacity-95">
            {directReportUrl && report ? (
              <>Finding: <strong>{report.title}</strong>. Select filters to match CBRE&apos;s Market Reports and Insights sections.</>
            ) : (
              "Select filters aligned with CBRE&apos;s Property Type, Region, Country, Market, and Topic. Links open on CBRE.com."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        <Tabs
          value={query.tab}
          onValueChange={(v) => updateTab(v as CbreTab)}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="grid w-full grid-cols-2 !border !border-[#FFFFFF] !bg-[#FFFFFF]/15">
            <TabsTrigger
              value="market-reports"
              className="data-[state=active]:!bg-[#FFFFFF] data-[state=active]:!text-[#006D95] data-[state=inactive]:!text-[#FFFFFF]"
            >
              Market Reports
            </TabsTrigger>
            <TabsTrigger
              value="insights"
              className="data-[state=active]:!bg-[#FFFFFF] data-[state=active]:!text-[#006D95] data-[state=inactive]:!text-[#FFFFFF]"
            >
              Insights
            </TabsTrigger>
          </TabsList>

          <TabsContent value="market-reports" className="flex-1 mt-4 space-y-5 overflow-visible">
            {bestMatch?.url && (
              <div className="rounded-md border !border-[#FFFFFF] !bg-[#FFFFFF]/15 p-4">
                <p className="text-sm font-medium mb-3 !text-[#FFFFFF]">{bestMatch.title}</p>
                <Button
                  className="w-full gap-2 !bg-[#FFFFFF] !text-[#006D95] hover:!bg-[#FFFFFF]/90 !border-[#FFFFFF]"
                  onClick={() => window.open(bestMatch!.url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Market Reports
                </Button>
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <FilterSelect
                label="Property Type"
                value={query.propertyType}
                options={PROPERTY_TYPES}
                onChange={(v) => updateQuery({ propertyType: v as PropertyType })}
              />
              <FilterSelect
                label="Region"
                value={query.region}
                options={REGIONS}
                onChange={(v) => updateQuery({ region: v })}
              />
              <FilterSelect
                label="Country"
                value={query.country}
                options={COUNTRIES}
                onChange={(v) => updateQuery({ country: v })}
                size={5}
              />
              <FilterSelect
                label="Market"
                value={query.market}
                options={MARKET_OPTIONS}
                onChange={(v) => updateQuery({ market: v })}
                size={5}
              />
            </div>
          </TabsContent>

          <TabsContent value="insights" className="flex-1 mt-4 space-y-5 overflow-visible">
            {bestMatch?.url && (
              <div className="rounded-md border !border-[#FFFFFF] !bg-[#FFFFFF]/15 p-4">
                <p className="text-sm font-medium mb-3 !text-[#FFFFFF]">{bestMatch.title}</p>
                <Button
                  className="w-full gap-2 !bg-[#FFFFFF] !text-[#006D95] hover:!bg-[#FFFFFF]/90 !border-[#FFFFFF]"
                  onClick={() => window.open(bestMatch!.url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Insights
                </Button>
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <FilterSelect
                label="Property Type"
                value={query.propertyType}
                options={PROPERTY_TYPES}
                onChange={(v) => updateQuery({ propertyType: v as PropertyType })}
              />
              <FilterSelect
                label="Region"
                value={query.region}
                options={REGIONS}
                onChange={(v) => updateQuery({ region: v })}
              />
              <FilterSelect
                label="Country"
                value={query.country}
                options={COUNTRIES}
                onChange={(v) => updateQuery({ country: v })}
                size={5}
              />
              <FilterSelect
                label="Market"
                value={query.market}
                options={MARKET_OPTIONS}
                onChange={(v) => updateQuery({ market: v })}
                size={5}
              />
              <FilterSelect
                label="Topic"
                value={query.topic}
                options={INSIGHTS_TOPICS}
                onChange={(v) => updateQuery({ topic: v })}
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-2.5 pt-4 shrink-0">
          <label className="text-sm font-medium !text-[#FFFFFF]">Optional Keyword</label>
          <input
            type="text"
            value={query.keyword ?? ""}
            onChange={(e) => updateQuery({ keyword: e.target.value })}
            placeholder="e.g. cap rates, distress"
            className="w-full rounded-md border !border-[#FFFFFF] !bg-[#FFFFFF]/10 !text-[#FFFFFF] placeholder:!text-[#FFFFFF]/60 px-3 py-2 text-sm focus:ring-2 focus:ring-[#FFFFFF]/50 focus:outline-none focus:!border-[#FFFFFF]"
          />
        </div>

        <div className="flex flex-wrap gap-3 pt-4">
          <Button
            onClick={handleGenerateLinks}
            className="gap-2 !bg-[#FFFFFF] !text-[#006D95] hover:!bg-[#FFFFFF]/90 !border-[#FFFFFF]"
          >
            <Search className="h-4 w-4" />
            Generate Links
          </Button>
          <Button
            onClick={handleOpenBestMatch}
            className="gap-2 !bg-[#FFFFFF] !text-[#006D95] hover:!bg-[#FFFFFF]/90 !border-[#FFFFFF]"
          >
            <ExternalLink className="h-4 w-4" />
            Open Best Match
          </Button>
          {!isVercel ? (
            <Button
              onClick={handleOpenWithAutomation}
              disabled={automating}
              className="gap-2 !bg-[#FFFFFF] !text-[#006D95] hover:!bg-[#FFFFFF]/90 !border-[#FFFFFF]"
              title="Opens a browser on your machine, navigates to CBRE, and applies your selected filters. Requires local dev server."
            >
              <Bot className="h-4 w-4" />
              {automating ? "Starting…" : "Open CBRE & Apply Filters"}
            </Button>
          ) : (
            <span className="inline-flex items-center rounded-md border !border-[#FFFFFF] px-3 py-2 text-xs !text-[#FFFFFF]">
              Local-only automation
            </span>
          )}
          <Button
            variant="outline"
            onClick={handleOpenSection}
            className="gap-2 !border-[#FFFFFF] !text-[#FFFFFF] hover:!bg-[#FFFFFF]/15"
          >
            Open CBRE {query.tab === "market-reports" ? "Market Reports" : "Insights"}
          </Button>
          {(results?.length ?? 0) > 0 && (
            <Button
              variant="ghost"
              onClick={handleReset}
              className="!text-[#FFFFFF] hover:!bg-[#FFFFFF]/15"
            >
              Reset
            </Button>
          )}
        </div>

        {automateError && (
          <p className="text-sm !text-red-200 pt-2">
            {automateError}
          </p>
        )}
        {results && results.length > 0 && (
          <div className="space-y-3 pt-2 border-t !border-[#FFFFFF]">
            <p className="text-sm font-medium !text-[#FFFFFF]">Generated Links</p>
            <ul className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {results.map((r, idx) => (
                <li
                  key={`${r.url}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-md border !border-[#FFFFFF] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate !text-[#FFFFFF]">{r.title}</p>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline truncate block !text-[#FFFFFF] hover:!text-[#FFFFFF]/80"
                    >
                      {r.url}
                    </a>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={confidenceVariant(r.confidence)}
                      className={`text-[10px] ${
                        r.confidence === "High"
                          ? "!bg-[#FFFFFF] !text-[#006D95] !border-[#FFFFFF]"
                          : r.confidence === "Medium"
                            ? "!bg-[#FFFFFF]/30 !text-[#FFFFFF] !border-[#FFFFFF]"
                            : "!bg-transparent !text-[#FFFFFF] !border-[#FFFFFF]"
                      }`}
                    >
                      {r.confidence}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 !text-[#FFFFFF] hover:!bg-[#FFFFFF]/15"
                      onClick={() => window.open(r.url, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs !text-[#FFFFFF] opacity-90">
              Links open CBRE. Apply filters on CBRE if needed.
            </p>
          </div>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
