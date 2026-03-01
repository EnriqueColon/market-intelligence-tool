import { NextRequest, NextResponse } from "next/server"
import { getMapBanksData } from "@/app/actions/map-data"
import type { MapMetric } from "@/lib/map-stress-utils"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const bboxParam = searchParams.get("bbox")
    if (!bboxParam) {
      return NextResponse.json(
        { error: "bbox parameter is required (west,south,east,north)" },
        { status: 400 }
      )
    }
    const [west, south, east, north] = bboxParam.split(",").map(Number)
    if (
      !Number.isFinite(west) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(north)
    ) {
      return NextResponse.json(
        { error: "Invalid bbox values" },
        { status: 400 }
      )
    }
    const state = searchParams.get("state") ?? undefined
    const quarter = searchParams.get("quarter") ?? undefined
    const metric = (searchParams.get("metric") ?? "composite") as MapMetric

    const data = await getMapBanksData(
      { west, south, east, north },
      state,
      quarter,
      metric
    )
    return NextResponse.json(data)
  } catch (err) {
    console.error("Map banks API error:", err)
    return NextResponse.json(
      { error: "Failed to fetch map banks data" },
      { status: 500 }
    )
  }
}
