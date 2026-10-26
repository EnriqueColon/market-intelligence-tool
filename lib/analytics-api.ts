import "server-only"
import { NextResponse } from "next/server"
import {
  authorize,
  buildMeta,
  describeBytes,
  responseSizeShare,
  responseSizeVerdict,
  type ApiMeta,
} from "@/lib/analytics/api-contract"

/**
 * Next-bound half of the Market Analytics data API. The decisions live in
 * `lib/analytics/api-contract.ts`; this turns them into responses.
 *
 * `middleware.ts` lets `/api/analytics` past the login wall, so every route
 * must call `requireApiKey` first and return its response if it gets one.
 */

const NO_STORE = { "Cache-Control": "private, no-store" } as const

export function requireApiKey(request: Request): NextResponse | null {
  const decision = authorize(request.headers.get("authorization"), process.env.ANALYTICS_API_KEY)
  if (decision === "ok") return null
  if (decision === "unconfigured") {
    return NextResponse.json(
      { ok: false, error: "The analytics API is not configured on this deployment (ANALYTICS_API_KEY is unset)." },
      { status: 503, headers: NO_STORE }
    )
  }
  return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401, headers: NO_STORE })
}

export function ok<T extends object>(body: T, meta: ApiMeta): NextResponse {
  return NextResponse.json({ ok: true, meta, ...body }, { headers: NO_STORE })
}

/**
 * A response that would exceed what the platform will send.
 *
 * 413 rather than a 500 from the platform, and rather than a 200 carrying a
 * silently truncated cohort — a consumer that receives fewer rows than it asked
 * for and no indication of it will compute wrong figures and never know. The
 * message names the parameter that fixes it, because a consumer cannot guess
 * that a response has a size limit or that chunking is available.
 */
export function payloadTooLarge(error: string, detail: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error, ...detail }, { status: 413, headers: NO_STORE })
}

/**
 * Serialise a body once and decide whether it can be sent.
 *
 * Returns the bytes alongside the verdict so a route can both refuse an
 * oversized response and report the size on one that is merely close — the
 * second is how a consumer learns the ceiling is approaching before it is hit.
 */
export function measureResponse(body: unknown): { bytes: number; verdict: ReturnType<typeof responseSizeVerdict>; human: string; share: number } {
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8")
  return {
    bytes,
    verdict: responseSizeVerdict(bytes),
    human: describeBytes(bytes),
    share: responseSizeShare(bytes),
  }
}

export function badRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400, headers: NO_STORE })
}

/** The cached getters report upstream failure as `{ ok: false }`; that is a 502 here, never cached. */
export function upstreamFailure(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 502, headers: NO_STORE })
}

export { buildMeta }
