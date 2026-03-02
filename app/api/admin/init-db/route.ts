import { NextRequest, NextResponse } from "next/server"
import { isDbEnabled, sql } from "@/lib/db"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-admin-init-token")
  if (!token || token !== process.env.ADMIN_INIT_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isDbEnabled()) {
    return NextResponse.json(
      { error: "POSTGRES_URL is not configured" },
      { status: 500 }
    )
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS research_reports (
        id SERIAL PRIMARY KEY,
        producer TEXT NOT NULL,
        title TEXT NOT NULL,
        landing_url TEXT NOT NULL,
        document_url TEXT NOT NULL,
        document_type TEXT NOT NULL,
        published_date DATE NULL,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        tags JSONB NULL,
        url_hash TEXT UNIQUE NOT NULL
      );
    `

    await sql`
      CREATE TABLE IF NOT EXISTS research_summaries (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES research_reports(id) ON DELETE CASCADE,
        summary_json JSONB NOT NULL,
        model_provider TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(report_id)
      );
    `

    await sql`
      CREATE TABLE IF NOT EXISTS research_search_cache (
        id SERIAL PRIMARY KEY,
        query_hash TEXT UNIQUE NOT NULL,
        query_json JSONB NOT NULL,
        results_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `

    await sql`CREATE INDEX IF NOT EXISTS research_reports_producer_idx ON research_reports (producer);`
    await sql`CREATE INDEX IF NOT EXISTS research_reports_published_date_desc_idx ON research_reports (published_date DESC);`
    await sql`CREATE INDEX IF NOT EXISTS research_reports_discovered_at_desc_idx ON research_reports (discovered_at DESC);`
    await sql`CREATE INDEX IF NOT EXISTS research_summaries_updated_at_desc_idx ON research_summaries (updated_at DESC);`

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[init-db] Failed to initialize DB tables:", err)
    return NextResponse.json(
      { error: "Failed to initialize database tables" },
      { status: 500 }
    )
  }
}
