import { NextRequest, NextResponse } from "next/server"
import { isDbEnabled } from "@/lib/db"
import { runInstitutionalResearchIngestion } from "@/app/ingestion/run-ingestion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-ingestion-token")
  if (!token || token !== process.env.INGESTION_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isDbEnabled()) {
    return NextResponse.json(
      { error: "POSTGRES_URL is required for ingestion" },
      { status: 500 }
    )
  }

  try {
    const result = await runInstitutionalResearchIngestion()
    return NextResponse.json(result)
  } catch (err) {
    console.error("[ingestion-run] Failed:", err)
    const now = new Date().toISOString()
    return NextResponse.json({
      ok: true,
      startedAt: now,
      finishedAt: now,
      elapsedMs: 0,
      producersPlanned: 0,
      producersRun: 0,
      candidatesFound: 0,
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [
        {
          producer: "system",
          stage: "upsert",
          message: err instanceof Error ? err.message : "Ingestion failed",
        },
      ],
    })
  }
}
