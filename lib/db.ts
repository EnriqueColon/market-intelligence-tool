import { sql } from "@vercel/postgres"

export { sql }

export function isDbEnabled(): boolean {
  return Boolean(process.env.POSTGRES_URL?.trim())
}
