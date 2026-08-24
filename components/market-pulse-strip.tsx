"use client"

import { useEffect, useState } from "react"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchMarketPulse, type PulseTile } from "@/app/actions/fetch-market-pulse"

/**
 * A sparkline drawn as a filled area.
 *
 * Deliberately not Recharts: five of these render above the fold on every page
 * load, and a full chart runtime per tile is a lot of work for eighty pixels.
 */
function PulseSparkline({ values, width = 72, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <div className="h-7" />

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = width / (values.length - 1)
  const coords = values.map((value, index) => ({
    x: index * step,
    y: height - ((value - min) / range) * height,
  }))
  const line = coords.map(({ x, y }) => `${x},${y}`).join(" ")
  const last = coords[coords.length - 1]

  return (
    <svg width={width} height={height} className="ml-auto block text-[#006D95]" aria-hidden="true">
      <polygon points={`0,${height} ${line} ${width},${height}`} fill="currentColor" fillOpacity={0.1} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r="2" fill="currentColor" />
    </svg>
  )
}

const DIRECTION_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
} as const

function Tile({ tile }: { tile: PulseTile }) {
  const Icon = DIRECTION_ICON[tile.direction]

  return (
    <div
      className="group flex min-w-0 flex-col justify-between rounded-lg border border-[#006D95]/15 bg-white px-3.5 py-3 shadow-xs transition-shadow duration-200 hover:shadow-sm"
      title={`${tile.publisher} · as of ${tile.asOf}`}
    >
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{tile.label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="shrink-0">
          <p className="text-lg font-semibold leading-none text-slate-900 tabular-nums">{tile.value}</p>
          <p className="mt-1.5 flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500">
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{tile.change ?? "unchanged"}</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <PulseSparkline values={tile.spark} />
        </div>
      </div>
    </div>
  )
}

function TileSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <Skeleton className="h-2.5 w-20" />
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="w-full">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="mt-2 h-2.5 w-14" />
        </div>
        <Skeleton className="h-7 w-24" />
      </div>
    </div>
  )
}

/**
 * Measured market conditions, above the tabs and visible on every screen.
 *
 * Loaded from the client rather than the server component so the shell paints
 * immediately: the underlying FRED requests are allowed up to six seconds each,
 * and the dashboard should never wait on them.
 */
export function MarketPulseStrip() {
  const [tiles, setTiles] = useState<PulseTile[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    fetchMarketPulse()
      .then((result) => {
        if (!active) return
        if (result.length === 0) setFailed(true)
        else setTiles(result)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  // A dead data source should cost the page nothing; the strip simply is not there.
  if (failed) return null

  return (
    <section aria-label="Market pulse" className="border-b border-[#006D95]/10 bg-white/60">
      <div className="mx-auto w-full max-w-[1100px] px-5 py-4 md:px-[20px]">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#006D95]/70">Market Pulse</h2>
          <p className="text-[11px] text-slate-400">FRED · measured, not generated</p>
        </div>
        {tiles ? (
          <div className="grid grid-cols-2 gap-3 duration-500 animate-in fade-in slide-in-from-bottom-1 md:grid-cols-3 lg:grid-cols-5">
            {tiles.map((tile) => (
              <Tile key={tile.id} tile={tile} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <TileSkeleton key={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
