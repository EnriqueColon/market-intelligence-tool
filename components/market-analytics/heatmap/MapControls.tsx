"use client"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { RotateCcw } from "lucide-react"
import type { MapMetric } from "@/lib/map-stress-utils"
import type { ColorByOption } from "./BankStressHeatMap"

const METRIC_OPTIONS: { value: MapMetric; label: string }[] = [
  { value: "composite", label: "Composite Stress" },
  { value: "creCapital", label: "CRE/Capital" },
  { value: "npl", label: "NPL" },
  { value: "reserve", label: "Reserve Coverage" },
  { value: "chargeoffs", label: "Noncurrent" },
]

const COLOR_BY_OPTIONS: { value: ColorByOption; label: string }[] = [
  { value: "high_stress_share", label: "High-stress share" },
  { value: "stress_p90", label: "P90 stress" },
  { value: "stress_avg", label: "Avg stress" },
]

function getThresholdConfig(metric: MapMetric) {
  if (metric === "creCapital") {
    return { min: 1, max: 10, step: 0.5, default: 4, suffix: "x" }
  }
  return { min: 50, max: 90, step: 5, default: 70, suffix: "" }
}

type MapControlsProps = {
  quarters: string[]
  quarter: string
  onQuarterChange: (q: string) => void
  metric: MapMetric
  onMetricChange: (m: MapMetric) => void
  threshold: number
  onThresholdChange: (t: number) => void
  colorBy: ColorByOption
  onColorByChange: (c: ColorByOption) => void
  onResetView: () => void
}

export function MapControls({
  quarters,
  quarter,
  onQuarterChange,
  metric,
  onMetricChange,
  threshold,
  onThresholdChange,
  colorBy,
  onColorByChange,
  onResetView,
}: MapControlsProps) {
  const threshConfig = getThresholdConfig(metric)
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Quarter</Label>
        <Select value={quarter} onValueChange={onQuarterChange}>
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {quarters.map((q) => (
              <SelectItem key={q} value={q} className="text-xs">
                {q}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Metric</Label>
        <Select value={metric} onValueChange={(v) => onMetricChange(v as MapMetric)}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Color by</Label>
        <Select value={colorBy} onValueChange={(v) => onColorByChange(v as ColorByOption)}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLOR_BY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 min-w-[140px]">
        <Label className="text-xs">
          High-stress threshold: {threshold}{threshConfig.suffix}
        </Label>
        <Slider
          value={[threshold]}
          onValueChange={([v]) => onThresholdChange(v ?? threshConfig.default)}
          min={threshConfig.min}
          max={threshConfig.max}
          step={threshConfig.step}
          className="w-full"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={onResetView}
      >
        <RotateCcw className="h-3 w-3 mr-1" />
        Reset view
      </Button>
    </div>
  )
}
