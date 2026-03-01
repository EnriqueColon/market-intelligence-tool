import { NextRequest, NextResponse } from "next/server"
import { getMapStatesData } from "@/app/actions/map-data"
import type { MapMetric } from "@/lib/map-stress-utils"
export const runtime = "nodejs"

function defaultThreshold(metric: MapMetric): number {
  return metric === "creCapital" ? 4.0 : 70
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const quarter = searchParams.get("quarter") ?? undefined
    const metric = (searchParams.get("metric") ?? "composite") as MapMetric
    const thresholdParam = searchParams.get("threshold")
    const threshold = Number(thresholdParam) || defaultThreshold(metric)
    const debug = searchParams.get("debug") === "1"

    const data = await getMapStatesData(quarter, metric, threshold, debug)
    return NextResponse.json(data)
  } catch (err) {
    console.error("Map states API error:", err)
    return NextResponse.json(
      { error: "Failed to fetch map states data" },
      { status: 500 }
    )
  }
}
