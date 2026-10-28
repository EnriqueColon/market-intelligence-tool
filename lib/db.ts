import { sql as vercelSql } from "@vercel/postgres"
import { sql as pgSql } from "./db-pg"

// POSTGRES_DRIVER=pg selects a plain Postgres connection (the droplet's local
// server); unset, as on Vercel, the Neon-backed @vercel/postgres driver is used.
// Both expose the same tagged template and `.query`, so call sites don't care.
export const sql = (process.env.POSTGRES_DRIVER === "pg" ? pgSql : vercelSql) as typeof vercelSql

export function isDbEnabled(): boolean {
  return Boolean(process.env.POSTGRES_URL?.trim())
}
