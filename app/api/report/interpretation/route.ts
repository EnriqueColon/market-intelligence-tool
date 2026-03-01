import { NextRequest, NextResponse } from "next/server"
import { generateInterpretation, type InterpretationPayload } from "@/lib/report/interpretation"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = body as InterpretationPayload
    if (!payload.vizType || !payload.scope || !payload.stats) {
      return NextResponse.json({ error: "Missing vizType, scope, or stats" }, { status: 400 })
    }
    const result = await generateInterpretation({
      ...payload,
      asOfQuarter: payload.asOfQuarter || "Latest",
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error("Interpretation API error:", err)
    return NextResponse.json(
      { error: "Interpretation failed" },
      { status: 500 }
    )
  }
}
