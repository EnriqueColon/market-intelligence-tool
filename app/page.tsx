import {
  MarketIntelligenceDashboard,
  type EnabledTabs,
} from "@/components/market-intelligence-dashboard"
import { isFeatureEnabled } from "@/lib/features"

export default function Page() {
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
