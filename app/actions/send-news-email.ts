"use server"

import { Resend } from "resend"
import { fetchIndustryOutlook } from "@/app/actions/fetch-industry-outlook"
import { fetchPublicMentions, type PublicMentionItem } from "@/app/actions/fetch-public-mentions"

type SendInput = { token: string; level?: "national" | "florida" | "miami" }

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value.trim()
}

function parseRecipients(raw: string) {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function accessLabel(status?: string) {
  if (status === "open") return "open"
  if (status === "paywalled") return "paywalled"
  return "partial"
}

function dedupeMentions(items: PublicMentionItem[]) {
  const seen = new Set<string>()
  const out: PublicMentionItem[] = []
  for (const item of items) {
    const key = item.url ? `u:${item.url}` : `t:${item.source || ""}:${item.title}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

export async function sendNewsEmail(
  input: SendInput
): Promise<{ ok: true; sentToCount: number }> {
  const apiKey = requireEnv("RESEND_API_KEY")
  const recipientsRaw = requireEnv("NEWS_RECIPIENTS")
  const from = requireEnv("NEWS_FROM_EMAIL")
  const tokenGate = requireEnv("NEWS_SEND_TOKEN")

  if (!input?.token || input.token !== tokenGate) {
    throw new Error("Invalid admin token.")
  }

  const recipients = parseRecipients(recipientsRaw)
  if (recipients.length === 0) {
    throw new Error("NEWS_RECIPIENTS must include at least one email.")
  }

  const [outlook, nationalMentions, floridaMentions, miamiMentions] = await Promise.all([
    fetchIndustryOutlook(),
    fetchPublicMentions("national"),
    fetchPublicMentions("florida"),
    fetchPublicMentions("miami"),
  ])

  const mentionsByRegion: Record<"national" | "florida" | "miami", PublicMentionItem[]> = {
    national: [],
    florida: [],
    miami: [],
  }

  const combined = dedupeMentions([
    ...nationalMentions.news,
    ...floridaMentions.news,
    ...miamiMentions.news,
  ])

  for (const item of combined) {
    mentionsByRegion[item.region].push(item)
  }

  const regionLabels: Record<"national" | "florida" | "miami", string> = {
    national: "National",
    florida: "Florida",
    miami: "Miami Metro",
  }

  const now = new Date()
  const subject = `Market Intelligence — News Snapshot (Past 7 Days) — ${formatDate(now)}`

  const themesHtml = outlook.keyThemes.map((t) => `<li>${escapeHtml(t)}</li>`).join("")
  const sourcesHtml = outlook.sources
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title)}</a></li>`
    )
    .join("")

  const mentionsSectionHtml = (region: "national" | "florida" | "miami") => {
    const items = mentionsByRegion[region].slice(0, 20)
    if (items.length === 0) {
      return `<p style="color:#666;font-size:12px;">No qualifying mentions in past 7 days.</p>`
    }
    const rows = items
      .map((item) => {
        const title = escapeHtml(item.title)
        const url = item.resolved_url || item.url || ""
        const source = escapeHtml(item.source || "—")
        const date = escapeHtml(item.date || "—")
        const topic = escapeHtml(item.topic || "—")
        const access = accessLabel(item.access_status)
        const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${title}</a>` : title
        return `<li>${link} — ${source} • ${date} • ${topic} • ${access}</li>`
      })
      .join("")
    return `<ul>${rows}</ul>`
  }

  const html = `
    <div style="font-family:Arial, sans-serif; line-height:1.5;">
      <h2>Market Intelligence — News Snapshot</h2>
      <p style="color:#666;">Generated: ${escapeHtml(now.toLocaleString())}</p>

      <h3>Industry Outlook</h3>
      <p><strong>Key themes</strong></p>
      <ul>${themesHtml}</ul>

      <p><strong>Facts — National</strong></p>
      <p>${escapeHtml(outlook.facts.national)}</p>
      <p><strong>Facts — Florida</strong></p>
      <p>${escapeHtml(outlook.facts.florida)}</p>
      <p><strong>Facts — Miami</strong></p>
      <p>${escapeHtml(outlook.facts.miami)}</p>

      <p><strong>Analysis — National</strong></p>
      <p>${escapeHtml(outlook.analysis.national)}</p>
      <p><strong>Analysis — Florida</strong></p>
      <p>${escapeHtml(outlook.analysis.florida)}</p>
      <p><strong>Analysis — Miami</strong></p>
      <p>${escapeHtml(outlook.analysis.miami)}</p>

      <p><strong>Sources</strong></p>
      <ul>${sourcesHtml}</ul>

      <h3>Industry Specific News</h3>
      <h4>${regionLabels.national}</h4>
      ${mentionsSectionHtml("national")}
      <h4>${regionLabels.florida}</h4>
      ${mentionsSectionHtml("florida")}
      <h4>${regionLabels.miami}</h4>
      ${mentionsSectionHtml("miami")}
    </div>
  `

  const textMentions = (region: "national" | "florida" | "miami") => {
    const items = mentionsByRegion[region].slice(0, 20)
    if (items.length === 0) return "No qualifying mentions in past 7 days."
    return items
      .map((item) => {
        const title = item.title
        const url = item.resolved_url || item.url || ""
        const source = item.source || "—"
        const date = item.date || "—"
        const topic = item.topic || "—"
        const access = accessLabel(item.access_status)
        return `- ${title}${url ? ` (${url})` : ""} — ${source} • ${date} • ${topic} • ${access}`
      })
      .join("\n")
  }

  const text = [
    "Market Intelligence — News Snapshot",
    `Generated: ${now.toLocaleString()}`,
    "",
    "Industry Outlook",
    "Key themes:",
    ...outlook.keyThemes.map((t) => `- ${t}`),
    "",
    "Facts — National",
    outlook.facts.national,
    "",
    "Facts — Florida",
    outlook.facts.florida,
    "",
    "Facts — Miami",
    outlook.facts.miami,
    "",
    "Analysis — National",
    outlook.analysis.national,
    "",
    "Analysis — Florida",
    outlook.analysis.florida,
    "",
    "Analysis — Miami",
    outlook.analysis.miami,
    "",
    "Sources",
    ...outlook.sources.map((s) => `- ${s.title} (${s.url})`),
    "",
    "Industry Specific News — National",
    textMentions("national"),
    "",
    "Industry Specific News — Florida",
    textMentions("florida"),
    "",
    "Industry Specific News — Miami Metro",
    textMentions("miami"),
  ].join("\n")

  const resend = new Resend(apiKey)
  const result = await resend.emails.send({
    from,
    to: recipients,
    subject,
    html,
    text,
  })

  if ((result as any)?.error) {
    throw new Error(`Resend error: ${(result as any).error?.message || "Unknown error"}`)
  }

  return { ok: true, sentToCount: recipients.length }
}
