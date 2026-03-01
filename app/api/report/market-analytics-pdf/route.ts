import { NextRequest, NextResponse } from "next/server"
import { chromium } from "playwright"

const MARGIN_INCH = 1
const MARGIN_PX = MARGIN_INCH * 96 // 96 DPI
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  let browser
  try {
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get("scope")?.trim() || "National"
    const state = searchParams.get("state")?.trim()
    const limit = searchParams.get("limit")?.trim()

    // APP_URL should be configured for production server-to-server calls.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.APP_URL || "http://localhost:3000"
    const params = new URLSearchParams()
    params.set("scope", state || scope)
    if (limit) params.set("limit", limit)
    const reportUrl = `${baseUrl}/report/market-analytics?${params.toString()}`

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })
    const page = await browser.newPage()

    await page.goto(reportUrl, { waitUntil: "networkidle", timeout: 60000 })

    await page.waitForSelector("[data-report-ready]", { timeout: 30000 }).catch(() => {
      // Proceed if selector not found (e.g. empty data)
    })

    // Wait for Recharts SVGs to render (charts use SVG)
    await page.waitForSelector("svg.recharts-surface", { timeout: 10000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 1500))

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: {
        top: `${MARGIN_INCH}in`,
        right: `${MARGIN_INCH}in`,
        bottom: `${MARGIN_INCH}in`,
        left: `${MARGIN_INCH}in`,
      },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `
        <div style="font-size: 8px; color: #64748b; width: 100%; padding: 0 8px; display: flex; justify-content: space-between; align-items: center;">
          <span>Confidential — For Internal Use Only</span>
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `,
    })

    await browser.close()

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Executive_Report_${scope.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    })
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    console.error("PDF generation error:", err)
    return NextResponse.json(
      { error: "PDF generation failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
