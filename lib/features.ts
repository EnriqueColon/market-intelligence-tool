export function isFeatureEnabled(feature: string): boolean {
  // In development, all features enabled by default.
  if (process.env.NODE_ENV !== "production") return true

  const enabled = process.env.ENABLED_TABS
  if (!enabled) return false

  const allowed = enabled.split(",").map((f) => f.trim())
  return allowed.includes(feature)
}
