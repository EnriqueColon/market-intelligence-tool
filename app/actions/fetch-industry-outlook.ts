"use server"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs/promises"
import { buildIndustryOutlookPrompt } from "@/app/services/industry-outlook/buildPrompt"
import { callClaude, getClaudeApiKey } from "@/lib/claude"
import { retrieveSources } from "@/app/services/industry-outlook/retrieveSources"
import {
  IndustryOutlookSchema,
  type IndustryOutlookJson,
  type RetrievedSource,
} from "@/app/services/industry-outlook/schema"

export type IndustryOutlook = IndustryOutlookJson & {
  generatedAt: string
  cachedAt: string
  cacheKey: string
}

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

const execFileAsync = promisify(execFile)
const SQLITE3_CANDIDATES = ["sqlite3", "/usr/bin/sqlite3"] as const
const CACHE_KEY = "industry_outlook:v1"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

function cacheDbPath() {
  return path.join(process.cwd(), "data", "industry_outlook_cache.sqlite")
}

function cacheFilePath() {
  return path.join(process.cwd(), "data", "industry_outlook_cache.json")
}

async function execSqlite(db: string, sql: string): Promise<string> {
  for (const bin of SQLITE3_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(bin, [db, sql], { timeout: 10_000 })
      return String(stdout || "")
    } catch {
      continue
    }
  }
  return ""
}

async function execSqliteJson<T>(db: string, sql: string): Promise<T> {
  for (const bin of SQLITE3_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(bin, ["-json", db, sql], { timeout: 10_000 })
      const text = String(stdout || "").trim()
      return (text ? JSON.parse(text) : []) as T
    } catch {
      continue
    }
  }
  return [] as T
}

async function ensureSqliteTable(dbPath: string) {
  await execSqlite(
    dbPath,
    "CREATE TABLE IF NOT EXISTS industry_outlook_cache (cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)"
  )
}

async function readCacheFromSqlite(): Promise<IndustryOutlook | null> {
  const dbPath = cacheDbPath()
  await ensureSqliteTable(dbPath)
  const rows = await execSqliteJson<Array<{ payload_json: string; updated_at: string }>>(
    dbPath,
    `SELECT payload_json, updated_at FROM industry_outlook_cache WHERE cache_key = '${CACHE_KEY}' LIMIT 1`
  )
  const row = rows[0]
  if (!row) return null
  const parsed = JSON.parse(row.payload_json) as IndustryOutlookJson
  return {
    ...parsed,
    generatedAt: parsed.generatedAt || row.updated_at || nowIso(),
    cachedAt: row.updated_at || nowIso(),
    cacheKey: CACHE_KEY,
  }
}

async function writeCacheToSqlite(payload: IndustryOutlookJson) {
  const dbPath = cacheDbPath()
  await ensureSqliteTable(dbPath)
  const updatedAt = nowIso()
  const payloadJson = JSON.stringify(payload)
  await execSqlite(
    dbPath,
    `INSERT OR REPLACE INTO industry_outlook_cache (cache_key, payload_json, updated_at) VALUES ('${CACHE_KEY}', '${payloadJson.replace(/'/g, "''")}', '${updatedAt}')`
  )
}

async function readCacheFromFile(): Promise<IndustryOutlook | null> {
  try {
    const raw = await fs.readFile(cacheFilePath(), "utf8")
    const parsed = JSON.parse(raw) as { cacheKey: string; cachedAt: string; payload: IndustryOutlookJson }
    if (!parsed?.payload) return null
    return {
      ...parsed.payload,
      generatedAt: parsed.payload.generatedAt || parsed.cachedAt || nowIso(),
      cachedAt: parsed.cachedAt || nowIso(),
      cacheKey: parsed.cacheKey || CACHE_KEY,
    }
  } catch {
    return null
  }
}

async function writeCacheToFile(payload: IndustryOutlookJson) {
  const cachedAt = nowIso()
  const blob = { cacheKey: CACHE_KEY, cachedAt, payload }
  await fs.writeFile(cacheFilePath(), JSON.stringify(blob, null, 2), "utf8")
}

function isFresh(cachedAt: string) {
  const ms = Date.parse(cachedAt)
  if (Number.isNaN(ms)) return false
  return Date.now() - ms <= CACHE_TTL_MS
}

async function callAi(messages: { role: "system" | "user"; content: string }[]): Promise<string | null> {
  if (!getClaudeApiKey()) return null
  const system = messages.find((m) => m.role === "system")?.content || ""
  const user = messages.find((m) => m.role === "user")?.content || ""
  try {
    return await callClaude({
      system,
      user,
      tier: "fast",
      temperature: 0.2,
      maxTokens: 1800,
      webSearch: true,
      maxSearches: 3,
    })
  } catch {
    return null
  }
}

function safeJsonExtract(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}

async function repairJson(raw: string): Promise<IndustryOutlookJson | null> {
  const system =
    "Return ONLY valid JSON matching this schema: keyThemes[], facts{national,florida,miami}, analysis{national,florida,miami}, sources[{title,url}]. No extra keys."
  const user = `Fix to valid JSON only:\n${raw}`
  const repaired = await callAi([
    { role: "system", content: system },
    { role: "user", content: user },
  ])
  if (!repaired) return null
  const extracted = safeJsonExtract(repaired)
  if (!extracted) return null
  try {
    return IndustryOutlookSchema.parse(JSON.parse(extracted))
  } catch {
    return null
  }
}

function buildDegradedOutput(sources: RetrievedSource[]): IndustryOutlookJson {
  return {
    keyThemes: [
      "Distress and refinancing pressure in CRE debt",
      "Selective liquidity and loan workouts",
      "Note sales and foreclosure pipelines",
    ],
    facts: {
      national: "Insufficient retrieved sources to report verified facts.",
      florida: "Insufficient retrieved sources to report verified facts.",
      miami: "Insufficient retrieved sources to report verified facts.",
    },
    analysis: {
      national:
        "LLM analysis (assumptions noted): Assumption: insufficient sources retrieved; unable to provide a verified outlook.",
      florida:
        "LLM analysis (assumptions noted): Assumption: insufficient sources retrieved; unable to provide a verified outlook.",
      miami:
        "LLM analysis (assumptions noted): Assumption: insufficient sources retrieved; unable to provide a verified outlook.",
    },
    sources: sources.map((s) => ({ title: s.title, url: s.url })),
  }
}

function normalizeSources(sources: RetrievedSource[]) {
  return sources.map((s) => ({ title: s.title, url: s.url }))
}

export async function fetchIndustryOutlook(): Promise<IndustryOutlook> {
  const cachedSqlite = await readCacheFromSqlite()
  if (cachedSqlite && isFresh(cachedSqlite.cachedAt)) {
    return cachedSqlite
  }
  const cachedFile = await readCacheFromFile()
  if (cachedFile && isFresh(cachedFile.cachedAt)) {
    return cachedFile
  }

  const retrieved = await retrieveSources()
  const counts = {
    national: retrieved.filter((s) => s.region === "national").length,
    florida: retrieved.filter((s) => s.region === "florida").length,
    miami: retrieved.filter((s) => s.region === "miami").length,
  }
  console.info("industry_outlook: retrieved sources", counts, { total: retrieved.length })

  if (retrieved.length < 3) {
    const degraded = buildDegradedOutput(retrieved)
    await writeCacheToSqlite(degraded)
    await writeCacheToFile(degraded)
    return { ...degraded, generatedAt: nowIso(), cachedAt: nowIso(), cacheKey: CACHE_KEY }
  }

  const prompt = buildIndustryOutlookPrompt(retrieved)
  const raw = await callAi([
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ])
  if (!raw) {
    const degraded = buildDegradedOutput(retrieved)
    await writeCacheToSqlite(degraded)
    await writeCacheToFile(degraded)
    return { ...degraded, generatedAt: nowIso(), cachedAt: nowIso(), cacheKey: CACHE_KEY }
  }

  const extracted = safeJsonExtract(raw)
  let parsed: IndustryOutlookJson | null = null
  if (extracted) {
    try {
      parsed = IndustryOutlookSchema.parse(JSON.parse(extracted))
    } catch {
      parsed = null
    }
  }

  if (!parsed) {
    parsed = await repairJson(raw)
  }

  if (!parsed) {
    const degraded = buildDegradedOutput(retrieved)
    await writeCacheToSqlite(degraded)
    await writeCacheToFile(degraded)
    return { ...degraded, generatedAt: nowIso(), cachedAt: nowIso(), cacheKey: CACHE_KEY }
  }

  if (retrieved.length >= 5 && parsed.sources.length < 3) {
    const retryPrompt = buildIndustryOutlookPrompt(retrieved)
    const retryRaw = await callAi([
      { role: "system", content: retryPrompt.system },
      {
        role: "user",
        content: `${retryPrompt.user}\nIMPORTANT: You MUST include at least 3 sources from SOURCES_CONTEXT in sources[].`,
      },
    ])
    if (retryRaw) {
      const retryExtracted = safeJsonExtract(retryRaw)
      if (retryExtracted) {
        try {
          parsed = IndustryOutlookSchema.parse(JSON.parse(retryExtracted))
        } catch {
          // keep prior parsed
        }
      }
    }
  }

  const finalPayload: IndustryOutlookJson = {
    ...parsed,
    sources: parsed.sources.length ? parsed.sources : normalizeSources(retrieved),
  }

  await writeCacheToSqlite(finalPayload)
  await writeCacheToFile(finalPayload)
  return { ...finalPayload, generatedAt: nowIso(), cachedAt: nowIso(), cacheKey: CACHE_KEY }
}

