import { isProductionDeployment } from "./environment"

export function isFeatureEnabled(feature: string): boolean {
  // Every feature is on outside production, so a preview deployment is usable
  // for development without duplicating ENABLED_TABS into it. Keyed on the
  // deployment environment rather than NODE_ENV, which Vercel sets to
  // "production" for preview builds too — gating on it left a preview
  // rendering no tabs at all.
  if (!isProductionDeployment()) return true

  const enabled = process.env.ENABLED_TABS
  if (!enabled) return false

  const allowed = enabled.split(",").map((f) => f.trim())
  return allowed.includes(feature)
}
