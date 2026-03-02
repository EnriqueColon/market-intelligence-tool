import { NextRequest, NextResponse } from "next/server"
import { isDbEnabled } from "@/lib/db"
import { runInstitutionalResearchIngestion } from "@/app/ingestion/run-ingestion"

export const runtime = "nodejs"

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
    return NextResponse.json(
      { error: "Ingestion failed" },
      { status: 500 }
    )
  }
}
