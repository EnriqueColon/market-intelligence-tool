/**
 * Which deployment this code is running in, and which dataset it is wired to.
 *
 * These are two separate questions, and conflating them is what makes a shared
 * dev environment dangerous. The rest of the app decides both from NODE_ENV,
 * which cannot answer either one on Vercel: a preview build sets
 * NODE_ENV="production", so a preview deployment is indistinguishable from
 * production, and nothing in the environment reveals whether POSTGRES_URL
 * points at the real database or a scratch copy.
 *
 * Deliberately dependency-free so it can be unit tested with
 * `node --test --experimental-strip-types lib/environment.test.ts`.
 */

export type DeploymentEnvironment = "production" | "preview" | "development"

/**
 * Vercel sets VERCEL_ENV to production, preview or development. Off Vercel it
 * is absent, so a local production build reports "production" — matching how
 * the rest of the app already reads NODE_ENV, and the safer default for the
 * guard below.
 */
export function deploymentEnvironment(): DeploymentEnvironment {
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase()
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    return vercelEnv
  }
  return process.env.NODE_ENV === "production" ? "production" : "development"
}

export function isProductionDeployment(): boolean {
  return deploymentEnvironment() === "production"
}

/**
 * Whether this deployment's Postgres and Blob store are the production ones.
 *
 * This cannot be inferred, only declared: Vercel copies environment variables
 * into the Preview scope by default, so a preview deployment reads and writes
 * production data until someone deliberately repoints it. Set
 * DATA_ENVIRONMENT=isolated in the Preview scope once it has its own stores.
 *
 * Absent means production, so the guard fails closed on a misconfiguration
 * rather than on a correct setup.
 */
export function isWiredToProductionData(): boolean {
  return process.env.DATA_ENVIRONMENT?.trim().toLowerCase() !== "isolated"
}

export class ProductionDataWriteError extends Error {
  constructor(operation: string) {
    super(
      `Refusing to ${operation}: this is a ${deploymentEnvironment()} deployment wired to production data. ` +
        `Give it its own Postgres and Blob store, then set DATA_ENVIRONMENT=isolated for this environment.`
    )
    this.name = "ProductionDataWriteError"
  }
}

/**
 * Blocks a destructive write when a non-production deployment is pointed at
 * production data.
 *
 * Only irreversible operations need this. Reads are harmless, and an insert or
 * upsert into a cache table is recoverable; deleting the research library is
 * not, and `DELETE FROM research_reports WHERE producer = 'manual'` removes
 * every manually uploaded report in one call. Those routes are authenticated,
 * but the admin token is shared with Preview by the same default that shares
 * the database, so authentication is not the protection here.
 */
export function assertSafeToMutateProductionData(operation: string): void {
  if (isProductionDeployment() || !isWiredToProductionData()) return
  throw new ProductionDataWriteError(operation)
}
