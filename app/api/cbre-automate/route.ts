import { NextResponse } from "next/server"
import { spawn } from "child_process"
import path from "path"

export const maxDuration = 60
export const runtime = "nodejs"

type CbreAutomateBody = {
  tab?: "market-reports" | "insights"
  propertyType?: string
  region?: string
  country?: string
  market?: string
  topic?: string
}

export async function POST(request: Request) {
  // This endpoint launches a detached local process and is not compatible with
  // Vercel serverless functions (ephemeral runtime + no long-lived child process).
  if (process.env.VERCEL === "1") {
    return NextResponse.json(
      { error: "CBRE automation is unavailable on Vercel. Run this endpoint in local/self-hosted Node runtime." },
      { status: 501 }
    )
  }

  let body: CbreAutomateBody = {}
  try {
    body = (await request.json()) as CbreAutomateBody
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    )
  }

  const args: string[] = []
  if (body.tab) args.push(`--tab=${body.tab}`)
  if (body.propertyType) args.push(`--propertyType=${body.propertyType}`)
  if (body.region) args.push(`--region=${body.region}`)
  if (body.country) args.push(`--country=${body.country}`)
  if (body.market) args.push(`--market=${body.market}`)
  if (body.topic) args.push(`--topic=${body.topic}`)

  const scriptPath = path.join(process.cwd(), "scripts", "cbre-automate.ts")

  return new Promise<NextResponse>((resolve) => {
    const child = spawn("npx", ["tsx", scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env },
    })

    child.on("error", (err) => {
      resolve(
        NextResponse.json(
          { error: "Failed to start automation", detail: String(err) },
          { status: 500 }
        )
      )
    })

    // Resolve immediately – browser stays open for user to interact
    child.unref()
    resolve(NextResponse.json({ ok: true, message: "CBRE automation started" }))
  })
}
