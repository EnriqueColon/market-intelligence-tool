/**
 * Seed competitor_surveillance.sqlite with top 20 competitors and aliases.
 * Run: npx tsx scripts/seed-competitor-surveillance.ts
 */
import path from "node:path"
import fs from "node:fs"
import Database from "better-sqlite3"

const DB_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DB_DIR, "competitor_surveillance.sqlite")
const MIGRATIONS_DIR = path.join(process.cwd(), "app/ingestion/competitor_surveillance/storage/migrations")

const COMPETITORS: Array<{ name: string; aliases: string[]; website?: string }> = [
  { name: "Blackstone", aliases: ["Blackstone Real Estate Debt Strategies", "BREDS", "Blackstone Real Estate"], website: "https://www.blackstone.com" },
  { name: "Starwood Capital", aliases: ["Starwood Property Trust", "SREIT"], website: "https://www.starwoodcapital.com" },
  { name: "Brookfield", aliases: ["Brookfield Asset Management", "BAM", "Brookfield Real Estate"], website: "https://www.brookfield.com" },
  { name: "Apollo", aliases: ["Apollo Global Management", "Apollo Real Estate"], website: "https://www.apollo.com" },
  { name: "Ares", aliases: ["Ares Management", "Ares Real Estate"], website: "https://www.aresmgmt.com" },
  { name: "Oaktree", aliases: ["Oaktree Capital", "Oaktree Real Estate"], website: "https://www.oaktreecapital.com" },
  { name: "Fortress", aliases: ["Fortress Investment Group", "FIG"], website: "https://www.fortress.com" },
  { name: "KKR", aliases: ["KKR Real Estate", "Kohlberg Kravis Roberts"], website: "https://www.kkr.com" },
  { name: "Carlyle", aliases: ["Carlyle Group", "Carlyle Real Estate"], website: "https://www.carlyle.com" },
  { name: "TPG Angelo Gordon", aliases: ["Angelo Gordon", "TPG Real Estate"], website: "https://www.tpg.com" },
  { name: "Cerberus", aliases: ["Cerberus Capital", "Cerberus Real Estate"], website: "https://www.cerberus.com" },
  { name: "Centerbridge", aliases: ["Centerbridge Partners"], website: "https://www.centerbridge.com" },
  { name: "Lone Star Funds", aliases: ["Lone Star"], website: "https://www.lonestarfunds.com" },
  { name: "Davidson Kempner", aliases: ["DK", "Davidson Kempner Capital"], website: "https://www.davidsonkempner.com" },
  { name: "Bain Capital Credit", aliases: ["Bain Capital", "BCC"], website: "https://www.baincapital.com" },
  { name: "Goldman Sachs Asset Management", aliases: ["GSAM", "Goldman Sachs Real Estate"], website: "https://www.goldmansachs.com" },
  { name: "Morgan Stanley Real Estate Investing", aliases: ["MSREI", "Morgan Stanley Real Estate"], website: "https://www.morganstanley.com" },
  { name: "Rialto Capital", aliases: ["Rialto"], website: "https://www.rialtocapital.com" },
  { name: "Pretium Partners", aliases: ["Pretium"], website: "https://www.pretium.com" },
  { name: "Nuveen Real Estate", aliases: ["Nuveen", "TIAA Nuveen"], website: "https://www.nuveen.com" },
]

function main() {
  fs.mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")

  const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
  for (const f of migrations) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8"))
  }

  const insertComp = db.prepare(`
    INSERT OR IGNORE INTO competitors (name, aliases_json, website, notes)
    VALUES (?, ?, ?, ?)
  `)
  for (const c of COMPETITORS) {
    insertComp.run(c.name, JSON.stringify(c.aliases), c.website || null, null)
  }

  const insertSource = db.prepare(`
    INSERT OR REPLACE INTO sources (source_type, name, config_json, enabled)
    VALUES (?, ?, ?, ?)
  `)
  const sources = [
    ["sec_edgar", "SEC EDGAR (Form D)", "{}", 1],
    ["news", "News / RSS", "{}", 1],
    ["manual_csv", "Manual CSV", "{}", 1],
    ["ucc", "UCC Filings", "{}", 0],
    ["aom", "County AOM", "{}", 0],
    ["foreclosure", "Foreclosure / Docket", "{}", 0],
    ["hiring", "Hiring Signals", "{}", 0],
  ]
  for (const [st, name, config, enabled] of sources) {
    insertSource.run(st, name, config, enabled)
  }

  console.log(`Seeded ${COMPETITORS.length} competitors and ${sources.length} sources to ${DB_PATH}`)
  db.close()
}

main()
