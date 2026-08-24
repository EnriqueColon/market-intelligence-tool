import type { ReactNode } from "react"

/**
 * The surface every chart tooltip sits on, so hovering any chart in the tool
 * produces the same object rather than five slightly different ones.
 */
export function ChartTooltipShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm">
      <p className="font-semibold text-slate-800">{title}</p>
      {children ? <div className="mt-1 space-y-0.5 text-slate-600 tabular-nums">{children}</div> : null}
    </div>
  )
}

export function ChartTooltipRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </p>
  )
}
