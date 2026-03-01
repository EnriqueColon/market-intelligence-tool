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
    competitors: isFeatureEnabled("competitors"),
    legal: isFeatureEnabled("legal"),
  }

  return <MarketIntelligenceDashboard enabledTabs={enabledTabs} />
}
