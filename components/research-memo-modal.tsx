"use client"

import { useEffect, useRef, useState } from "react"
import {
  generateResearchMemo,
  type DealInputs,
  type GeneratedMemo,
} from "@/app/actions/generate-research-memo"
import type { ResearchReport } from "@/app/actions/fetch-research-feed"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  X,
} from "lucide-react"

interface Props {
  type: "market" | "ic"
  reports: ResearchReport[]
  onClose: () => void
}

// ── Word (.docx) download ──────────────────────────────────────────────────────
async function downloadAsDocx(memo: GeneratedMemo) {
  // Dynamically import docx to keep initial bundle small
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
  } = await import("docx")

  const children: Paragraph[] = []

  // Title
  children.push(
    new Paragraph({
      text: memo.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  )

  // Date + type badge
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: `${memo.date}  •  ${memo.type === "market" ? "Market Conditions Memo" : "Investment Committee Memorandum"}`,
          color: "555555",
          size: 20,
        }),
      ],
    })
  )

  for (const section of memo.sections) {
    // Section heading
    children.push(
      new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 120 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "006D95" },
        },
      })
    )

    // Body paragraph
    if (section.body) {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: section.body, size: 22 })],
        })
      )
    }

    // Bullet points
    for (const bullet of section.bullets ?? []) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: bullet, size: 22 })],
        })
      )
    }
  }

  // Disclaimer
  children.push(
    new Paragraph({
      spacing: { before: 600 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      },
      children: [
        new TextRun({
          text: memo.disclaimer,
          size: 18,
          color: "888888",
          italics: true,
        }),
      ],
    })
  )

  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${memo.title.replace(/[^a-z0-9]/gi, "_").slice(0, 60)}.docx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── IC deal form ───────────────────────────────────────────────────────────────
function DealForm({
  value,
  onChange,
}: {
  value: DealInputs
  onChange: (v: DealInputs) => void
}) {
  const field = (
    label: string,
    key: keyof DealInputs,
    placeholder: string,
    textarea = false
  ) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      {textarea ? (
        <textarea
          rows={2}
          placeholder={placeholder}
          value={value[key] ?? ""}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#006D95] resize-none"
        />
      ) : (
        <input
          type="text"
          placeholder={placeholder}
          value={value[key] ?? ""}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#006D95]"
        />
      )}
    </div>
  )

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {field("Property Address", "propertyAddress", "123 Main St, Miami, FL")}
      {field("Asset Type", "assetType", "Office, Multifamily, Retail...")}
      {field("Loan Amount", "loanAmount", "$12,500,000")}
      {field("Borrower / Sponsor", "borrower", "ABC Capital LLC")}
      {field("Lender / Servicer", "lender", "Wells Fargo / LNR Partners")}
      {field("Investment Strategy", "strategy", "Note Sale, Payoff, REO, Workout...")}
      {field("Acquisition Basis", "acquisitionBasis", "$0.72 on the dollar")}
      {field("Additional Notes", "additionalNotes", "Anything else relevant to the deal...", true)}
    </div>
  )
}

// ── Memo renderer ──────────────────────────────────────────────────────────────
function MemoRenderer({ memo }: { memo: GeneratedMemo }) {
  return (
    <div className="space-y-6 text-slate-800">
      <div className="text-center border-b border-slate-200 pb-4">
        <h2 className="text-lg font-bold text-slate-900">{memo.title}</h2>
        <p className="text-xs text-slate-500 mt-1">
          {memo.date} &nbsp;·&nbsp;{" "}
          {memo.type === "market"
            ? "Market Conditions Memo"
            : "Investment Committee Memorandum"}
        </p>
      </div>

      {memo.sections.map((section, i) => (
        <div key={i} className="space-y-2">
          <h3 className="text-sm font-bold text-[#006D95] uppercase tracking-wide border-b border-[#006D95]/20 pb-1">
            {section.heading}
          </h3>
          {section.body && (
            <p className="text-sm leading-relaxed">{section.body}</p>
          )}
          {section.bullets && section.bullets.length > 0 && (
            <ul className="space-y-1.5 mt-2">
              {section.bullets.map((b, j) => (
                <li key={j} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#006D95]" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div className="border-t border-slate-200 pt-4">
        <p className="text-xs text-slate-400 italic leading-relaxed">
          {memo.disclaimer}
        </p>
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────
export function ResearchMemoModal({ type, reports, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<"market" | "ic">(type)
  const [dealInputs, setDealInputs] = useState<DealInputs>({})
  const [memo, setMemo] = useState<GeneratedMemo | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset memo when tab switches
  useEffect(() => {
    setMemo(null)
    setError(null)
  }, [activeTab])

  const generate = async () => {
    setGenerating(true)
    setError(null)
    setMemo(null)
    try {
      const result = await generateResearchMemo(
        activeTab,
        reports,
        activeTab === "ic" ? dealInputs : undefined
      )
      setMemo(result)
      setTimeout(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate memo.")
    } finally {
      setGenerating(false)
    }
  }

  const copyText = async () => {
    if (!memo) return
    const text = [
      memo.title,
      memo.date,
      "",
      ...memo.sections.flatMap((s) => [
        s.heading.toUpperCase(),
        s.body,
        ...(s.bullets ?? []).map((b) => `  • ${b}`),
        "",
      ]),
      "---",
      memo.disclaimer,
    ].join("\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = async () => {
    if (!memo) return
    setDownloading(true)
    try {
      await downloadAsDocx(memo)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="relative flex flex-col w-full max-w-3xl max-h-[90vh] rounded-xl bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#006D95]" />
            <span className="font-semibold text-slate-800">Generate Memo</span>
            <span className="text-xs text-slate-400 ml-1">
              {reports.length} report{reports.length !== 1 ? "s" : ""} selected
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 flex-shrink-0">
          {(["market", "ic"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === t
                  ? "border-b-2 border-[#006D95] text-[#006D95]"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "market" ? "Market Conditions Memo" : "IC Memo"}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Selected reports list */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
              Sources
            </div>
            <div className="flex flex-wrap gap-1.5">
              {reports.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-xs text-slate-700"
                >
                  <span className="font-medium text-[#006D95]">{r.publisher}</span>
                  <span className="text-slate-400 max-w-[140px] truncate">{r.title}</span>
                </span>
              ))}
            </div>
          </div>

          {/* IC deal form */}
          {activeTab === "ic" && !memo && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-slate-500 uppercase">
                Deal Information <span className="font-normal text-slate-400">(optional — fill in what you have)</span>
              </div>
              <DealForm value={dealInputs} onChange={setDealInputs} />
            </div>
          )}

          {/* Generate button */}
          {!memo && !generating && (
            <Button
              className="w-full bg-[#006D95] hover:bg-[#005a7a] text-white"
              onClick={generate}
            >
              Generate {activeTab === "market" ? "Market Memo" : "IC Memo"}
            </Button>
          )}

          {/* Loading */}
          {generating && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-[#006D95]" />
                Generating memo from {reports.length} report{reports.length !== 1 ? "s" : ""}…
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Rendered memo */}
          {memo && <MemoRenderer memo={memo} />}
        </div>

        {/* Footer actions */}
        {memo && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => { setMemo(null); setError(null) }}
            >
              Regenerate
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={copyText}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy text"}
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-xs bg-[#006D95] hover:bg-[#005a7a] text-white"
                onClick={download}
                disabled={downloading}
              >
                {downloading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                Download .docx
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
