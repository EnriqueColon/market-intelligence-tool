/**
 * Participant Intel: entity resolution and firm/alias/entity storage.
 * Uses data/participant_intel.sqlite (separate from aom.sqlite).
 */

import Database from "better-sqlite3"
import path from "node:path"
import fs from "node:fs"

const DB_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DB_DIR, "participant_intel.sqlite")
// Vercel note: this local SQLite path is ephemeral in serverless runtime.
// Use external persistence in production for durable participant-intel data.

/** Suffix tokens to strip for matching (word-boundary, case-insensitive) */
const SUFFIX_TOKENS = [
  "LLC",
  "INC",
  "LTD",
  "NA",
  "N.A.",
  "CORP",
  "COMPANY",
  "CO",
  "TRUST",
  "NATIONAL ASSOCIATION",
].map((s) => s.toUpperCase())

/**
 * Normalize a firm/party name for matching.
 * - Uppercase, strip punctuation, collapse whitespace
 * - Remove common suffix tokens (LLC, INC, LTD, etc.)
 * Display uses raw strings; this is for matching only.
 */
export function normalize_name(s: string): string {
  if (!s || typeof s !== "string") return ""
  let t = s
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!t) return ""

  // Remove suffix tokens (must be at end, word boundary)
  for (const tok of SUFFIX_TOKENS) {
    const re = new RegExp(`\\s+${tok.replace(/\./g, "\\.")}\\s*$`, "i")
    t = t.replace(re, "").trim()
  }
  return t.replace(/\s+/g, " ").trim()
}

let _db: Database.Database | null = null

export function getParticipantIntelDbPath(): string {
  return DB_PATH
}

/**
 * Ensure participant_intel DB exists and has schema. Idempotent.
 */
export function ensureParticipantIntelDb(): Database.Database {
  if (_db) return _db
  fs.mkdirSync(DB_DIR, { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma("journal_mode = WAL")
  runSchema(_db)
  return _db
}

function runSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS firm (
      firm_id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      category TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS firm_alias (
      alias_id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL,
      alias_text TEXT NOT NULL,
      alias_norm TEXT NOT NULL,
      match_type TEXT,
      confidence REAL,
      source TEXT,
      first_seen TEXT,
      last_seen TEXT,
      FOREIGN KEY(firm_id) REFERENCES firm(firm_id)
    );
    CREATE TABLE IF NOT EXISTS firm_entity (
      entity_id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL,
      entity_name TEXT NOT NULL,
      entity_norm TEXT NOT NULL,
      entity_type TEXT,
      source TEXT,
      evidence_ref TEXT,
      first_seen TEXT,
      last_seen TEXT,
      FOREIGN KEY(firm_id) REFERENCES firm(firm_id)
    );
    CREATE INDEX IF NOT EXISTS idx_firm_alias_norm ON firm_alias(alias_norm);
    CREATE INDEX IF NOT EXISTS idx_firm_alias_firm_id ON firm_alias(firm_id);
    CREATE INDEX IF NOT EXISTS idx_firm_entity_firm_id ON firm_entity(firm_id);
  `)
}

export function closeParticipantIntelDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
