import Database from "better-sqlite3"
import path from "node:path"
import fs from "node:fs"

const DB_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DB_DIR, "competitor_surveillance.sqlite")
// Vercel note: this local SQLite path is ephemeral in serverless runtime.
// Use external persistence in production for durable ingestion state.

let _db: Database.Database | null = null

export function getDbPath(): string {
  return DB_PATH
}

export function getDb(): Database.Database {
  if (_db) return _db
  fs.mkdirSync(DB_DIR, { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma("journal_mode = WAL")
  runMigrations(_db)
  return _db
}

function runMigrations(db: Database.Database): void {
  const migrationsDir = path.join(__dirname, "migrations")
  if (!fs.existsSync(migrationsDir)) return
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8")
    db.exec(sql)
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
