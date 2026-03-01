 "use server"

 import { fetchMarketResearch, ResearchSection } from "@/app/actions/fetch-market-research"

 export type AiReportSection = {
   title: string
   bullets: string[]
 }

 export type AiMarketReport = {
   headline: string
   summary: string
   highlights: string[]
   sections: AiReportSection[]
   generatedAt: string
   sources: string[]
 }

 type OpenAiResponse = {
   choices?: { message?: { content?: string } }[]
 }

 function flattenMetrics(sections: ResearchSection[], geo: "national" | "miamiDade") {
   return sections.flatMap((section) =>
     (geo === "national" ? section.national : section.miamiDade).map((metric) => ({
       section: section.title,
       label: metric.label,
       value: metric.value ?? null,
       change: metric.change ?? null,
       unit: metric.unit,
       date: metric.date ?? null,
       note: metric.note ?? null,
       source: metric.source,
     }))
   )
 }

 export async function fetchAiMarketReport(geo: "national" | "miamiDade"): Promise<AiMarketReport> {
   const apiKey = process.env.OPENAI_API_KEY
   const data = await fetchMarketResearch()
   const metrics = flattenMetrics(data, geo)
   const sources = [...new Set(metrics.map((metric) => metric.source))].filter(Boolean)

   if (!apiKey) {
     return {
       headline: "AI Market Report",
       summary:
         "OpenAI API key not configured. Add OPENAI_API_KEY to .env.local to enable AI-generated reporting.",
       highlights: [],
       sections: [],
       generatedAt: new Date().toISOString(),
       sources,
     }
   }

   const prompt = `
You are a research analyst. Generate a concise market research report for ${
     geo === "national" ? "the United States" : "Miami-Dade County (proxy)"
   } using the provided public indicator data.

Rules:
- Use only the data supplied in the JSON payload. Do not invent facts.
- Be accurate, cautious, and label proxy limitations if data is a proxy.
- Output must be valid JSON with the exact schema:
{
  "headline": string,
  "summary": string,
  "highlights": string[],
  "sections": [{ "title": string, "bullets": string[] }]
}
- Keep highlights to 3-5 bullets.
- Provide 4-6 sections with 2-4 bullets each.
- If data is missing, say so in the relevant section.

JSON payload:
${JSON.stringify({ metrics }, null, 2)}
`

   const response = await fetch("https://api.openai.com/v1/chat/completions", {
     method: "POST",
     headers: {
       Authorization: `Bearer ${apiKey}`,
       "Content-Type": "application/json",
     },
     body: JSON.stringify({
       model: "gpt-4o-mini",
       temperature: 0.2,
       messages: [
         {
           role: "system",
           content: "Return only JSON. Do not wrap in markdown.",
         },
         {
           role: "user",
           content: prompt,
         },
       ],
     }),
   })

   if (!response.ok) {
     return {
       headline: "AI Market Report",
       summary: "Unable to generate report at this time.",
       highlights: [],
       sections: [],
       generatedAt: new Date().toISOString(),
       sources,
     }
   }

   const json = (await response.json()) as OpenAiResponse
   const content = json.choices?.[0]?.message?.content
   if (!content) {
     return {
       headline: "AI Market Report",
       summary: "Report generation returned no content.",
       highlights: [],
       sections: [],
       generatedAt: new Date().toISOString(),
       sources,
     }
   }

   try {
     const parsed = JSON.parse(content) as Omit<AiMarketReport, "generatedAt" | "sources">
     return {
       ...parsed,
       generatedAt: new Date().toISOString(),
       sources,
     }
   } catch {
     return {
       headline: "AI Market Report",
       summary: "Report generation returned invalid JSON.",
       highlights: [],
       sections: [],
       generatedAt: new Date().toISOString(),
       sources,
     }
   }
 }
