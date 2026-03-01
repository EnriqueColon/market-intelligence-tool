"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  fetchSurveillanceEvents,
  fetchSurveillanceCompetitors,
  fetchSurveillanceMetrics,
  fetchSurveillanceSourceStatus,
  ensureSurveillanceMetrics,
  runSurveillanceIngestion,
  uploadManualCsv,
  type SurveillanceEventRow,
  type CompetitorRow,
  type MetricsRow,
  type SourceStatus,
} from "@/app/actions/competitor-surveillance"
import { Activity, BarChart3, DollarSign, TrendingUp, Upload, RefreshCw, FileSpreadsheet } from "lucide-react"

const SOURCE_LABELS: Record<string, string> = {
  sec_edgar: "SEC EDGAR",
  news: "News / RSS",
  manual_csv: "Manual CSV",
  ucc: "UCC Filings",
  aom: "County AOM",
  foreclosure: "Foreclosure",
  hiring: "Hiring Signals",
}

const CONNECTOR_SPECS = [
  { key: "sec_edgar", label: "SEC EDGAR (Form D)", statusKey: "sec_edgar" as const },
  { key: "rss_news", label: "News / RSS", statusKey: "rss_news" as const },
  { key: "manual_csv", label: "Manual CSV", statusKey: "manual_csv" as const },
  { key: "ucc", label: "UCC Filings", statusKey: "ucc" as const },
  { key: "aom", label: "County AOM", statusKey: "aom" as const },
  { key: "foreclosure", label: "Foreclosure / Docket", statusKey: "foreclosure" as const },
  { key: "hiring", label: "Hiring Signals", statusKey: "hiring" as const },
]

export function CompetitorSurveillance() {
  const [events, setEvents] = useState<SurveillanceEventRow[]>([])
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([])
  const [metrics, setMetrics] = useState<MetricsRow[]>([])
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [ingesting, setIngesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [csvText, setCsvText] = useState("")
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvResult, setCsvResult] = useState<{ ingested: number; skipped: number; errors: string[] } | null>(null)
  const [showCsvUpload, setShowCsvUpload] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      await ensureSurveillanceMetrics()
      const [ev, comp, met, status] = await Promise.all([
        fetchSurveillanceEvents(80),
        fetchSurveillanceCompetitors(),
        fetchSurveillanceMetrics(),
        fetchSurveillanceSourceStatus(),
      ])
      setEvents(ev)
      setCompetitors(comp)
      setMetrics(met)
      setSourceStatus(status)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const runIngestion = async () => {
    setIngesting(true)
    try {
      await runSurveillanceIngestion(["sec_edgar", "rss_news"])
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setIngesting(false)
    }
  }

  const runSyncs = async () => {
    setSyncing(true)
    try {
      await runSurveillanceIngestion(["aom_sync", "ucc_sync", "foreclosure_sync", "hiring_rss"])
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setSyncing(false)
    }
  }

  const handleCsvUpload = async () => {
    if (!csvText.trim()) return
    setCsvUploading(true)
    setCsvResult(null)
    try {
      const result = await uploadManualCsv(csvText)
      setCsvResult(result)
      if (result.ingested > 0) await load()
    } catch (e) {
      setCsvResult({ ingested: 0, skipped: 0, errors: [String(e)] })
    } finally {
      setCsvUploading(false)
    }
  }

  const fundraiseEvents = events.filter((e) => e.event_type === "fundraise" || e.event_type === "fundraise_amendment")
  const portfolioByCompetitor = metrics.reduce(
    (acc, m) => {
      if (!acc[m.competitor_name]) acc[m.competitor_name] = { events30d: 0, fundraise24m: 0, ucc90d: 0, aom90d: 0, foreclosure90d: 0, hiring90d: 0 }
      acc[m.competitor_name].events30d += m.event_count_30d
      acc[m.competitor_name].fundraise24m += m.fundraise_count_24m
      acc[m.competitor_name].ucc90d += m.ucc_count_90d
      acc[m.competitor_name].aom90d += m.aom_count_90d
      acc[m.competitor_name].foreclosure90d += m.foreclosure_count_90d
      acc[m.competitor_name].hiring90d += m.hiring_count_90d
      return acc
    },
    {} as Record<string, { events30d: number; fundraise24m: number; ucc90d: number; aom90d: number; foreclosure90d: number; hiring90d: number }>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-base font-semibold text-slate-800">Competitor Surveillance</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={runIngestion}
            disabled={ingesting}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-slate-800 hover:bg-secondary/80 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${ingesting ? "animate-spin" : ""}`} />
            {ingesting ? "Ingesting…" : "Run SEC & News"}
          </button>
          <button
            onClick={runSyncs}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-slate-800 hover:bg-secondary/80 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Run AOM/UCC/Foreclosure/Hiring"}
          </button>
          <button
            onClick={() => setShowCsvUpload(!showCsvUpload)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-slate-800 hover:bg-secondary/80"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Manual CSV
          </button>
        </div>
      </div>

      {showCsvUpload && (
        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <h4 className="mb-2 text-sm font-medium text-slate-800">Manual CSV Upload</h4>
          <p className="mb-2 text-xs text-slate-600">
            Columns: <code className="rounded bg-muted px-1">competitor_name</code>, <code className="rounded bg-muted px-1">event_type</code>, <code className="rounded bg-muted px-1">event_date</code>, <code className="rounded bg-muted px-1">title</code>, <code className="rounded bg-muted px-1">summary</code>, <code className="rounded bg-muted px-1">url</code>, <code className="rounded bg-muted px-1">raw_json</code> (optional)
          </p>
          <p className="mb-2 text-xs text-slate-600">
            Valid <code className="rounded bg-muted px-1">event_type</code> values (for Strategic Movement metrics): <code className="rounded bg-muted px-1">ucc</code>, <code className="rounded bg-muted px-1">aom</code>, <code className="rounded bg-muted px-1">foreclosure</code>, <code className="rounded bg-muted px-1">hiring</code>. Also: <code className="rounded bg-muted px-1">fundraise</code>, <code className="rounded bg-muted px-1">fundraise_amendment</code>, <code className="rounded bg-muted px-1">press_mention</code>.
          </p>
          <p className="mb-3 text-xs text-slate-600">
            <code className="rounded bg-muted px-1">competitor_name</code> must match a seeded competitor (e.g. Blackstone, Starwood Capital) or an alias.
          </p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={`competitor_name,event_type,event_date,title,summary,url
Blackstone,ucc,2025-01-15,UCC filing - XYZ Property,Debtor: ABC LLC,https://...
Starwood Capital,aom,2025-01-10,AOM Assignment,Assignment of mortgage,https://...
Apollo,foreclosure,2025-01-08,Foreclosure notice,Case 12345,https://...
KKR,hiring,2025-01-12,Senior Analyst role,Real estate debt team,https://...`}
            className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
            rows={6}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleCsvUpload}
              disabled={csvUploading || !csvText.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {csvUploading ? "Uploading…" : "Upload"}
            </button>
            {csvResult && (
              <span className="text-xs text-slate-600">
                Ingested: {csvResult.ingested} | Skipped: {csvResult.skipped}
                {csvResult.errors.length > 0 && ` | Errors: ${csvResult.errors.join(", ")}`}
              </span>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-slate-800">Recent Activity Feed</h4>
          </div>
          {loading ? (
            <p className="text-xs text-slate-600">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-slate-600">No events yet. Run ingestion or upload CSV.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Competitor</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.slice(0, 20).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{e.event_date || "—"}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs">{e.competitor_name}</TableCell>
                      <TableCell className="text-xs">{SOURCE_LABELS[e.source_type] || e.source_type}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {e.title || "—"}
                          </a>
                        ) : (
                          e.title || "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-slate-800">Portfolio Snapshot</h4>
          </div>
          <p className="mb-2 text-xs text-slate-600">Estimated from signals (events in last 30d)</p>
          {loading ? (
            <p className="text-xs text-slate-600">Loading…</p>
          ) : Object.keys(portfolioByCompetitor).length === 0 ? (
            <p className="text-xs text-slate-600">No metrics. Run ingestion first.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Competitor</TableHead>
                    <TableHead className="text-xs">Events 30d</TableHead>
                    <TableHead className="text-xs">Fundraise 24m</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(portfolioByCompetitor)
                    .slice(0, 12)
                    .map(([name, m]) => (
                      <TableRow key={name}>
                        <TableCell className="max-w-[140px] truncate text-xs">{name}</TableCell>
                        <TableCell className="text-xs">{m.events30d}</TableCell>
                        <TableCell className="text-xs">{m.fundraise24m}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <div className="mb-3 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-slate-800">Capital Activity</h4>
          </div>
          <p className="mb-2 text-xs text-slate-600">Fundraising & new vehicles (Form D)</p>
          {loading ? (
            <p className="text-xs text-slate-600">Loading…</p>
          ) : fundraiseEvents.length === 0 ? (
            <p className="text-xs text-slate-600">No capital activity events.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Competitor</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fundraiseEvents.slice(0, 15).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{e.event_date || "—"}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs">{e.competitor_name}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {e.title || "—"}
                          </a>
                        ) : (
                          e.title || "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-slate-800">Strategic Movement Indicators</h4>
          </div>
          <p className="mb-2 text-xs text-slate-600">Hiring, UCC, AOM, foreclosure (90d)</p>
          {loading ? (
            <p className="text-xs text-slate-600">Loading…</p>
          ) : Object.keys(portfolioByCompetitor).length === 0 ? (
            <p className="text-xs text-slate-600">No strategic metrics.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Competitor</TableHead>
                    <TableHead className="text-xs">UCC 90d</TableHead>
                    <TableHead className="text-xs">AOM 90d</TableHead>
                    <TableHead className="text-xs">Foreclosure 90d</TableHead>
                    <TableHead className="text-xs">Hiring 90d</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(portfolioByCompetitor)
                    .filter(([, m]) => m.ucc90d > 0 || m.aom90d > 0 || m.foreclosure90d > 0 || m.hiring90d > 0)
                    .slice(0, 10)
                    .map(([name, m]) => (
                      <TableRow key={name}>
                        <TableCell className="max-w-[120px] truncate text-xs">{name}</TableCell>
                        <TableCell className="text-xs">{m.ucc90d}</TableCell>
                        <TableCell className="text-xs">{m.aom90d}</TableCell>
                        <TableCell className="text-xs">{m.foreclosure90d}</TableCell>
                        <TableCell className="text-xs">{m.hiring90d}</TableCell>
                      </TableRow>
                    ))}
                  {Object.entries(portfolioByCompetitor).filter(([, m]) => m.ucc90d > 0 || m.aom90d > 0 || m.foreclosure90d > 0 || m.hiring90d > 0).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-xs text-slate-600">
                        No strategic signals. Add UCC/AOM/foreclosure/hiring via Manual CSV.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h4 className="mb-2 text-sm font-medium text-slate-800">Source Connectors</h4>
        <div className="flex flex-wrap gap-2">
          {CONNECTOR_SPECS.map((c) => {
            const configured = sourceStatus ? sourceStatus[c.statusKey] : c.statusKey === "sec_edgar" || c.statusKey === "rss_news" || c.statusKey === "manual_csv"
            return (
              <span
                key={c.key}
                className={`rounded-md px-2 py-1 text-xs ${
                  configured ? "bg-primary/10 text-primary" : "bg-muted text-slate-600"
                }`}
              >
                {c.label}
                {!configured && " (Not configured)"}
              </span>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
