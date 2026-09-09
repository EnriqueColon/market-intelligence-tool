/**
 * Checks the FDIC latest-quarter probe, which is now load-bearing: its answer
 * is a component of the Market Analytics cache keys, so if it silently returns
 * the wrong quarter the tab serves stale figures for up to a week, and if it
 * returns an unstable value every visitor misses the cache and pays 22 seconds.
 *
 * The failure this guards against already happened once. FDIC nests each row
 * under `data`, `fetchFDICData` flattens it, and reading the nested shape
 * through the client yielded `undefined` — which fell through to the
 * date-derived fallback without any error, so the tool would have looked fine
 * while being keyed to a quarter FDIC never confirmed.
 *
 *   npm run verify:latest-quarter
 */
import { fetchFDICData } from "../lib/fdic-client"
import { FDIC_ENDPOINTS } from "../lib/fdic-config"

type FdicRow = { REPDTE?: string | number; data?: { REPDTE?: string | number } }

async function main() {
  let failures = 0
  const fail = (msg: string) => {
    console.log(`  FAIL ${msg}`)
    failures++
  }

  const t0 = Date.now()
  const response = await fetchFDICData<FdicRow>(FDIC_ENDPOINTS.financials, {
    limit: 1,
    fields: ["REPDTE"],
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  const elapsed = Date.now() - t0

  if (response.error) fail(`probe returned an error: ${response.error}`)

  const row = response.data?.[0]
  const repdte = row?.REPDTE ?? row?.data?.REPDTE
  const quarter = String(repdte ?? "").replace(/-/g, "")

  console.log(`latest quarter : ${quarter || "(none)"}`)
  console.log(`probe cost     : ${elapsed}ms`)
  console.log(`row shape      : ${JSON.stringify(row)}`)

  // The whole point is to avoid the fallback. Reaching it means the probe is
  // broken, which is invisible in the app because the fallback works.
  if (!/^\d{8}$/.test(quarter)) {
    fail(`unusable REPDTE ${JSON.stringify(repdte)} — every payload would key to the date-derived fallback`)
  } else {
    const month = quarter.slice(4, 8)
    if (!["0331", "0630", "0930", "1231"].includes(month)) {
      fail(`${quarter} is not a quarter end`)
    }
    // A quarter far in the past means the probe is sorting or filtering wrong.
    const year = Number(quarter.slice(0, 4))
    const thisYear = new Date().getUTCFullYear()
    if (year < thisYear - 1) fail(`${quarter} is more than a year old — check sort_by/sort_order`)
    if (year > thisYear) fail(`${quarter} is in the future`)
  }

  // Stability matters as much as correctness: a value that changes between
  // calls would produce a fresh cache key on every request.
  const second = await fetchFDICData<FdicRow>(FDIC_ENDPOINTS.financials, {
    limit: 1,
    fields: ["REPDTE"],
    sort_by: "REPDTE",
    sort_order: "DESC",
  })
  const secondRow = second.data?.[0]
  const secondQuarter = String(secondRow?.REPDTE ?? secondRow?.data?.REPDTE ?? "").replace(/-/g, "")
  if (secondQuarter !== quarter) fail(`unstable: ${quarter} then ${secondQuarter}`)

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} problem(s)`)
    process.exit(1)
  }
  console.log(`\nPASS: probe returns ${quarter}, stable across calls`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
