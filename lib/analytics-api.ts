import "server-only"
import { NextResponse } from "next/server"
import { authorize, buildMeta, type ApiMeta } from "@/lib/analytics/api-contract"

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

export function badRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400, headers: NO_STORE })
}

/** The cached getters report upstream failure as `{ ok: false }`; that is a 502 here, never cached. */
export function upstreamFailure(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 502, headers: NO_STORE })
}

export { buildMeta }
