"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { FileText, Download, Loader2 } from "lucide-react"
import { generateReport } from "@/lib/report-generator"

interface ReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeLevel: string
  timeRange: string
}

export function ReportDialog({ open, onOpenChange, activeLevel, timeRange }: ReportDialogProps) {
  const [format, setFormat] = useState<"pdf" | "docx">("pdf")
  const [sections, setSections] = useState({
    kpis: true,
    charts: true,
    insights: true,
    rawData: false,
  })
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      await generateReport({
        level: activeLevel,
        timeRange,
        format,
        sections,
      })
    } finally {
      setIsGenerating(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Market Report</DialogTitle>
          <DialogDescription>
            Create a comprehensive report for{" "}
            {activeLevel === "national" ? "National" : activeLevel === "florida" ? "Florida" : "Miami Metro"} market
            data
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Selection */}
          <div className="space-y-3">
            <Label>Report Format</Label>
            <div className="flex gap-3">
              <Button
                variant={format === "pdf" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setFormat("pdf")}
              >
                <FileText className="mr-2 h-4 w-4" />
                PDF
              </Button>
              <Button
                variant={format === "docx" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setFormat("docx")}
              >
                <FileText className="mr-2 h-4 w-4" />
                DOCX
              </Button>
            </div>
          </div>

          {/* Sections Selection */}
          <div className="space-y-3">
            <Label>Include Sections</Label>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="kpis"
                  checked={sections.kpis}
                  onCheckedChange={(checked) => setSections((prev) => ({ ...prev, kpis: checked as boolean }))}
                />
                <label
                  htmlFor="kpis"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Key Performance Indicators
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="charts"
                  checked={sections.charts}
                  onCheckedChange={(checked) => setSections((prev) => ({ ...prev, charts: checked as boolean }))}
                />
                <label
                  htmlFor="charts"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Charts & Visualizations
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="insights"
                  checked={sections.insights}
                  onCheckedChange={(checked) => setSections((prev) => ({ ...prev, insights: checked as boolean }))}
                />
                <label
                  htmlFor="insights"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  AI-Generated Insights
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="rawData"
                  checked={sections.rawData}
                  onCheckedChange={(checked) => setSections((prev) => ({ ...prev, rawData: checked as boolean }))}
                />
                <label
                  htmlFor="rawData"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Raw Data Tables
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Generate Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
