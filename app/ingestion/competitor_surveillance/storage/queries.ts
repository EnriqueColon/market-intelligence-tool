import type Database from "better-sqlite3"

export type CompetitorRow = {
  id: number
  name: string
  aliases_json: string
  website: string | null
  notes: string | null
}

export function getCompetitors(db: Database.Database): CompetitorRow[] {
  return db.prepare("SELECT id, name, aliases_json, website, notes FROM competitors").all() as CompetitorRow[]
}

export function getCompetitorByName(db: Database.Database, name: string): CompetitorRow | undefined {
  const normalized = name.trim().toLowerCase()
  const rows = db.prepare("SELECT id, name, aliases_json, website, notes FROM competitors").all() as CompetitorRow[]
  for (const r of rows) {
    if (r.name.toLowerCase() === normalized) return r
    const aliases = parseAliases(r.aliases_json)
    if (aliases.some((a) => a.toLowerCase() === normalized)) return r
    if (r.name.toLowerCase().includes(normalized) || normalized.includes(r.name.toLowerCase())) return r
  }
  return undefined
}

export function parseAliases(aliasesJson: string): string[] {
  try {
    const arr = JSON.parse(aliasesJson || "[]")
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}
