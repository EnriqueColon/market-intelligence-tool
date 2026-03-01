 "use client"
 
 import { useEffect, useState } from "react"
 import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronDown, ChevronRight } from "lucide-react"
import {
  fetchMarketResearch,
  type ResearchMetric,
  type ResearchSection,
} from "@/app/actions/fetch-market-research"
 
 const percentFormatter = new Intl.NumberFormat("en-US", {
   style: "percent",
   minimumFractionDigits: 1,
   maximumFractionDigits: 1,
 })
 
 const numberFormatter = new Intl.NumberFormat("en-US", {
   maximumFractionDigits: 0,
 })
 
 const indexFormatter = new Intl.NumberFormat("en-US", {
   maximumFractionDigits: 1,
 })

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const currencySmallFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
 
function formatValue(value?: number, unit?: string, note?: string) {
   if (value === undefined || Number.isNaN(value)) return "—"
  const scaled =
    unit === "units" && note?.toLowerCase().includes("thousands of units") ? value * 1000 : value
   if (unit === "percent") return percentFormatter.format(value / 100)
   if (unit === "index") return indexFormatter.format(value)
  if (unit === "currency") {
    if (Math.abs(scaled) < 1000) return currencySmallFormatter.format(scaled)
    return currencyFormatter.format(scaled)
  }
  return numberFormatter.format(scaled)
 }
 
function formatDelta(change?: number, unit?: string, note?: string) {
   if (change === undefined || Number.isNaN(change)) return "—"
   const sign = change > 0 ? "+" : ""
  const scaled =
    unit === "units" && note?.toLowerCase().includes("thousands of units") ? change * 1000 : change
   if (unit === "percent") return `${sign}${percentFormatter.format(change / 100)}`
  if (unit === "currency") {
    const formatted =
      Math.abs(scaled) < 1000 ? currencySmallFormatter.format(scaled) : currencyFormatter.format(scaled)
    return `${sign}${formatted}`
  }
  return `${sign}${numberFormatter.format(scaled)}`
 }

function formatDateLabel(value?: string) {
  if (!value) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-")
    return `${year}-${month}`
  }
  return value
}

function getRecentPoints(points?: { date: string; value: number }[], count = 4) {
  if (!points || points.length === 0) return []
  return points.slice(-count)
}

function groupMetricsByCategory(metrics: ResearchMetric[]) {
  return metrics.reduce<Record<string, ResearchMetric[]>>((acc, metric) => {
    const key = metric.category || "Other"
    acc[key] = acc[key] ? [...acc[key], metric] : [metric]
    return acc
  }, {})
}

function Sparkline({
  points,
  width = 120,
  height = 32,
  showAxisLabels = false,
  unit,
}: {
  points?: { date: string; value: number }[]
  width?: number
  height?: number
  showAxisLabels?: boolean
  unit?: string
}) {
  const values = points?.map((point) => point.value).filter((value) => Number.isFinite(value)) || []
  if (values.length < 2) {
    return <div className="text-[11px] text-slate-600">No trend</div>
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = width / (values.length - 1)
  const startLabel = formatDateLabel(points?.[0]?.date)
  const endLabel = formatDateLabel(points && points.length ? points[points.length - 1]?.date : undefined)
  const line = values
    .map((value, index) => {
      const x = index * step
      const y = height - ((value - min) / range) * height
      return `${x},${y}`
    })
    .join(" ")
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[10px] text-slate-600">
        {showAxisLabels && (
          <div className="flex h-full flex-col justify-between">
            <span>{formatValue(max, unit)}</span>
            <span>{formatValue(min, unit)}</span>
          </div>
        )}
        <svg width={width} height={height} className="text-primary">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={line}
          />
        </svg>
      </div>
      {showAxisLabels && (
        <div className="flex justify-between text-[10px] text-slate-600">
          <span>{startLabel || "Start"}</span>
          <span>{endLabel || "End"}</span>
        </div>
      )}
    </div>
  )
}
 
export function MarketResearch({ level }: { level?: "national" | "florida" | "miami" }) {
   const [sections, setSections] = useState<ResearchSection[]>([])
  const [loading, setLoading] = useState(true)
  const [geo, setGeo] = useState<"national" | "florida">("national")
  const [errorNote, setErrorNote] = useState<string | undefined>()

  useEffect(() => {
    if (!level) return
    setGeo(level === "miami" ? "national" : level)
  }, [level])

  const sourceLabel =
    geo === "national"
      ? "FHFA/FRED (National)"
      : "FHFA/FRED (National proxy for Florida)"
 
   useEffect(() => {
     let mounted = true
     async function loadData() {
       setLoading(true)
      setErrorNote(undefined)
      try {
        const data = await fetchMarketResearch()
        if (!mounted) return
        setSections(Array.isArray(data) ? data : [])
      } catch {
        if (!mounted) return
        setSections([])
        setErrorNote("Unable to reach public data sources right now. Check network/DNS and refresh.")
      } finally {
        if (mounted) setLoading(false)
      }
     }
     loadData()
     return () => {
       mounted = false
     }
  }, [])

  const isEmpty = !loading && (sections ?? []).length === 0
  const [open, setOpen] = useState(false)

   return (
     <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 text-left hover:opacity-90 transition-opacity"
          >
            <div className="flex items-center gap-2">
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-600" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
              )}
              <div>
                <h3 className="text-base font-semibold text-slate-800">FHFA/FRED Data</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Public indicators only (no narrative). Florida uses National proxy where local free series are unavailable. Click to expand.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
              <select
                value={geo}
                onChange={(event) => setGeo(event.target.value as "national" | "florida")}
                className="rounded-md border border-slate-200 bg-background px-2 py-1 text-xs text-slate-800"
              >
                <option value="national">National</option>
                <option value="florida">Florida (National proxy)</option>
              </select>
              <p className="text-xs text-slate-600">Source: {sourceLabel}</p>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4">
      {errorNote && (
        <div className="mt-3 rounded-md border border-slate-200 px-3 py-2">
          <p className="text-xs text-slate-600">{errorNote}</p>
        </div>
      )}
      {isEmpty ? (
        <div className="mt-4 rounded-md border border-slate-200 p-4 text-sm text-slate-600">
          No market research data loaded.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {(sections ?? []).map((section) => {
            const activeMetrics = Array.isArray(section?.national) ? section.national : []
            if (activeMetrics.length === 0) return null
            const sources = Array.from(new Set(activeMetrics.map((metric) => metric.source).filter(Boolean))).join(", ")
            const grouped = groupMetricsByCategory(activeMetrics)
            const categoryOrder = ["Pricing", "Demand", "Supply", "Capital", "Other"]

            const pickMetric = (ids: string[]) => activeMetrics.find((metric) => ids.includes(metric.id))
            const priceMetric =
              section.id === "singleFamily"
                ? pickMetric([
                    "sfr_hpi_fhfa_us",
                    "sfr_hpi_fhfa_miami_msad",
                    "sfr_hpi_case_shiller_us",
                    "sfr_hpi_case_shiller_miami",
                  ]) ?? activeMetrics[0]
                : undefined
            const rateMetric =
              section.id === "singleFamily"
                ? pickMetric(["sfr_mortgage_rate_30y_us", "sfr_mortgage_rate_30y_us_proxy_miami"])
                : undefined
            const permitsMetric =
              section.id === "singleFamily"
                ? pickMetric(["sfr_permits_1f_us", "sfr_permits_1f_us_proxy_miami"])
                : undefined

            return (
              <div key={section.id} className="rounded-lg border border-slate-200 p-4 bg-white">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700">{section.title}</h4>
                    <p className="text-xs text-slate-600">{section.description}</p>
                    {section.id === "singleFamily" ? (
                      <p className="text-xs text-slate-600">
                        Residential indicators used as a proxy for pricing/liquidity and financing conditions that can spill into CRE.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-600">
                        Employment/activity indicators used as demand proxies. These are not direct vacancy, rent, or cap-rate measures.
                      </p>
                    )}
                    {section.subsectors?.length ? (
                      <p className="mt-1 text-[10px] text-slate-500">
                        Subsegments: {section.subsectors.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-600">Sources: {sources || "—"}</p>
                </div>

                {section.id === "singleFamily" && (
                  <>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {priceMetric ? (
                        <div className="rounded-md border border-slate-200 px-3 py-2">
                          <p className="text-[11px] text-slate-600">Price</p>
                          <p className="text-xs text-slate-600">{priceMetric.label}</p>
                          <p className="text-sm font-semibold text-slate-800">
                            {loading ? "…" : formatValue(priceMetric.value, priceMetric.unit, priceMetric.note)}
                          </p>
                          <p className="text-xs text-slate-600">
                            YoY: {loading ? "…" : formatDelta(priceMetric.change, priceMetric.unit, priceMetric.note)}{" "}
                            {priceMetric.date ? `(${formatDateLabel(priceMetric.date)})` : ""}
                          </p>
                          <p className="text-[11px] text-slate-600">Source: {priceMetric.source}</p>
                        </div>
                      ) : null}
                      {rateMetric ? (
                        <div className="rounded-md border border-slate-200 px-3 py-2">
                          <p className="text-[11px] text-slate-600">Capital</p>
                          <p className="text-xs text-slate-600">{rateMetric.label}</p>
                          <p className="text-xs text-slate-600">
                            National rate shown as a proxy for broader credit conditions; local commercial borrowing costs may differ.
                          </p>
                          <p className="text-sm font-semibold text-slate-800">
                            {loading ? "…" : formatValue(rateMetric.value, rateMetric.unit, rateMetric.note)}
                          </p>
                          <p className="text-xs text-slate-600">
                            Δ: {loading ? "…" : formatDelta(rateMetric.change, rateMetric.unit, rateMetric.note)}{" "}
                            {rateMetric.date ? `(${formatDateLabel(rateMetric.date)})` : ""}
                          </p>
                          <p className="text-[11px] text-slate-600">Source: {rateMetric.source}</p>
                        </div>
                      ) : null}
                      {permitsMetric ? (
                        <div className="rounded-md border border-slate-200 px-3 py-2">
                          <p className="text-[11px] text-slate-600">Supply</p>
                          <p className="text-xs text-slate-600">{permitsMetric.label}</p>
                          <p className="text-sm font-semibold text-slate-800">
                            {loading ? "…" : formatValue(permitsMetric.value, permitsMetric.unit, permitsMetric.note)}
                          </p>
                          <p className="text-xs text-slate-600">
                            YoY: {loading ? "…" : formatDelta(permitsMetric.change, permitsMetric.unit, permitsMetric.note)}{" "}
                            {permitsMetric.date ? `(${formatDateLabel(permitsMetric.date)})` : ""}
                          </p>
                          <p className="text-[11px] text-slate-600">Source: {permitsMetric.source}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 rounded-md border border-slate-200 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-600 uppercase">SFR Trend Panel</p>
                      <p className="text-[11px] text-slate-600">
                        Price + rate + permits in one view (public data).
                      </p>
                      <div className="mt-2 grid gap-3 md:grid-cols-3">
                        <div className="rounded-md border border-slate-200 px-3 py-2">
                          <p className="text-xs text-slate-600">{priceMetric?.label ?? "Price Index"}</p>
                          <Sparkline points={priceMetric?.history} showAxisLabels unit={priceMetric?.unit} width={160} />
                          <p className="mt-1 text-[11px] text-slate-600">Source: {priceMetric?.source ?? "—"}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 px-3 py-2">
                          <p className="text-xs text-slate-600">{rateMetric?.label ?? "Mortgage Rate"}</p>
                          <Sparkline points={rateMetric?.history} showAxisLabels unit={rateMetric?.unit} width={160} />
                          <p className="mt-1 text-[11px] text-slate-600">Source: {rateMetric?.source ?? "—"}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 px-3 py-2">
                          <p className="text-xs text-slate-600">{permitsMetric?.label ?? "Permits"}</p>
                          <Sparkline points={permitsMetric?.history} showAxisLabels unit={permitsMetric?.unit} width={160} />
                          <p className="mt-1 text-[11px] text-slate-600">Source: {permitsMetric?.source ?? "—"}</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="mt-3 space-y-3">
                  {categoryOrder.map((category) => {
                    const items = grouped[category]
                    if (!items || items.length === 0) return null
                    return (
                      <div key={category} className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-xs font-semibold text-slate-600 uppercase">{category}</p>
                        <div className="mt-2 grid gap-3 md:grid-cols-3">
                          {items.map((metric) => (
                            <div key={metric.id} className="rounded-md border border-slate-200 px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-slate-600">{metric.label}</p>
                                <Sparkline points={metric.history} />
                              </div>
                              <p className="text-sm font-semibold text-slate-800">
                                {loading ? "…" : formatValue(metric.value, metric.unit, metric.note)}
                              </p>
                              <p className="text-xs text-slate-600">
                                Change: {loading ? "…" : formatDelta(metric.change, metric.unit, metric.note)}{" "}
                                {metric.date ? `(${metric.date})` : ""}
                              </p>
                              <p className="text-[11px] text-slate-600">Source: {metric.source}</p>
                              {metric.note && (
                                <p className="text-[11px] text-slate-600 mt-1">{metric.note}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
        </CollapsibleContent>
      </Collapsible>
     </Card>
   )
 }
