import { Card } from "@/components/ui/card"
import { TrendingUp, TrendingDown, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

interface Kpi {
  label: string
  value: string
  change: string
  trend: "up" | "down"
  dataSource: string
}

interface KpiGridProps {
  kpis: Kpi[]
  loading?: boolean
}

export function KpiGrid({ kpis, loading = false }: KpiGridProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Key Metrics</h2>
          <p className="text-sm text-muted-foreground mt-1">Real-time data from FRED and market sources</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-6">
              <div className="space-y-2 animate-pulse">
                <div className="h-4 bg-muted rounded w-24" />
                <div className="h-8 bg-muted rounded w-20" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Key Metrics</h2>
        <p className="text-sm text-muted-foreground mt-1">Real-time data from FRED and market sources</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, index) => (
          <Card
            key={index}
            className="p-6 cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] group"
            onClick={() => window.open(kpi.dataSource, "_blank", "noopener,noreferrer")}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="flex items-baseline justify-between">
                <p className="text-3xl font-bold text-foreground">{kpi.value}</p>
                <div
                  className={cn(
                    "flex items-center gap-1 text-sm font-medium",
                    kpi.trend === "up" ? "text-chart-3" : "text-chart-2",
                  )}
                >
                  {kpi.trend === "up" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {kpi.change}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
