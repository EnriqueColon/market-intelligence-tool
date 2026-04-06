"use client"

import { useEffect, useMemo, useState } from "react"
import { FileText, LineChart, Newspaper, Scale, Users } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LegalUpdates } from "@/components/legal-updates"
import { MarketAnalytics } from "@/components/market-analytics"
import { MarketParticipantsIntel } from "@/components/market-participants-intel"
import { PublicMentions } from "@/components/public-mentions"
import { InvestingBusinessMentions } from "@/components/investing-business-mentions"
import { ArticleDigest } from "@/components/article-digest"
import { IndustryOutlook } from "@/components/industry-outlook"
import { SendNewsEmailButton } from "@/components/send-news-email-button"
import { MarketResearchLibrary } from "@/components/market-research-library"
import { MarketResearchFeed } from "@/components/market-research-feed"

const LEVEL_OPTIONS = [
  { value: "national", label: "National" },
  { value: "florida", label: "Florida" },
  { value: "miami", label: "Miami Metro" },
] as const

type LevelOption = (typeof LEVEL_OPTIONS)[number]["value"]
type TabValue = "news" | "analytics" | "market-research" | "competitors" | "legal"

export type EnabledTabs = {
  news: boolean
  marketAnalytics: boolean
  marketResearch: boolean
  competitors: boolean
  legal: boolean
}

export function MarketIntelligenceDashboard({
  enabledTabs,
}: {
  enabledTabs: EnabledTabs
}) {
  const [level, setLevel] = useState<LevelOption>("national")

  const availableTabs = useMemo(() => {
    const tabs: TabValue[] = []
    if (enabledTabs.news) tabs.push("news")
    if (enabledTabs.marketAnalytics) tabs.push("analytics")
    if (enabledTabs.marketResearch) tabs.push("market-research")
    if (enabledTabs.competitors) tabs.push("competitors")
    if (enabledTabs.legal) tabs.push("legal")
    return tabs
  }, [enabledTabs])

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

  return (
    <div className="market-intelligence-tool min-h-screen bg-background">
      <header className="border-b border-[#006D95]/20 bg-white shadow-sm">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-[20px]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-heading text-[28px] md:text-[38px] font-medium uppercase tracking-tight text-[#006D95] leading-[1.3]">Market Intelligence</h1>
              <p className="font-body text-base text-[#006D95]/90 mt-1">News and analytics</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[#006D95]/30 bg-[#006D95]/5 px-4 py-2.5">
              <Newspaper className="h-4 w-4 text-[#006D95]" />
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as LevelOption)}
                className="bg-transparent text-sm font-medium text-[#006D95] outline-none [&>option]:bg-white [&>option]:text-[#006D95]"
              >
                {LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {availableTabs.length > 0 && (
        <main className="mx-auto w-full max-w-[1100px] px-5 py-12 md:px-[20px]">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex flex-col gap-[60px]">
            <TabsList className="grid w-full max-w-5xl grid-cols-5 gap-x-0 border border-[#006D95]/20 bg-white p-1.5 shadow-sm rounded-lg h-auto min-h-[56px]">
              {enabledTabs.news && (
                <TabsTrigger
                  value="news"
                  className="gap-2 px-4 py-3 text-base font-medium min-h-[52px] h-auto items-center data-[state=active]:bg-[#006D95] data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-[#006D95] data-[state=inactive]:hover:bg-[#006D95]/5 rounded-md transition-colors border-0"
                >
                  <Newspaper className="h-4 w-4 shrink-0" />
                  <span>News</span>
                </TabsTrigger>
              )}
              {enabledTabs.marketAnalytics && (
                <TabsTrigger
                  value="analytics"
                  className="gap-2 px-4 py-3 text-base font-medium min-h-[52px] h-auto items-center data-[state=active]:bg-[#006D95] data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-[#006D95] data-[state=inactive]:hover:bg-[#006D95]/5 rounded-md transition-colors border-0"
                >
                  <LineChart className="h-4 w-4 shrink-0" />
                  <span>Market Analytics</span>
                </TabsTrigger>
              )}
              {enabledTabs.marketResearch && (
                <TabsTrigger
                  value="market-research"
                  className="gap-2 px-4 py-3 text-base font-medium min-h-[52px] h-auto items-center data-[state=active]:bg-[#006D95] data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-[#006D95] data-[state=inactive]:hover:bg-[#006D95]/5 rounded-md transition-colors border-0"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span>Market Research</span>
                </TabsTrigger>
              )}
              {enabledTabs.competitors && (
                <TabsTrigger
                  value="competitors"
                  className="gap-2 px-4 py-3 text-base font-medium min-h-[52px] h-auto whitespace-normal text-left data-[state=active]:bg-[#006D95] data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-[#006D95] data-[state=inactive]:hover:bg-[#006D95]/5 rounded-md transition-colors border-0 [&>span]:leading-tight"
                >
                  <Users className="h-4 w-4 shrink-0 mt-0.5 self-start" />
                  <span>Market Participants & Activity</span>
                </TabsTrigger>
              )}
              {enabledTabs.legal && (
                <TabsTrigger
                  value="legal"
                  className="gap-2 px-4 py-3 text-base font-medium min-h-[52px] h-auto items-center data-[state=active]:bg-[#006D95] data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-[#006D95] data-[state=inactive]:hover:bg-[#006D95]/5 rounded-md transition-colors border-0"
                >
                  <Scale className="h-4 w-4 shrink-0" />
                  <span>Legal Landscape</span>
                </TabsTrigger>
              )}
            </TabsList>

            {enabledTabs.news && (
              <TabsContent value="news">
                <div className="flex justify-end">
                  <SendNewsEmailButton />
                </div>
                <IndustryOutlook />
                <div>
                  <PublicMentions level={level} />
                </div>
                <div>
                  <InvestingBusinessMentions level={level} />
                </div>
                <div>
                  <ArticleDigest />
                </div>
              </TabsContent>
            )}

            {enabledTabs.marketResearch && (
              <TabsContent value="market-research" className="flex flex-col gap-[60px]">
                <div className="rounded-lg border border-[#006D95]/25 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-5 w-5 text-[#006D95]" />
                    <h2 className="font-heading text-xl font-medium uppercase text-[#006D95] leading-[1.3]">Market Research</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Live research feed from CBRE, JLL, Trepp, MBA, Moody&apos;s and more — plus your private PDF library.
                  </p>
                </div>
                <MarketResearchFeed />
                <MarketResearchLibrary />
              </TabsContent>
            )}

            {enabledTabs.marketAnalytics && (
              <TabsContent value="analytics" className="flex flex-col gap-[60px]">
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
                <MarketAnalytics level={level} />
              </TabsContent>
            )}

            {enabledTabs.competitors && (
              <TabsContent value="competitors" className="flex flex-col gap-[60px]">
                <div className="rounded-lg border border-[#006D95]/25 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-5 w-5 text-[#006D95]" />
                    <h2 className="font-heading text-xl font-medium uppercase text-[#006D95] leading-[1.3]">Market Participants & Activity</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Peer landscape for distressed CRE debt buyers.
                  </p>
                </div>
                <MarketParticipantsIntel level={level} />
              </TabsContent>
            )}

            {enabledTabs.legal && (
              <TabsContent value="legal" className="flex flex-col gap-[60px]">
                <LegalUpdates />
              </TabsContent>
            )}
          </Tabs>
        </main>
      )}
    </div>
  )
}
