"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Newspaper } from "lucide-react"

export function IndustryOutlook() {
  const [data, setData] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const extractSources = (text: string) => {
    const lines = text.split(/\r?\n/)
    const idx = lines.findIndex(
      (line) =>
        line.trim().toLowerCase().startsWith("key sources") ||
        line.trim().toLowerCase().startsWith("sources (for further reading)")
    )
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
    const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    let current: { heading: string; bullets: string[] } | null = null

    for (const line of lines) {
      const cleanedLine = stripReferences(line)
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
        const res = await fetch("/api/industry-outlook", { method: "POST" })
        if (!res.ok) throw new Error("Request failed")
        const json = (await res.json()) as { text?: string }
        if (!mounted) return
        setData(json.text?.trim() || null)
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
        <span className="text-xs text-slate-600 ml-auto">Recent</span>
      </div>

      {loading ? (
        <div className="text-sm text-slate-600">Generating industry outlook…</div>
      ) : error || !data ? (
        <div className="text-sm text-slate-600">Unable to generate outlook right now.</div>
      ) : (
        (() => {
          const { body, sources, rawSourceLines } = extractSources(data)
          const sections = sectionize(stripReferences(body))
          return (
            <div className="space-y-4">
              {sections.length > 0 ? (
                <div className="space-y-4">
                  {sections.map((section, idx) => (
                    <div key={`sec-${idx}`} className="space-y-2">
                      <div className="text-xs font-semibold text-slate-700 uppercase">{section.heading}</div>
                      {section.bullets.length ? (
                        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 leading-relaxed">
                          {section.bullets.map((bullet, bIdx) => (
                            <li key={`sec-${idx}-b-${bIdx}`}>{bullet}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-600 leading-relaxed">No content available.</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600 leading-relaxed">{stripReferences(body)}</p>
              )}
              {(sources.length > 0 || rawSourceLines.some((l) => /https?:\/\//.test(l))) ? (
                <div className="pt-4 mt-4 border-t border-slate-200">
                  <div className="text-xs font-semibold text-slate-700 uppercase mb-2">Key Sources (for further reading)</div>
                  <ul className="space-y-2 text-sm">
                    {sources.length > 0
                      ? sources.map((s, idx) => {
                          const href = (s.url || "").trim()
                          const isValidHref = href.startsWith("http://") || href.startsWith("https://")
                          return (
                            <li key={`src-${idx}`}>
                              {isValidHref ? (
                                <a
                                  className="text-[#006D95] underline hover:text-[#005a7a] cursor-pointer"
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {s.title || href}
                                </a>
                              ) : (
                                <span className="text-slate-600">{s.title || s.url}</span>
                              )}
                            </li>
                          )
                        })
                      : rawSourceLines.map((line, idx) => (
                          <li key={`raw-${idx}`}>{renderTextWithLinks(line)}</li>
                        ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )
        })()
      )}
    </Card>
  )
}

