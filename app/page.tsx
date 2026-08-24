import { cookies } from "next/headers"
import {
  MarketIntelligenceDashboard,
  type EnabledTabs,
} from "@/components/market-intelligence-dashboard"
import { isFeatureEnabled } from "@/lib/features"
import { DEPARTMENT_COOKIE_NAME, parseDepartment } from "@/lib/department"

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

  // Read here rather than in the client so the chosen view renders on the first
  // paint. Reading it in an effect would show the wrong one and then swap it.
  const cookieStore = await cookies()
  const department = parseDepartment(cookieStore.get(DEPARTMENT_COOKIE_NAME)?.value)

  return (
    <MarketIntelligenceDashboard
      enabledTabs={enabledTabs}
      features={features}
      initialDepartment={department}
    />
  )
}
