"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ExternalLink, Search, Sparkles } from "lucide-react"
import { MARKET_RESEARCH_SECTIONS, type ReportEntry } from "@/app/data/market-research-reports"
import { fetchReportSummaries, type ReportSummaryEntry } from "@/app/actions/fetch-report-summaries"
import { CbreFindDialog } from "@/components/cbre-find-dialog"

function isCbreReport(report: ReportEntry): boolean {
  const src = (report.source || "").toLowerCase()
  const url = (report.url || report.pdfUrl || "").toLowerCase()
  return src.includes("cbre") || url.includes("cbre.com")
}

function ReportCard({
  report,
  aiSummary,
  isVercel,
}: {
  report: ReportEntry
  aiSummary?: ReportSummaryEntry | null
  isVercel?: boolean
}) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [cbreFindOpen, setCbreFindOpen] = useState(false)
  const showCbreFind = isCbreReport(report)

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-slate-800">{report.title}</h4>
          <p className="text-xs text-slate-600 mt-1">
            {report.source} • {report.asOf}
          </p>
        </div>
        {(report.url || report.pdfUrl || showCbreFind) && (
          <div className="shrink-0 flex items-center gap-2">
            {report.url && (
              <Button
                variant="secondary"
                size="sm"
                className="text-xs h-8"
                asChild
              >
                <a href={report.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Link to Source
                </a>
              </Button>
            )}
            {showCbreFind && (
              <Button
                size="sm"
                className="text-xs h-8 text-white border"
                style={{ backgroundColor: "#006D95", borderColor: "#006D95" }}
                onClick={() => setCbreFindOpen(true)}
              >
                <Search className="h-3.5 w-3.5 mr-1" />
                Find on CBRE
              </Button>
            )}
            {(report.url || report.pdfUrl) && (
              <Button
                variant="secondary"
                size="sm"
                className="text-xs h-8"
                onClick={() => setSummaryOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                Summarized
              </Button>
            )}
          </div>
        )}
      </div>
      {aiSummary && (aiSummary.summary || aiSummary.bullets.length > 0) && (
        <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <p className="text-xs font-semibold text-slate-800 uppercase">AI Summary</p>
            {aiSummary.lastFetched && (
              <span className="text-[10px] text-slate-600 ml-auto">
                Updated {new Date(aiSummary.lastFetched).toLocaleDateString()}
              </span>
            )}
          </div>
          {aiSummary.summary && (
            <p className="text-sm text-slate-800 mb-2">{aiSummary.summary}</p>
          )}
          {aiSummary.bullets.length > 0 && (
            <ul className="list-disc pl-5 space-y-0.5 text-sm text-slate-600">
              {aiSummary.bullets.map((b, idx) => (
                <li key={`ai-${report.id}-${idx}`}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {report.keyTakeaways.length > 0 && (
        <ul className="mt-3 space-y-1.5 list-disc pl-5 text-sm text-slate-600">
          {report.keyTakeaways.map((takeaway, idx) => (
            <li key={`${report.id}-tk-${idx}`}>{takeaway}</li>
          ))}
        </ul>
      )}
      {report.rankings && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs font-semibold text-slate-600 uppercase mb-1.5">
            {report.rankings.label}
          </p>
          <ol className="list-decimal list-inside text-sm text-slate-800 space-y-0.5">
            {report.rankings.firms.map((firm, idx) => (
              <li key={`${report.id}-rank-${idx}`}>{firm}</li>
            ))}
          </ol>
        </div>
      )}

      <Dialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Report summary</DialogTitle>
            <DialogDescription>
              {report.source} • {report.asOf}
              {report.url && (
                <>
                  {" "}
                  •{" "}
                  <a
                    href={report.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    Open report
                  </a>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="text-sm font-semibold">{report.title}</div>
            {aiSummary && (aiSummary.summary || aiSummary.bullets.length > 0) ? (
              <div className="space-y-4">
                {aiSummary.summary && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 uppercase mb-1.5">
                      Executive summary
                    </div>
                    <p className="text-sm text-slate-800">{aiSummary.summary}</p>
                  </div>
                )}
                {aiSummary.bullets.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 uppercase mb-1.5">
                      Key points
                    </div>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
                      {aiSummary.bullets.map((b, idx) => (
                        <li key={`dlg-${report.id}-${idx}`}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiSummary.lastFetched && (
                  <div className="text-xs text-slate-600">
                    Last updated: {new Date(aiSummary.lastFetched).toLocaleDateString()}
                  </div>
                )}
              </div>
            ) : report.keyTakeaways.length > 0 || report.rankings ? (
              <div className="space-y-4">
                {report.keyTakeaways.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 uppercase mb-1.5">
                      Key takeaways
                    </div>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
                      {report.keyTakeaways.map((tk, idx) => (
                        <li key={`dlg-tk-${report.id}-${idx}`}>{tk}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.rankings && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 uppercase mb-1.5">
                      {report.rankings.label}
                    </div>
                    <ol className="list-decimal list-inside text-sm text-slate-800 space-y-0.5">
                      {report.rankings.firms.map((firm, idx) => (
                        <li key={`dlg-rank-${report.id}-${idx}`}>{firm}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {report.url && (
                  <p className="text-xs text-slate-600">
                    <a href={report.url} target="_blank" rel="noreferrer" className="text-primary underline">
                      Open full report
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">No summary available.</p>
                {report.url && (
                  <a href={report.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                    Open report
                  </a>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showCbreFind && (
        <CbreFindDialog
          open={cbreFindOpen}
          onOpenChange={setCbreFindOpen}
          report={report}
          isVercel={isVercel}
        />
      )}
    </div>
  )
}

export function MarketResearchReports({ isVercel = false }: { isVercel?: boolean }) {
  const [summaries, setSummaries] = useState<Record<string, ReportSummaryEntry>>({})

  useEffect(() => {
    let mounted = true
    fetchReportSummaries().then((data) => {
      if (mounted) setSummaries(data)
    })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-800">Industry Reports</h3>
        <p className="text-sm text-slate-600 mt-1">
          Curated rankings and outlooks from MBA, MHN, CommercialSearch, CBRE, and JLL. Reports are published periodically; links added when available. AI summaries refresh via background job.
        </p>
      </div>
      <Accordion type="multiple" defaultValue={MARKET_RESEARCH_SECTIONS.map((s) => s.id)} className="space-y-2">
        {MARKET_RESEARCH_SECTIONS.map((section) => (
          <AccordionItem key={section.id} value={section.id} className="border border-border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline py-4">
              <span className="text-sm font-semibold text-slate-800">{section.title}</span>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="space-y-3">
                {section.reports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    aiSummary={summaries[report.id]}
                    isVercel={isVercel}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Card>
  )
}
