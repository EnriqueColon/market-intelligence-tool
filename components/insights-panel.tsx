import { Card } from "@/components/ui/card"
import { Sparkles } from "lucide-react"

interface InsightsPanelProps {
  level: string
  insight: string
}

export function InsightsPanel({ level, insight }: InsightsPanelProps) {
  return (
    <Card className="border-primary/20 bg-primary/5 p-6">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">AI Market Insights</h3>
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">{level}</span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{insight}</p>
        </div>
      </div>
    </Card>
  )
}
