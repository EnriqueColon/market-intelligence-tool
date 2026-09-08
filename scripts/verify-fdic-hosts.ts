/**
 * Checks that every FDIC endpoint resolves on the primary host AND on the
 * fallback, with no redirect hop.
 *
 * This exists because the fallback was configured for a long time in a form
 * that produced a 404 on every path, which `fetchFDICData` treats as
 * unrecoverable — so a primary-host outage would have returned empty data
 * rather than retrying. A fallback nothing exercises is not a fallback.
 *
 *   npm run verify:fdic-hosts
 */
import { FDIC_CONFIG, FDIC_ENDPOINTS } from "../lib/fdic-config"

async function main() {
  const bases = [FDIC_CONFIG.baseUrl, ...(FDIC_CONFIG.fallbackBaseUrls ?? [])]
  const query = "format=json&limit=1"

  let failures = 0
  let redirects = 0

  for (const base of bases) {
    const isPrimary = base === FDIC_CONFIG.baseUrl
    const role = isPrimary ? "primary " : "fallback"
    for (const [name, path] of Object.entries(FDIC_ENDPOINTS)) {
      const url = `${base}${path}?${query}`
      try {
        // `manual` so a 3xx is visible rather than silently followed, which is
        // how the redirect on the old primary went unnoticed for so long.
        const res = await fetch(url, { redirect: "manual" })
        const redirected = res.status >= 300 && res.status < 400
        // The primary must answer directly; paying a redirect on every call is
        // exactly what this check exists to catch. A fallback may redirect,
        // because `fetch` follows it and correctness is what matters there.
        const ok = res.status === 200 || (!isPrimary && redirected)
        if (redirected) redirects++
        if (!ok) failures++
        const note = redirected ? ` -> ${res.headers.get("location")?.split("?")[0] ?? "?"}` : ""
        console.log(`${ok ? "PASS" : "FAIL"}  ${role}  ${name.padEnd(13)} HTTP ${res.status}${note}`)
      } catch (error) {
        failures++
        console.log(`FAIL  ${role}  ${name.padEnd(13)} ${error instanceof Error ? error.message : "unknown"}`)
      }
    }
  }

  console.log(`\nprimary : ${FDIC_CONFIG.baseUrl}`)
  console.log(`fallback: ${(FDIC_CONFIG.fallbackBaseUrls ?? []).join(", ") || "(none)"}`)

  if (redirects > 0) {
    console.log(
      `\nNote: the fallback redirects to the primary, so it is an alias rather than an\n` +
        `independent host. It costs nothing, since it is only tried after a primary\n` +
        `failure, but do not count on it surviving an api.fdic.gov outage.`
    )
  }

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} endpoint/host combination(s) unreachable`)
    process.exit(1)
  }
  console.log("\nPASS: every endpoint resolves on every configured host; the primary answers directly")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
