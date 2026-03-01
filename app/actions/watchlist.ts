 "use server"

 import { promises as fs } from "fs"
 import path from "path"

 const WATCHLIST_PATH = path.join(process.cwd(), "data", "watchlist.json")

 function normalize(value: string) {
   return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
 }

 async function ensureFile() {
   const dir = path.dirname(WATCHLIST_PATH)
   await fs.mkdir(dir, { recursive: true })
   try {
     await fs.access(WATCHLIST_PATH)
   } catch {
     await fs.writeFile(WATCHLIST_PATH, "[]", "utf8")
   }
 }

 export async function getWatchlist(): Promise<string[]> {
   await ensureFile()
   try {
     const raw = await fs.readFile(WATCHLIST_PATH, "utf8")
     const parsed = JSON.parse(raw)
     if (!Array.isArray(parsed)) return []
     return parsed.filter((item) => typeof item === "string" && item.trim().length > 0)
   } catch {
     return []
   }
 }

 export async function addToWatchlist(names: string[]): Promise<string[]> {
   await ensureFile()
   const current = await getWatchlist()
   const existing = new Map(current.map((name) => [normalize(name), name]))
   names
     .filter(Boolean)
     .map((name) => name.trim())
     .filter((name) => name.length > 0)
     .forEach((name) => {
       const key = normalize(name)
       if (!existing.has(key)) existing.set(key, name)
     })
   const next = Array.from(existing.values()).sort((a, b) => a.localeCompare(b))
   await fs.writeFile(WATCHLIST_PATH, JSON.stringify(next, null, 2), "utf8")
   return next
 }

 export async function removeFromWatchlist(name: string): Promise<string[]> {
   await ensureFile()
   const current = await getWatchlist()
   const key = normalize(name)
   const next = current.filter((item) => normalize(item) !== key)
   await fs.writeFile(WATCHLIST_PATH, JSON.stringify(next, null, 2), "utf8")
   return next
 }

