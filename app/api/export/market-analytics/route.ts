import { NextRequest, NextResponse } from "next/server"
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import { buildExportData } from "@/app/actions/export-market-analytics-report"
import {
  generateAnalystNarrative,
  type NarrativeInput,
} from "@/lib/report/narrative/generate-analyst-narrative"
import { KPI_EXPLANATION_NARRATIVE } from "@/lib/report/kpi-explanation"
export const runtime = "nodejs"

function formatCurrency(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

function formatRatio(value: number | null | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return value.toFixed(2) + "x"
}

/** Replace Unicode chars that PDF standard fonts (WinAnsi) cannot encode */
function sanitizeForPdf(text: string): string {
  return text
    .replace(/\u2265/g, ">=")   // ≥
    .replace(/\u2264/g, "<=")   // ≤
    .replace(/\u2013/g, "-")    // en-dash –
    .replace(/\u2014/g, "-")    // em-dash —
    .replace(/\u2018/g, "'")    // left single quote
    .replace(/\u2019/g, "'")    // right single quote
    .replace(/\u201c/g, '"')    // left double quote
    .replace(/\u201d/g, '"')    // right double quote
}

const MARGIN = 72
const PAGE_W = 612
const PAGE_H = 792

const navy = rgb(0.15, 0.2, 0.35)
const charcoal = rgb(0.25, 0.3, 0.4)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const scopeParam = searchParams.get("scope")
    const scope = scopeParam && scopeParam.trim() ? scopeParam.trim() : "National"

    const data = await buildExportData(scope)
    const date = data.date
    const { dispersionStats, dispersionNarrative } = data

    const narrativeScope: "national" | "state" = scope === "National" ? "national" : "state"
    const kpiInstitutions = data.kpis.find((k) => k.label === "Institutions Screened")?.value ?? "0"
    const narrativeInput: NarrativeInput = {
      scope: narrativeScope,
      state: narrativeScope === "state" ? scope : undefined,
      asOfQuarter: data.asOfQuarter,
      kpis: {
        institutionsScreened: Number(kpiInstitutions) || 0,
        avgCreConcentration: data.kpis.find((k) => k.label === "Avg CRE Concentration")?.value ?? "—",
        avgNplRatio: data.kpis.find((k) => k.label === "Avg NPL Ratio")?.value ?? "—",
        avgNoncurrentLoans: data.kpis.find((k) => k.label === "Avg Noncurrent / Loans")?.value ?? "—",
        avgReserveCoverage: data.kpis.find((k) => k.label === "Avg Reserve Coverage")?.value ?? "—",
        avgCreToTier1Tier2:
          data.capitalKpis.avgCreToTier1Tier2 != null
            ? data.capitalKpis.avgCreToTier1Tier2.toFixed(2) + "x"
            : null,
        avgCreToEquity:
          data.capitalKpis.avgCreToEquity != null
            ? data.capitalKpis.avgCreToEquity.toFixed(2) + "x"
            : null,
        coveragePct: data.capitalKpis.coveragePct,
      },
      dispersionStats: data.dispersionStats,
      topByCreCapital: data.topByCreToCapital,
      topByOpportunityScore: data.topByOpportunityScore,
      summaryByState: data.summaryByState,
    }
    const analystNarrative = await generateAnalystNarrative(narrativeInput)

    const pdfDoc = await PDFDocument.create()
    const times = await pdfDoc.embedFont(StandardFonts.TimesRoman)
    const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
    const fontSize = 10
    const lineHeight = 14
    const pages: { page: ReturnType<typeof pdfDoc.addPage>; pageNum: number }[] = []

    const addPage = () => {
      const page = pdfDoc.addPage([PAGE_W, PAGE_H])
      const pageNum = pages.length + 1
      pages.push({ page, pageNum })
      return page
    }

    const wrapText = (text: string, maxWidth: number): string[] => {
      const words = text.split(" ")
      const lines: string[] = []
      let current = ""
      for (const w of words) {
        const test = current ? `${current} ${w}` : w
        if (times.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
          lines.push(current)
          current = w
        } else current = test
      }
      if (current) lines.push(current)
      return lines
    }

    const writeLine = (page: ReturnType<typeof pdfDoc.addPage>, x: number, y: number, text: string, bold = false, color = navy) => {
      page.drawText(sanitizeForPdf(text), { x, y, size: fontSize, font: bold ? timesBold : times, color })
      return y - lineHeight
    }

    let currentPage = addPage()
    let currentY = PAGE_H - MARGIN

    currentPage.drawText(sanitizeForPdf("Executive Report"), { x: MARGIN, y: currentY, size: 22, font: timesBold, color: navy })
    currentY -= 28
    currentPage.drawText(sanitizeForPdf("Market Analytics - FDIC Bank Screening"), { x: MARGIN, y: currentY, size: 14, font: times, color: charcoal })
    currentY -= 24
    currentPage.drawText(sanitizeForPdf(`Scope: ${data.scope}`), { x: MARGIN, y: currentY, size: fontSize, font: times, color: charcoal })
    currentY -= lineHeight
    currentPage.drawText(sanitizeForPdf(`Report Date: ${date}`), { x: MARGIN, y: currentY, size: fontSize, font: times, color: charcoal })
    currentY -= lineHeight * 2

    currentPage = addPage()
    currentY = PAGE_H - MARGIN

    currentY = writeLine(currentPage, MARGIN, currentY, "Executive Summary", true)
    currentY -= lineHeight

    const es = analystNarrative.executiveSummary
    ;[es.creExposureOverview, es.capitalBufferOverview, es.creditDeteriorationSignals, es.riskDispersionScreening, es.implications].forEach((para) => {
      wrapText(para, PAGE_W - 2 * MARGIN).forEach((line) => {
        if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
        currentY = writeLine(currentPage, MARGIN, currentY, line)
      })
      currentY -= lineHeight
    })
    currentY -= lineHeight

    currentY = writeLine(currentPage, MARGIN, currentY, "KPI Summary", true)
    data.kpis.forEach((k) => { currentY = writeLine(currentPage, MARGIN, currentY, `${k.label}: ${k.value}`) })
    currentY -= lineHeight
    currentY = writeLine(currentPage, MARGIN, currentY, "KPI Definitions", true)
    wrapText(KPI_EXPLANATION_NARRATIVE, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight * 2

    currentY = writeLine(currentPage, MARGIN, currentY, "Capital Concentration (FDIC)", true)
    currentY = writeLine(currentPage, MARGIN, currentY, `Avg CRE / (Tier1+Tier2): ${data.capitalKpis.avgCreToTier1Tier2 != null ? formatRatio(data.capitalKpis.avgCreToTier1Tier2) : "—"}`)
    currentY = writeLine(currentPage, MARGIN, currentY, `Avg CRE / Equity: ${data.capitalKpis.avgCreToEquity != null ? formatRatio(data.capitalKpis.avgCreToEquity) : "—"}`)
    currentY = writeLine(currentPage, MARGIN, currentY, `Coverage %: ${data.capitalKpis.coveragePct.toFixed(1)}%`)
    currentY -= lineHeight

    currentY = writeLine(currentPage, MARGIN, currentY, "CRE Concentration & Capital Exposure (Analyst)", true)
    wrapText(analystNarrative.sections.creConcentrationAndCapitalExposure, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight * 2

    currentY = writeLine(currentPage, MARGIN, currentY, "Opportunity Score Distribution", true)
    wrapText(dispersionNarrative.headerBlurb, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight
    currentY = writeLine(currentPage, MARGIN, currentY, `Median: ${dispersionStats.p50.toFixed(1)} | IQR: ${dispersionStats.p25.toFixed(1)}–${dispersionStats.p75.toFixed(1)} | P90: ${dispersionStats.p90.toFixed(1)}`)
    currentY = writeLine(currentPage, MARGIN, currentY, `High-Score Share (≥80): ${Math.round(dispersionStats.share_ge_80)}% | ≥70: ${Math.round(dispersionStats.share_ge_70)}%`)
    currentY -= lineHeight
    wrapText(dispersionNarrative.histogramLine, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight
    wrapText(dispersionNarrative.interpretation, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight
    wrapText(dispersionNarrative.actionLine, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight * 2

    if (currentY < MARGIN + 80) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
    currentY = writeLine(currentPage, MARGIN, currentY, "Summary by State", true)
    if (data.scope === "National" && analystNarrative.sections.stateBreakdown) {
      wrapText(analystNarrative.sections.stateBreakdown, PAGE_W - 2 * MARGIN).forEach((line) => {
        if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
        currentY = writeLine(currentPage, MARGIN, currentY, line)
      })
      currentY -= lineHeight
    }
    if (data.scope === "National" && data.summaryByState.length > 0) {
      data.summaryByState.slice(0, 15).forEach((row) => {
        if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
        currentY = writeLine(currentPage, MARGIN, currentY, `${row.state}: ${row.bankCount} banks, Assets ${formatCurrency(row.totalAssets)}, CRE ${formatCurrency(row.creLoans)}`)
      })
    }
    currentY -= lineHeight * 2

    if (currentY < MARGIN + 80) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
    currentY = writeLine(currentPage, MARGIN, currentY, "Bank-Level Screening (Analyst)", true)
    wrapText(analystNarrative.sections.bankLevelScreening, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight * 2

    if (currentY < MARGIN + 80) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
    currentY = writeLine(currentPage, MARGIN, currentY, "Top 25 by CRE / (Tier1 + Tier2)", true)
    data.topByCreToCapital.slice(0, 25).forEach((row, i) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, `${i + 1}. ${row.name} (${row.state ?? "—"}) – CRE/(T1+T2): ${formatRatio(row.capitalRatios?.creToTier1Tier2)}, Score: ${row.opportunityScore}`)
    })
    currentY -= lineHeight * 2

    if (currentY < MARGIN + 80) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
    currentY = writeLine(currentPage, MARGIN, currentY, "Top 25 by Opportunity Score", true)
    data.topByOpportunityScore.slice(0, 25).forEach((row, i) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, `${i + 1}. ${row.name} (${row.state ?? "—"}) – Score: ${row.opportunityScore}, CRE/(T1+T2): ${formatRatio(row.capitalRatios?.creToTier1Tier2)}`)
    })
    currentY -= lineHeight * 2

    if (currentY < MARGIN + 80) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
    currentY = writeLine(currentPage, MARGIN, currentY, "Credit Deterioration Indicators (Analyst)", true)
    wrapText(analystNarrative.sections.creditDeteriorationIndicators, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight * 2

    if (currentY < MARGIN + 120) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
    currentY = writeLine(currentPage, MARGIN, currentY, "Methodology & Definitions", true)
    wrapText(analystNarrative.sections.methodologyNarrative, PAGE_W - 2 * MARGIN).forEach((line) => {
      if (currentY < MARGIN + 40) { currentPage = addPage(); currentY = PAGE_H - MARGIN }
      currentY = writeLine(currentPage, MARGIN, currentY, line)
    })
    currentY -= lineHeight
    currentY = writeLine(currentPage, MARGIN, currentY, "CRE / (Tier1+Tier2): Commercial real estate loans divided by Tier 1 + Tier 2 capital.")
    currentY = writeLine(currentPage, MARGIN, currentY, "CRE / Equity: Commercial real estate loans divided by total equity.")
    currentY = writeLine(currentPage, MARGIN, currentY, "Opportunity Score: Weighted composite of CRE concentration (35%), NPL from noncurrent-to-loans (35%), reserves (15%), capital (15%).")
    currentY = writeLine(currentPage, MARGIN, currentY, "Source: FDIC call reports (latest available quarter).")

    pages.forEach(({ page, pageNum }) => {
      page.drawText(sanitizeForPdf(`Confidential - For Internal Use Only | Page ${pageNum}`), { x: MARGIN, y: 20, size: 8, font: times, color: charcoal })
    })

    const pdfBytes = await pdfDoc.save()

    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Market Intelligence"
    workbook.created = new Date()

    const summarySheet = workbook.addWorksheet("Summary_By_State", { headerFooter: { firstHeader: "Executive Pack" } })
    if (data.scope === "National" && data.summaryByState.length > 0) {
      summarySheet.addRow([
        "State",
        "Bank Count",
        "Total Assets",
        "Total CRE Loans",
        "Total Construction",
        "Total Multifamily",
        "Total Non-Residential",
        "Total Other Real Estate",
        "Total Unused Commitments",
        "CRE Unused Commitments",
        "Weighted Avg CRE/Assets %",
        "Weighted Avg CRE/(T1+T2)",
        "Weighted Avg NPL %",
      ])
      data.summaryByState.forEach((row) => {
        summarySheet.addRow([
          row.state,
          row.bankCount,
          row.totalAssets,
          row.creLoans,
          row.constructionLoans,
          row.multifamilyLoans,
          row.nonResidentialLoans,
          row.otherRealEstateLoans,
          row.totalUnusedCommitments,
          row.creUnusedCommitments,
          row.weightedAvgCreToAssets != null ? row.weightedAvgCreToAssets : "—",
          row.weightedAvgCreToCap != null ? row.weightedAvgCreToCap : "—",
          row.weightedAvgNpl != null ? (row.weightedAvgNpl as number) * 100 : "—",
        ])
      })
    } else if (data.scope !== "National") {
      summarySheet.addRow(["State scope selected. Summary by State is available for National scope only."])
    }

    const creSheet = workbook.addWorksheet("Top_By_CRE_Capital")
    creSheet.addRow([
      "Bank",
      "City",
      "State",
      "Total Assets",
      "CRE Loans",
      "Total UC",
      "CRE UC",
      "T1+T2",
      "CRE/(T1+T2)",
      "CRE/Assets %",
      "NPL %",
      "Opportunity Score",
    ])
    data.topByCreToCapital.forEach((row) => {
      creSheet.addRow([
        row.name,
        row.city ?? "—",
        row.state ?? "—",
        row.totalAssets,
        row.creLoans,
        row.totalUnusedCommitments ?? "—",
        row.creUnusedCommitments ?? "—",
        row.capitalRatios?.tier1PlusTier2Capital ?? "—",
        row.capitalRatios?.creToTier1Tier2 ?? "—",
        row.creConcentration ?? "—",
        row.nplRatio != null ? (row.nplRatio as number) * 100 : "—",
        row.opportunityScore,
      ])
    })

    const dispSheet = workbook.addWorksheet("Dispersion_Stats")
    dispSheet.addRow(["Metric", "Value"])
    dispSheet.addRow(["n", data.dispersionStats.n])
    dispSheet.addRow(["min", data.dispersionStats.min])
    dispSheet.addRow(["max", data.dispersionStats.max])
    dispSheet.addRow(["p10", data.dispersionStats.p10])
    dispSheet.addRow(["p25", data.dispersionStats.p25])
    dispSheet.addRow(["p50", data.dispersionStats.p50])
    dispSheet.addRow(["p75", data.dispersionStats.p75])
    dispSheet.addRow(["p90", data.dispersionStats.p90])
    dispSheet.addRow(["iqr", data.dispersionStats.iqr])
    dispSheet.addRow(["top_decile_mean", data.dispersionStats.top_decile_mean])
    dispSheet.addRow(["bottom_decile_mean", data.dispersionStats.bottom_decile_mean])
    dispSheet.addRow(["spread_top_bottom", data.dispersionStats.spread_top_bottom])
    dispSheet.addRow(["share_ge_70", data.dispersionStats.share_ge_70])
    dispSheet.addRow(["share_ge_80", data.dispersionStats.share_ge_80])
    dispSheet.addRow(["dominant_bin", data.dispersionStats.dominant_bin])
    dispSheet.addRow(["dominant_bin_share", data.dispersionStats.dominant_bin_share])
    dispSheet.addRow(["dispersion_level", data.dispersionStats.dispersion_level])
    dispSheet.addRow(["tail_description", data.dispersionStats.tail_description])
    dispSheet.addRow(["concentration_phrase", data.dispersionStats.concentration_phrase])
    dispSheet.addRow(["high_score_cohort_phrase", data.dispersionStats.high_score_cohort_phrase])
    dispSheet.getRow(1).font = { bold: true }
    dispSheet.columns = [{ width: 25 }, { width: 15 }]

    const scoreSheet = workbook.addWorksheet("Top_By_Opportunity_Score")
    scoreSheet.addRow([
      "Bank",
      "City",
      "State",
      "Total Assets",
      "CRE Loans",
      "Total UC",
      "CRE UC",
      "CRE/(T1+T2)",
      "CRE/Assets %",
      "NPL %",
      "Opportunity Score",
    ])
    data.topByOpportunityScore.forEach((row) => {
      scoreSheet.addRow([
        row.name,
        row.city ?? "—",
        row.state ?? "—",
        row.totalAssets,
        row.creLoans,
        row.totalUnusedCommitments ?? "—",
        row.creUnusedCommitments ?? "—",
        row.capitalRatios?.creToTier1Tier2 ?? "—",
        row.creConcentration ?? "—",
        row.nplRatio != null ? (row.nplRatio as number) * 100 : "—",
        row.opportunityScore,
      ])
    })

    const xlsxBuffer = await workbook.xlsx.writeBuffer() as Buffer

    const zip = new JSZip()
    zip.file(`Executive_Report_${scope.replace(/\s+/g, "_")}_${date}.pdf`, pdfBytes)
    zip.file(`Executive_Pack_${scope.replace(/\s+/g, "_")}_${date}.xlsx`, xlsxBuffer)

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" })

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="Executive_Report_${scope.replace(/\s+/g, "_")}_${date}.zip"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("Export market analytics error:", err)
    return NextResponse.json(
      { error: "Export failed", ...(process.env.NODE_ENV === "development" && { detail: message }) },
      { status: 500 }
    )
  }
}
