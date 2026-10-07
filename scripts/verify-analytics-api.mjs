/**
 * Exercises the Market Analytics data API against a running deployment and
 * prints what a consumer would see: status, size, timing, and the headline
 * numbers of each payload. Read-only.
 *
 *   BASE_URL=https://<deployment> ANALYTICS_API_KEY=<key> node scripts/verify-analytics-api.mjs [scope] [cert]
 *
 * Defaults: scope Florida, cert 35541 (BCB Community Bank). Exits non-zero if
 * any endpoint fails, including the two negative checks (no key, wrong key).
 */

const base = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "")
const key = process.env.ANALYTICS_API_KEY
const scope = process.argv[2] ?? "Florida"
const cert = process.argv[3] ?? "35541"

if (!key) {
  console.error("ANALYTICS_API_KEY is required (never put it on the command line; export it).")
  process.exit(2)
}

let failures = 0
const fail = (msg) => {
  failures += 1
  console.log(`  FAIL ${msg}`)
}

async function call(path, headers = { authorization: `Bearer ${key}` }) {
  const started = Date.now()
  const res = await fetch(base + path, { headers })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    /* non-JSON */
  }
  return { status: res.status, ms: Date.now() - started, bytes: text.length, body }
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`

console.log(`Market Analytics API at ${base}\n`)

{
  const r = await call("/api/analytics/v1/meta", {})
  console.log(`no key        → ${r.status}`)
  if (r.status !== 401 && r.status !== 503) fail("expected 401 (or 503 when unconfigured) without a key")
}
{
  const r = await call("/api/analytics/v1/meta", { authorization: "Bearer not-the-key" })
  console.log(`wrong key     → ${r.status}`)
  if (r.status !== 401 && r.status !== 503) fail("expected 401 with a wrong key")
}

const meta = await call("/api/analytics/v1/meta")
console.log(`meta          → ${meta.status} ${meta.ms}ms ${kb(meta.bytes)}`)
if (meta.status !== 200) fail(`meta: ${meta.body?.error ?? meta.status}`)
else {
  console.log(`  quarter ${meta.body.meta.quarter}, contract ${meta.body.meta.contractVersion}, ${meta.body.signals.length} signals, ${meta.body.assetBands.length} bands`)
}

const screening = await call(`/api/analytics/v1/screening?scope=${encodeURIComponent(scope)}`)
console.log(`screening     → ${screening.status} ${screening.ms}ms ${kb(screening.bytes)}`)
if (screening.status !== 200) fail(`screening: ${screening.body?.error ?? screening.status}`)
else {
  const p = screening.body.payload
  const top = [...p.rows].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 3)
  console.log(`  scope "${screening.body.meta.scope}", ${p.rows.length} rows of ${p.rawRowCount} raw, quarters ${p.quarters[0]}…${p.quarters.at(-1)}`)
  console.log(`  top opportunity: ${top.map((r) => `${r.name} (${r.id}) ${r.opportunityScore}`).join("; ")}`)
}

const visuals = await call(`/api/analytics/v1/visuals?scope=${encodeURIComponent(scope)}`)
console.log(`visuals       → ${visuals.status} ${visuals.ms}ms ${kb(visuals.bytes)}`)
if (visuals.status !== 200) fail(`visuals: ${visuals.body?.error ?? visuals.status}`)

const watch = await call(`/api/analytics/v1/cohort-watch?scope=${encodeURIComponent(scope)}`)
console.log(`cohort-watch  → ${watch.status} ${watch.ms}ms ${kb(watch.bytes)}`)
if (watch.status !== 200) fail(`cohort-watch: ${watch.body?.error ?? watch.status}`)

const signals = await call(`/api/analytics/v1/behavior-signals?scope=${encodeURIComponent(scope)}`)
console.log(`signals       → ${signals.status} ${signals.ms}ms ${kb(signals.bytes)}`)
if (signals.status !== 200) fail(`behavior-signals: ${signals.body?.error ?? signals.status}`)
else {
  const c = signals.body.cohort
  const firing = c.summaries.filter((s) => s.actionCount >= 2).length
  console.log(`  ${c.institutionCount} institutions, ${c.currentCount} current, ${c.unjudgedCount} unjudged; ${firing} with ≥2 action signals`)
}

const band = await call(`/api/analytics/v1/behavior-signals?scope=${encodeURIComponent(scope)}&band=1b-3b`)
console.log(`signals band  → ${band.status} ${band.ms}ms ${kb(band.bytes)}`)
if (band.status !== 200) fail(`behavior-signals band: ${band.body?.error ?? band.status}`)
else if (band.body.cohort.summaries.some((s) => s.band !== "1b-3b")) fail("band filter returned other bands")

const badBand = await call(`/api/analytics/v1/behavior-signals?scope=${encodeURIComponent(scope)}&band=nope`)
console.log(`bad band      → ${badBand.status}`)
if (badBand.status !== 400) fail("expected 400 for an unknown band")

const badScope = await call(`/api/analytics/v1/screening?scope=Narnia`)
console.log(`bad scope     → ${badScope.status}`)
if (badScope.status !== 400) fail("expected 400 for an unknown scope")

const inst = await call(`/api/analytics/v1/institution/${cert}`)
console.log(`institution   → ${inst.status} ${inst.ms}ms ${kb(inst.bytes)}`)
if (inst.status !== 200) fail(`institution: ${inst.body?.error ?? inst.status}`)
else {
  const b = inst.body
  const fired = b.behavior?.latest?.fired ?? []
  console.log(`  ${b.behavior?.name ?? b.trend?.name ?? cert}: trend ${b.trend ? "ok" : `missing (${b.trendError})`}, behaviour ${b.behavior ? `ok, latest fired [${fired.join(", ")}]` : `missing (${b.behaviorError})`}, ${b.history.acquisitions.length} acquisitions`)
}

const badCert = await call(`/api/analytics/v1/institution/abc`)
console.log(`bad cert      → ${badCert.status}`)
if (badCert.status !== 400) fail("expected 400 for a non-numeric CERT")

console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed")
process.exit(failures ? 1 : 0)
