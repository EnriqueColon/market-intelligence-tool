"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Newspaper } from "lucide-react"

const INDUSTRY_OUTLOOK_SESSION_KEY = "industry-outlook:v4"
let industryOutlookMemoryCache: string | null = null
let industryOutlookInFlight: Promise<string | null> | null = null

async function generateIndustryOutlookOnce(): Promise<string | null> {
  if (industryOutlookInFlight) return industryOutlookInFlight

  industryOutlookInFlight = (async () => {
    const res = await fetch("/api/industry-outlook", { method: "POST" })
    if (!res.ok) throw new Error("Request failed")
    const json = (await res.json()) as { text?: string }
    const text = json.text?.trim() || null
    if (text) {
      industryOutlookMemoryCache = text
      try {
        sessionStorage.setItem(INDUSTRY_OUTLOOK_SESSION_KEY, text)
      } catch {
        // Ignore storage failures (private mode/quota), keep memory cache.
      }
    }
    return text
  })()

  try {
    return await industryOutlookInFlight
  } finally {
    industryOutlookInFlight = null
  }
}

export function IndustryOutlook() {
  const [data, setData] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const cleanLine = (line: string) =>
    line
      .replace(/\*\*/g, "")
      .replace(/^\s*[•\-]?\s*\d+\)\s*/i, "")
      .replace(/^\s*[•\-]\s*/, "")
      .trim()

  const extractSources = (text: string) => {
    const lines = text.split(/\r?\n/).map(cleanLine)
    const idx = lines.findIndex((line) => {
      const lowered = line.trim().toLowerCase()
      return (
        lowered.includes("key sources") ||
        lowered.includes("sources (for further reading)")
      )
    })
    if (idx === -1) return { body: text, sources: [] as Array<{ title: string; url: string }>, rawSourceLines: [] }
    const body = lines.slice(0, idx).join("\n").trim()
    const rawSourceLines = lines.slice(idx + 1).map((l) => l.trim()).filter(Boolean)
    const urlRegex = /https?:\/\/[^\s)\]\>\"]+/
    const markdownLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/
    const sources = rawSourceLines
      .map((line) => {
        // Try markdown format [title](url) first
        const mdMatch = line.match(markdownLinkRegex)
        if (mdMatch) {
          const [, title, url] = mdMatch
          let cleanUrl = url.replace(/[.,;:!?)\]\>]+$/, "").trim()
          try {
            cleanUrl = decodeURIComponent(cleanUrl)
          } catch {
            /* keep as-is */
          }
          if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
            return { title: (title || cleanUrl).trim(), url: cleanUrl }
          }
        }
        // Fall back to "Title — https://url" format
        const urlMatch = line.match(urlRegex)
        if (!urlMatch) return null
        let url = urlMatch[0].replace(/[.,;:!?)\]\>]+$/, "").trim()
        try {
          url = decodeURIComponent(url)
        } catch {
          /* keep original */
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) return null
        const title = line
          .replace(urlRegex, "")
          .replace(/^[•\-]\s*|\s*[—\-–:]\s*$/g, "")
          .trim()
        return { title: title || url, url }
      })
      .filter((s): s is { title: string; url: string } => Boolean(s) && Boolean(s.url))
    return { body, sources, rawSourceLines }
  }

  /** Renders text with URLs as clickable links */
  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s)\]\>\"]+)/
    const parts = text.split(urlRegex)
    return parts.map((part, i) => {
      if (!part.match(/^https?:\/\//)) return part
      const href = part.replace(/[.,;:!?)\]\>]+$/, "").trim()
      if (!href.startsWith("http://") && !href.startsWith("https://")) return part
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#006D95] underline hover:text-[#005a7a]"
        >
          {part}
        </a>
      )
    })
  }

  const stripReferences = (text: string) =>
    text.replace(/\[[0-9]+\]/g, "").replace(/\(\s*[0-9]+\s*\)/g, "").replace(/\s{2,}/g, " ").trim()

  const sectionize = (text: string) => {
    const headings = [
      "Executive Summary",
      "U.S. commercial real estate outlook (CRE debt & distress)",
      "Miami-specific CRE and distressed-debt outlook",
      "How this shapes distressed-debt investing",
    ]
    const sections: Array<{ heading: string; bullets: string[] }> = []
    const normalized = headings.reduce((acc, heading) => {
      const pattern = new RegExp(`\\s+(${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")})`, "gi")
      return acc.replace(pattern, "\n$1")
    }, text)
    const lines = normalized
      .split(/\r?\n/)
      .map((l) => cleanLine(l))
      .filter(Boolean)
    let current: { heading: string; bullets: string[] } | null = null

    for (const line of lines) {
      const cleanedLine = stripReferences(cleanLine(line))
      const heading = headings.find((h) => cleanedLine.toLowerCase().startsWith(h.toLowerCase()))
      if (heading) {
        if (current) sections.push({ heading: current.heading, bullets: current.bullets })
        current = { heading, bullets: [] }
        const remainder = cleanedLine.slice(heading.length).trim()
        if (remainder) {
          const parts = remainder
            .split("•")
            .map((p) => p.trim())
            .filter(Boolean)
          if (parts.length) current.bullets.push(...parts)
        }
        continue
      }
      if (!current) {
        current = { heading: "Executive Summary", bullets: [] }
      }
      const parts = cleanedLine
        .split("•")
        .map((p) => p.trim())
        .filter(Boolean)
      if (parts.length) {
        current.bullets.push(...parts)
      }
    }
    if (current) sections.push({ heading: current.heading, bullets: current.bullets })

    const deduped: Array<{ heading: string; bullets: string[] }> = []
    const seen = new Map<string, { section: { heading: string; bullets: string[] }; index: number }>()
    for (const section of sections) {
      const key = section.heading.toLowerCase()
      const existing = seen.get(key)
      const hasContent = section.bullets.length > 0
      const existingHasContent = existing ? existing.section.bullets.length > 0 : false
      if (!existing) {
        seen.set(key, { section, index: deduped.length })
        deduped.push(section)
      } else if (hasContent && !existingHasContent) {
        deduped[existing.index] = section
        seen.set(key, { section, index: existing.index })
      } else if (hasContent && existingHasContent && section.bullets.length > existing.section.bullets.length) {
        deduped[existing.index] = section
        seen.set(key, { section, index: existing.index })
      }
    }
    return deduped.filter((s) => s.bullets.length > 0)
  }


  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        if (industryOutlookMemoryCache) {
          if (!mounted) return
          setData(industryOutlookMemoryCache)
          setError(false)
          return
        }
        try {
          const cached = sessionStorage.getItem(INDUSTRY_OUTLOOK_SESSION_KEY)?.trim() || ""
          if (cached) {
            industryOutlookMemoryCache = cached
            if (!mounted) return
            setData(cached)
            setError(false)
            return
          }
        } catch {
          // Ignore sessionStorage read failures and continue to network path.
        }

        const text = await generateIndustryOutlookOnce()
        if (!mounted) return
        setData(text)
        setError(false)
      } catch {
        if (!mounted) return
        setData(null)
        setError(true)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <div className="flex items-center gap-2 mb-4">
        <Newspaper className="h-5 w-5 text-[#006D95]" />
        <h3 className="text-base font-semibold text-slate-800">Industry Outlook</h3>
        <span className="text-xs text-slate-900 ml-auto">Recent</span>
      </div>

      {loading ? (
        <div className="text-sm text-slate-900">Generating industry outlook…</div>
      ) : error || !data ? (
        <div className="text-sm text-slate-900">Unable to generate outlook right now.</div>
      ) : (
        (() => {
          const { body, sources, rawSourceLines } = extractSources(data)
          const sections = sectionize(stripReferences(body))

          const execSummary = sections.find((s) => s.heading.toLowerCase().includes("executive"))
          const nationalSection = sections.find((s) => s.heading.toLowerCase().includes("u.s.") || s.heading.toLowerCase().includes("commercial real estate outlook"))
          const miamiSection = sections.find((s) => s.heading.toLowerCase().includes("miami"))
          const investingSection = sections.find((s) => s.heading.toLowerCase().includes("shapes"))
          const otherSections = sections.filter(
            (s) => s !== execSummary && s !== nationalSection && s !== miamiSection && s !== investingSection
          )

          return (
            <div className="space-y-5">
              {/* Key Signals Strip — Executive Summary bullets as callout cards */}
              {execSummary && execSummary.bullets.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Key Signals</div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {execSummary.bullets.map((bullet, i) => (
                      <div key={`sig-${i}`} className="rounded-lg border border-[#006D95]/20 bg-[#006D95]/5 px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 h-2 w-2 rounded-full bg-[#006D95]" />
                          <p className="text-xs text-slate-800 leading-relaxed">{bullet}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2-column: National | Miami/FL — only use grid when both are present */}
              {(nationalSection || miamiSection) && (
                <div className={nationalSection && miamiSection ? "grid gap-4 sm:grid-cols-2" : ""}>
                  {nationalSection && (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-slate-400" />
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">U.S. National</div>
                      </div>
                      <ul className="space-y-1.5">
                        {nationalSection.bullets.map((b, i) => (
                          <li key={`nat-${i}`} className="flex items-start gap-1.5 text-xs text-slate-800 leading-relaxed">
                            <span className="mt-1.5 flex-shrink-0 h-1 w-1 rounded-full bg-slate-300" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {miamiSection && (
                    <div className="rounded-lg border border-[#006D95]/30 bg-white p-4 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-[#006D95]" />
                        <div className="text-xs font-semibold text-[#006D95] uppercase tracking-wide">Miami / Florida</div>
                      </div>
                      <ul className="space-y-1.5">
                        {miamiSection.bullets.map((b, i) => (
                          <li key={`mia-${i}`} className="flex items-start gap-1.5 text-xs text-slate-800 leading-relaxed">
                            <span className="mt-1.5 flex-shrink-0 h-1 w-1 rounded-full bg-[#006D95]/40" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* How this shapes investing — full width */}
              {investingSection && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">How This Shapes Distressed-Debt Investing</div>
                  <ul className="space-y-1.5">
                    {investingSection.bullets.map((b, i) => (
                      <li key={`inv-${i}`} className="flex items-start gap-1.5 text-xs text-slate-800 leading-relaxed">
                        <span className="mt-1.5 flex-shrink-0 h-1 w-1 rounded-full bg-slate-400" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Any remaining sections */}
              {otherSections.map((section, idx) => (
                <div key={`other-${idx}`} className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700 uppercase">{section.heading}</div>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-900 leading-relaxed">
                    {section.bullets.map((b, bIdx) => (
                      <li key={`other-${idx}-b-${bIdx}`}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* Fallback if no sections parsed */}
              {sections.length === 0 && (
                <p className="text-sm text-slate-900 leading-relaxed">{stripReferences(body)}</p>
              )}

            </div>
          )
        })()
      )}
    </Card>
  )
}

