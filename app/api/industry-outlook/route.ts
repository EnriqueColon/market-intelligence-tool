import { NextResponse } from "next/server"
import { getCachedIndustryOutlook } from "@/app/services/industry-outlook/getCachedOutlook"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST() {
  const text = await getCachedIndustryOutlook()
  return NextResponse.json({ text })
}
