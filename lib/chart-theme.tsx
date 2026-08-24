/**
 * One visual language for every chart in the tool.
 *
 * The series colours mirror the --chart-1 through --chart-5 tokens in
 * app/globals.css. They are repeated here as literals because Recharts writes
 * SVG fills directly and cannot resolve CSS variables during the headless
 * Playwright pass that renders the PDF.
 */

export const CHART_SERIES = ["#006D95", "#0088b3", "#005a7a", "#00a3cc", "#004d6b"] as const

export const CHART_INK = {
  /** Axis numbers and units */
  axis: "#64748b",
  /** The axis rule itself */
  axisLine: "#cbd5e1",
  grid: "#e2e8f0",
  /** Category names, which need more weight than axis numbers */
  label: "#334155",
  /** Median lines and other annotations */
  reference: "#94a3b8",
} as const

export const CHART_TYPE = {
  tick: 10,
  value: 9,
} as const

/** Numeric axes align digit-for-digit so bars can be compared by eye. */
export const numericTick = {
  fontSize: CHART_TYPE.tick,
  fill: CHART_INK.axis,
  fontVariantNumeric: "tabular-nums",
} as const

export const categoryTick = {
  fontSize: CHART_TYPE.tick,
  fill: CHART_INK.label,
  fontWeight: 500,
} as const

export const gridProps = {
  strokeDasharray: "3 3",
  stroke: CHART_INK.grid,
} as const

export const axisLineProps = { stroke: CHART_INK.axisLine } as const

/** Shortens an institution name to fit a category axis without wrapping. */
export function truncateLabel(name: string, max = 24): string {
  const value = String(name)
  return value.length > max ? `${value.slice(0, max - 2)}…` : value
}

/**
 * A category tick that never wraps.
 *
 * Recharts' default tick breaks a long label across lines to fit the axis
 * width. On a twenty-row ranking the second line runs into the row below and
 * the names become unreadable, so this renders one line and lets `format`
 * decide how much of the name survives.
 */
export function singleLineTick(format: (value: string, index: number) => string) {
  return function CategoryTick({ x, y, payload, index }: any) {
    return (
      <text
        x={x}
        y={y}
        dy={3}
        textAnchor="end"
        fontSize={CHART_TYPE.tick}
        fontWeight={500}
        fill={CHART_INK.label}
      >
        {format(String(payload?.value ?? ""), index ?? 0)}
      </text>
    )
  }
}
