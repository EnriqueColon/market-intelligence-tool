import {
  MarketIntelligenceDashboard,
  type EnabledTabs,
} from "@/components/market-intelligence-dashboard"
import { isFeatureEnabled } from "@/lib/features"

/**
 * Which tabs exist is read from `ENABLED_TABS` on every request, not baked into the build.
 *
 * This was previously implicit: the page called `cookies()` to resolve the department, which
 * opted it out of static rendering as a side effect. Removing the department made the page
 * statically prerenderable, and `isFeatureEnabled` then ran once at build time — so changing
 * `ENABLED_TABS` in Vercel would have needed a redeploy to take effect, and a build without the
 * variable would have shipped a tool with no tabs at all. Both silent.
 *
 * `README.md` documents turning a tab on by editing the variable with no code change, so this is
 * the declaration that keeps that true.
 */
export const dynamic = "force-dynamic"

export default async function Page() {
  const enabledTabs: EnabledTabs = {
    news: isFeatureEnabled("news"),
    marketAnalytics: isFeatureEnabled("market-analytics"),
    marketResearch: isFeatureEnabled("market-research"),
    legal: isFeatureEnabled("legal"),
  }

  // Resolved here because isFeatureEnabled reads server-only env; the dashboard
  // and everything under it are client components.
  const features = {
    bankStressMap: isFeatureEnabled("bank-stress-map"),
  }

  return <MarketIntelligenceDashboard enabledTabs={enabledTabs} features={features} />
}
