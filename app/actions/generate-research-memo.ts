"use server"

import type { ResearchReport } from "@/app/actions/fetch-research-feed"

export type DealInputs = {
  propertyAddress?: string
  assetType?: string
  loanAmount?: string
  borrower?: string
  lender?: string
  strategy?: string           // e.g. "Note Sale", "REO", "Payoff", "Workout"
  acquisitionBasis?: string
  additionalNotes?: string
}

export type MemoSection = {
  heading: string
  body: string                // plain prose paragraph(s)
  bullets?: string[]          // optional supporting bullets
}

export type GeneratedMemo = {
  type: "market" | "ic"
  title: string
  date: string
  sections: MemoSection[]
  disclaimer: string
}

function formatReportsContext(reports: ResearchReport[]): string {
  return reports
    .map((r, i) =>
      [
        `[${i + 1}] ${r.publisher} — "${r.title}" (${r.publishedDate || "recent"})`,
        `Topic: ${r.topic}`,
        `Summary: ${r.summary}`,
        `Key Findings:`,
        ...r.keyFindings.map((f) => `  • ${f}`),
      ].join("\n")
    )
    .join("\n\n")
}

function buildMarketMemoPrompt(reports: ResearchReport[]): string {
  return `You are a senior analyst at a distressed commercial real estate debt investment firm.

Using ONLY the research reports provided below, write a comprehensive Market Conditions Memo.
Do not invent data points — only use what is stated in the reports. Cite publisher names inline (e.g. "According to Trepp...").

SELECTED RESEARCH REPORTS:
${formatReportsContext(reports)}

Write the memo in the following structure. Return ONLY valid JSON:
{
  "title": "CRE Market Conditions Brief — [current month and year]",
  "sections": [
    {
      "heading": "Executive Summary",
      "body": "3-4 sentence overview of current CRE market conditions drawn from the research",
      "bullets": ["key signal 1", "key signal 2", "key signal 3"]
    },
    {
      "heading": "CRE Debt & Capital Markets Environment",
      "body": "Paragraph covering lending conditions, CMBS, distress signals, maturity walls, special servicing trends",
      "bullets": ["specific data point", "specific data point", "specific data point"]
    },
    {
      "heading": "Regional Market Context",
      "body": "Paragraph on Florida/Southeast conditions if covered in reports, otherwise broader regional dynamics",
      "bullets": ["specific data point", "specific data point"]
    },
    {
      "heading": "Property Type Outlooks",
      "body": "Summary of conditions for property types covered in selected reports",
      "bullets": ["property type + key stat", "property type + key stat"]
    },
    {
      "heading": "Risk Factors & Headwinds",
      "body": "Key risks and challenges identified across the research",
      "bullets": ["risk 1", "risk 2", "risk 3"]
    },
    {
      "heading": "Tailwinds Supporting Investment Activity",
      "body": "Factors that support opportunistic or distressed investing in current environment",
      "bullets": ["tailwind 1", "tailwind 2", "tailwind 3"]
    }
  ]
}`
}

function buildICMemoPrompt(reports: ResearchReport[], deal: DealInputs): string {
  const dealBlock = [
    deal.propertyAddress ? `Property: ${deal.propertyAddress}` : null,
    deal.assetType ? `Asset Type: ${deal.assetType}` : null,
    deal.loanAmount ? `Loan Amount: ${deal.loanAmount}` : null,
    deal.borrower ? `Borrower/Sponsor: ${deal.borrower}` : null,
    deal.lender ? `Lender/Servicer: ${deal.lender}` : null,
    deal.strategy ? `Investment Strategy: ${deal.strategy}` : null,
    deal.acquisitionBasis ? `Acquisition Basis: ${deal.acquisitionBasis}` : null,
    deal.additionalNotes ? `Additional Notes: ${deal.additionalNotes}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  return `You are a senior analyst at a distressed commercial real estate debt investment firm writing an Investment Committee Memorandum.

Use the deal information and research reports below to write a comprehensive IC Memo.
Weave the market research context directly into the deal analysis — use specific data points from the reports to support the investment thesis.
Cite publisher names inline (e.g. "Trepp data indicates..."). Do not invent facts.

DEAL INFORMATION:
${dealBlock || "No deal specifics provided — write as a general market opportunity memo."}

SUPPORTING MARKET RESEARCH:
${formatReportsContext(reports)}

Write the IC Memo in the following structure. Return ONLY valid JSON:
{
  "title": "Investment Committee Memorandum${deal.propertyAddress ? ` — ${deal.propertyAddress}` : ""}",
  "sections": [
    {
      "heading": "Executive Summary",
      "body": "3-4 sentences: deal overview, strategy, and why current market conditions support this investment",
      "bullets": ["key investment highlight 1", "key investment highlight 2", "key investment highlight 3"]
    },
    {
      "heading": "Deal Overview",
      "body": "Description of the asset, loan, borrower, and acquisition structure based on provided deal information",
      "bullets": ["deal term 1", "deal term 2", "deal term 3"]
    },
    {
      "heading": "Market Context",
      "body": "How current CRE market conditions (drawn from research) create the opportunity for this investment",
      "bullets": ["market data point 1", "market data point 2", "market data point 3"]
    },
    {
      "heading": "Capital Markets & Financing Environment",
      "body": "Lending conditions, credit availability, and how they affect deal execution and exit",
      "bullets": ["financing condition 1", "financing condition 2"]
    },
    {
      "heading": "Regional & Property Type Analysis",
      "body": "Market-specific conditions relevant to the asset's location and property type, supported by research",
      "bullets": ["local market factor 1", "local market factor 2", "local market factor 3"]
    },
    {
      "heading": "Risk Factors",
      "body": "Key risks to the investment thesis including market, execution, and exit risks",
      "bullets": ["risk 1", "risk 2", "risk 3", "risk 4"]
    },
    {
      "heading": "Investment Thesis & Recommendation",
      "body": "Conclusion supporting the investment decision, strategy rationale, and expected outcome",
      "bullets": ["thesis point 1", "thesis point 2", "thesis point 3"]
    }
  ]
}`
}

async function callOpenAI(prompt: string): Promise<string> {
  const API_KEY = process.env.OPENAI_API_KEY?.trim()
  if (!API_KEY) throw new Error("Missing OPENAI_API_KEY")

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert CRE investment analyst. Return ONLY valid JSON as instructed. Write at a professional institutional level.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 3500,
    }),
    cache: "no-store",
  })

  if (!res.ok) {
    const err = await res.text().catch(() => "")
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  return data?.choices?.[0]?.message?.content || ""
}

export async function generateResearchMemo(
  type: "market" | "ic",
  reports: ResearchReport[],
  deal?: DealInputs
): Promise<GeneratedMemo> {
  if (reports.length === 0) throw new Error("No reports selected.")

  const prompt =
    type === "market"
      ? buildMarketMemoPrompt(reports)
      : buildICMemoPrompt(reports, deal ?? {})

  const raw = await callOpenAI(prompt)

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("No JSON returned from AI.")

  const parsed = JSON.parse(match[0])

  const sections: MemoSection[] = (parsed.sections ?? []).map(
    (s: { heading?: string; body?: string; bullets?: string[] }) => ({
      heading: typeof s.heading === "string" ? s.heading.trim() : "",
      body: typeof s.body === "string" ? s.body.trim() : "",
      bullets: Array.isArray(s.bullets)
        ? s.bullets
            .filter((b: unknown) => typeof b === "string")
            .map((b: string) => b.replace(/^\s*[-•]\s*/, "").trim())
        : [],
    })
  )

  return {
    type,
    title:
      typeof parsed.title === "string"
        ? parsed.title.trim()
        : type === "market"
          ? "CRE Market Conditions Brief"
          : "Investment Committee Memorandum",
    date: new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    sections,
    disclaimer:
      "This memo was generated using AI synthesis of selected third-party research reports. It is intended for internal use only and does not constitute investment advice. All data points should be independently verified before use in investment decisions.",
  }
}
