// Plain-Postgres driver with the same call shapes as @vercel/postgres's `sql`:
// a tagged template that parameterises its interpolations, and `sql.query`
// for a hand-built statement. Used when POSTGRES_DRIVER=pg (the droplet,
// where Postgres runs locally); Vercel keeps @vercel/postgres. See lib/db.ts.
import { Pool, type QueryResult, type QueryResultRow } from "pg"

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.POSTGRES_URL, max: 10 })
  }
  return pool
}

function toText(strings: TemplateStringsArray, values: unknown[]): string {
  let text = strings[0]
  for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`
  return text
}

export function sql<O extends QueryResultRow = any>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult<O>> {
  if (!Array.isArray(strings) || !("raw" in strings)) {
    throw new Error("sql must be called as a tagged template: sql`SELECT ...`")
  }
  return getPool().query<O>(toText(strings, values), values as any[])
}

sql.query = <O extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<O>> =>
  getPool().query<O>(text, params as any[])
