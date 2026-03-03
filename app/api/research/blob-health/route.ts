import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function maskToken(token: string): string {
  if (!token) return ""
  if (token.length <= 12) return "***"
  return `${token.slice(0, 8)}...${token.slice(-4)}`
}

export async function GET() {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || ""
  const adminToken = process.env.ADMIN_UPLOAD_TOKEN?.trim() || ""

  return NextResponse.json({
    ok: true,
    runtime: process.release?.name,
    nodeEnv: process.env.NODE_ENV || null,
    vercelEnv: process.env.VERCEL_ENV || null,
    hasBlobReadWriteToken: Boolean(blobToken),
    blobTokenMasked: blobToken ? maskToken(blobToken) : null,
    hasAdminUploadToken: Boolean(adminToken),
    timestamp: new Date().toISOString(),
  })
}
