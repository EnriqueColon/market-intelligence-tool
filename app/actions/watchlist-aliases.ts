"use server"

import { promises as fs } from "fs"
import path from "path"

const ALIASES_PATH = path.join(process.cwd(), "data", "watchlist-aliases.json")

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

async function ensureFile() {
  const dir = path.dirname(ALIASES_PATH)
  await fs.mkdir(dir, { recursive: true })
  try {
    await fs.access(ALIASES_PATH)
  } catch {
    await fs.writeFile(ALIASES_PATH, "{}", "utf8")
  }
}

async function readAll(): Promise<Record<string, string[]>> {
  await ensureFile()
  try {
    const raw = await fs.readFile(ALIASES_PATH, "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as Record<string, string[]>
  } catch {
    return {}
  }
}

async function writeAll(next: Record<string, string[]>) {
  await ensureFile()
  await fs.writeFile(ALIASES_PATH, JSON.stringify(next, null, 2), "utf8")
}

export async function getFirmAliases(firm: string): Promise<string[]> {
  const all = await readAll()
  const key = normalize(firm)
  const list = all[key]
  if (!Array.isArray(list)) return []
  return list.filter((x) => typeof x === "string" && x.trim().length > 0)
}

export async function addFirmAlias(firm: string, alias: string): Promise<string[]> {
  const all = await readAll()
  const key = normalize(firm)
  const current = Array.isArray(all[key]) ? all[key] : []
  const existing = new Map(current.map((x) => [normalize(x), x]))
  const trimmed = alias.trim()
  if (trimmed.length > 0) {
    const aKey = normalize(trimmed)
    if (!existing.has(aKey)) existing.set(aKey, trimmed)
  }
  const nextList = Array.from(existing.values()).sort((a, b) => a.localeCompare(b))
  all[key] = nextList
  await writeAll(all)
  return nextList
}

export async function removeFirmAlias(firm: string, alias: string): Promise<string[]> {
  const all = await readAll()
  const key = normalize(firm)
  const current = Array.isArray(all[key]) ? all[key] : []
  const aKey = normalize(alias)
  const nextList = current.filter((x) => normalize(x) !== aKey)
  all[key] = nextList
  await writeAll(all)
  return nextList
}

