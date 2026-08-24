"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FileText, LineChart, LogOut, Newspaper, Scale } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { LegalUpdates } from "@/components/legal-updates"
import { MarketAnalytics } from "@/components/market-analytics"
import { PublicMentions } from "@/components/public-mentions"
import { InvestingBusinessMentions } from "@/components/investing-business-mentions"
import { ArticleDigest } from "@/components/article-digest"
import { IndustryOutlook } from "@/components/industry-outlook"
import { MarketResearchFeed } from "@/components/market-research-feed"
import { MarketPulseStrip } from "@/components/market-pulse-strip"
import { DepartmentSelector } from "@/components/department-selector"
import { ExecutiveBrief } from "@/components/lenses/executive-brief"
import type { Department } from "@/lib/department"

type TabValue = "news" | "analytics" | "market-research" | "legal"

export type EnabledTabs = {
  news: boolean
  marketAnalytics: boolean
  marketResearch: boolean
  legal: boolean
}

/** Flags for content inside a tab, as opposed to the tabs themselves. */
export type DashboardFeatures = {
  bankStressMap: boolean
}

/** Tab order is fixed here so the bar and the content below cannot fall out of step. */
const TAB_DEFS = [
  { value: "news", flag: "news", label: "News", Icon: Newspaper },
  { value: "analytics", flag: "marketAnalytics", label: "Market Analytics", Icon: LineChart },
  { value: "market-research", flag: "marketResearch", label: "Market Research", Icon: FileText },
  { value: "legal", flag: "legal", label: "Legal Landscape", Icon: Scale },
] as const satisfies ReadonlyArray<{ value: TabValue; flag: keyof EnabledTabs; label: string; Icon: typeof Newspaper }>

/**
 * Column counts are spelled out because Tailwind only ships classes it can see
 * in the source; `grid-cols-${n}` would compile to nothing. Production runs
 * three tabs, and the previously hardcoded four-column grid left a dead cell
 * where the disabled tab used to be.
 */
const TAB_GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
}

const TAB_TRIGGER_CLASS =
  "gap-2 px-4 py-3 text-base font-medium min-h-[52px] h-auto items-center data-[state=active]:bg-[#006D95] data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-[#006D95] data-[state=inactive]:hover:bg-[#006D95]/5 rounded-md transition-all duration-200 border-0"

/** Switching tabs crossfades rather than snapping. Short enough not to feel like a wait. */
const TAB_CONTENT_CLASS = "animate-in fade-in duration-300"

export function MarketIntelligenceDashboard({
  enabledTabs,
  features = { bankStressMap: false },
  initialDepartment = null,
}: {
  enabledTabs: EnabledTabs
  features?: DashboardFeatures
  /** Resolved server-side from the cookie so the first paint is already correct. */
  initialDepartment?: Department | null
}) {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  const visibleTabs = useMemo(() => TAB_DEFS.filter((tab) => enabledTabs[tab.flag]), [enabledTabs])
  const availableTabs = useMemo(() => visibleTabs.map((tab) => tab.value as TabValue), [visibleTabs])

  const [activeTab, setActiveTab] = useState<TabValue | "">(availableTabs[0] ?? "")

  useEffect(() => {
    if (!availableTabs.length) {
      setActiveTab("")
      return
    }
    if (!activeTab || !availableTabs.includes(activeTab as TabValue)) {
      setActiveTab(availableTabs[0])
    }
  }, [availableTabs, activeTab])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch("/api/auth", { method: "DELETE" })
      router.push("/login")
      router.refresh()
    } catch {
      setLoggingOut(false)
    }
  }

  return (
    <div className="market-intelligence-tool min-h-screen bg-background">
      <header className="border-b border-[#006D95]/20 bg-white shadow-sm">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-[20px]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-heading text-[28px] md:text-[38px] font-medium uppercase tracking-tight text-[#006D95] leading-[1.3]">Market Intelligence</h1>
              <p className="font-body text-base text-[#006D95]/90 mt-1">News and analytics</p>
            </div>
            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
              <DepartmentSelector initial={initialDepartment} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
                className="gap-1.5 border-[#006D95]/30 text-[#006D95] hover:bg-[#006D95]/10"
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? "Signing out…" : "Log out"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <MarketPulseStrip />

      {/*
        A lens sits above the tabs and replaces nothing, so choosing a department
        adds a view rather than taking one away. Everything below stays reachable.
      */}
      {initialDepartment === "executive" && (
        <div className="mx-auto w-full max-w-[1100px] px-5 pt-10 md:px-[20px]">
          <ExecutiveBrief />
        </div>
      )}

      {availableTabs.length > 0 && (
        <main className="mx-auto w-full max-w-[1100px] px-5 py-12 md:px-[20px]">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex flex-col gap-[60px]">
            <TabsList
              className={`grid w-full max-w-5xl ${TAB_GRID_COLS[visibleTabs.length] ?? "grid-cols-4"} gap-x-0 border border-[#006D95]/20 bg-white p-1.5 shadow-sm rounded-lg h-auto min-h-[56px]`}
            >
              {visibleTabs.map(({ value, label, Icon }) => (
                <TabsTrigger key={value} value={value} className={TAB_TRIGGER_CLASS}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {enabledTabs.news && (
              <TabsContent value="news" className={TAB_CONTENT_CLASS}>
                <IndustryOutlook />
                <div>
                  <PublicMentions />
                </div>
                <div>
                  <InvestingBusinessMentions />
                </div>
                <div>
                  <ArticleDigest />
                </div>
              </TabsContent>
            )}

            {enabledTabs.marketResearch && (
              <TabsContent value="market-research" className={`flex flex-col gap-[60px] ${TAB_CONTENT_CLASS}`}>
                <div className="rounded-lg border border-[#006D95]/25 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-5 w-5 text-[#006D95]" />
                    <h2 className="font-heading text-xl font-medium uppercase text-[#006D95] leading-[1.3]">Market Research</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Live research feed from Trepp, CBRE, JLL, Cushman, Colliers, Marcus & Millichap, MBA, Moody&apos;s, Green Street, Newmark and more.
                  </p>
                </div>
                <MarketResearchFeed />
              </TabsContent>
            )}

            {enabledTabs.marketAnalytics && (
              <TabsContent value="analytics" className={`flex flex-col gap-[60px] ${TAB_CONTENT_CLASS}`}>
                <div className="rounded-lg border border-[#006D95]/25 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <LineChart className="h-5 w-5 text-[#006D95]" />
                    <h2 className="font-heading text-xl font-medium uppercase text-[#006D95] leading-[1.3]">Market Analytics</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    FDIC financials, failures, and historical summaries with filters.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    FDIC data is quarterly and lagged by 1–2 quarters. Filter by United States or any state.
                  </p>
                </div>
                <MarketAnalytics level="national" showBankStressMap={features.bankStressMap} />
              </TabsContent>
            )}

            {enabledTabs.legal && (
              <TabsContent value="legal" className={`flex flex-col gap-[60px] ${TAB_CONTENT_CLASS}`}>
                <LegalUpdates />
              </TabsContent>
            )}
          </Tabs>
        </main>
      )}
    </div>
  )
}
