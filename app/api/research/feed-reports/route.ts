import { NextRequest, NextResponse } from "next/server"
import { sql, isDbEnabled } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Ensure the table exists — runs on every cold start, no-op if already present.
async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS research_feed_cache (
      id            SERIAL PRIMARY KEY,
      report_key    TEXT NOT NULL UNIQUE,   -- dedup key: lower(publisher||title)
      title         TEXT NOT NULL,
      publisher     TEXT NOT NULL,
      published_date TEXT,
      topic         TEXT,
      summary       TEXT,
      key_findings  JSONB,
      url           TEXT,
      fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS research_feed_cache_fetched_at
      ON research_feed_cache (fetched_at DESC)
  `
}

// GET — return all archived reports from the past year
export async function GET() {
  if (!isDbEnabled()) {
    return NextResponse.json({ ok: true, reports: [] })
  }

  try {
    await ensureTable()

    const rows = await sql<{
      report_key: string
      title: string
      publisher: string
      published_date: string | null
      topic: string | null
      summary: string | null
      key_findings: unknown
      url: string | null
      fetched_at: string
    }>`
      SELECT report_key, title, publisher, published_date, topic, summary,
             key_findings, url, fetched_at
      FROM research_feed_cache
      WHERE fetched_at >= NOW() - INTERVAL '1 year'
      ORDER BY fetched_at DESC, publisher ASC
      LIMIT 500
    `

    const reports = rows.rows.map((r) => ({
      id: r.report_key,
      title: r.title,
      publisher: r.publisher,
      publishedDate: r.published_date ?? "",
      topic: r.topic ?? "Market Outlook",
      summary: r.summary ?? "",
      keyFindings: Array.isArray(r.key_findings) ? (r.key_findings as string[]) : [],
      url: r.url ?? "",
      fetchedAt: r.fetched_at,
    }))

    return NextResponse.json({ ok: true, reports })
  } catch (err) {
    console.error("[feed-reports GET]", err)
    return NextResponse.json({ ok: false, reports: [] }, { status: 500 })
  }
}

// POST — upsert a batch of fresh reports + purge anything older than 1 year
export async function POST(request: NextRequest) {
  if (!isDbEnabled()) {
    return NextResponse.json({ ok: true, saved: 0 })
  }

  const body = await request.json().catch(() => null)
  const reports: Array<{
    title: string
    publisher: string
    publishedDate?: string
    topic?: string
    summary?: string
    keyFindings?: string[]
    url?: string
  }> = Array.isArray(body?.reports) ? body.reports : []

  if (reports.length === 0) {
    return NextResponse.json({ ok: true, saved: 0 })
  }

  try {
    await ensureTable()

    // Upsert each report — update fetched_at on conflict so fresh reports
    // always show their latest retrieval time.
    let saved = 0
    for (const r of reports) {
      const key = `${r.publisher.toLowerCase().trim()}::${r.title.toLowerCase().trim()}`.slice(0, 500)
      const keyFindings = JSON.stringify(r.keyFindings ?? [])
      try {
        await sql`
          INSERT INTO research_feed_cache
            (report_key, title, publisher, published_date, topic, summary, key_findings, url, fetched_at)
          VALUES (
            ${key},
            ${r.title},
            ${r.publisher},
            ${r.publishedDate ?? null},
            ${r.topic ?? "Market Outlook"},
            ${r.summary ?? null},
            ${keyFindings}::jsonb,
            ${r.url ?? null},
            NOW()
          )
          ON CONFLICT (report_key) DO UPDATE SET
            topic        = EXCLUDED.topic,
            summary      = EXCLUDED.summary,
            key_findings = EXCLUDED.key_findings,
            url          = EXCLUDED.url,
            fetched_at   = NOW()
        `
        saved++
      } catch {
        // Skip individual insert errors — don't fail the whole batch
      }
    }

    // Purge anything older than 1 year
    await sql`
      DELETE FROM research_feed_cache
      WHERE fetched_at < NOW() - INTERVAL '1 year'
    `

    return NextResponse.json({ ok: true, saved })
  } catch (err) {
    console.error("[feed-reports POST]", err)
    return NextResponse.json({ ok: false, saved: 0 }, { status: 500 })
  }
}
