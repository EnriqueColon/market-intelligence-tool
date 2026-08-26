"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchMarketPulse, type PulseTile } from "@/app/actions/fetch-market-pulse"

/**
 * Crawl speed. Slow enough that a figure stays legible as it passes: an
 * exchange ticker can afford to be quick because the reader only needs the
 * ones they already care about, whereas these five are the whole set.
 */
const CRAWL_PX_PER_SECOND = 40

/**
 * A sparkline drawn as a filled area.
 *
 * Deliberately not Recharts: five of these render above the fold on every page
 * load, and a full chart runtime per tile is a lot of work for eighty pixels.
 */
function PulseSparkline({ values, width = 56, height = 20 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null

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
    <svg width={width} height={height} className="block shrink-0 text-[#006D95]" aria-hidden="true">
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

function TickerItem({ tile }: { tile: PulseTile }) {
  const Icon = DIRECTION_ICON[tile.direction]

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap border-r border-[#006D95]/15 px-5"
      title={`${tile.publisher} · as of ${tile.asOf}`}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{tile.label}</span>
      <span className="text-base font-semibold leading-none text-slate-900 tabular-nums">{tile.value}</span>
      <span className="flex items-center gap-1 text-[11px] text-slate-500">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{tile.change ?? "unchanged"}</span>
      </span>
      <PulseSparkline values={tile.spark} />
    </div>
  )
}

function TickerItemSkeleton() {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2.5 border-r border-slate-200 px-5">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-2.5 w-12" />
      <Skeleton className="h-5 w-14" />
    </div>
  )
}

/**
 * How many copies of the tile sequence the rail needs, and how long one lap
 * takes.
 *
 * Both are measured rather than fixed because neither is knowable up front. A
 * fixed duration would make the crawl speed depend on how much content there
 * is, so a strip that lost two dead FRED series would visibly speed up. And two
 * copies only guarantee a seamless loop while the sequence is wider than the
 * rail; below that, each lap would drag a gap of empty track across the screen.
 */
function useCrawlGeometry(itemCount: number) {
  const railRef = useRef<HTMLDivElement>(null)
  const sequenceRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState({ copies: 2, durationSeconds: 0 })

  useEffect(() => {
    const rail = railRef.current
    const sequence = sequenceRef.current
    if (!rail || !sequence || itemCount === 0) return

    const measure = () => {
      const sequenceWidth = sequence.offsetWidth
      if (sequenceWidth === 0) return

      const copies = Math.max(2, Math.ceil(rail.offsetWidth / sequenceWidth) + 1)
      const durationSeconds = sequenceWidth / CRAWL_PX_PER_SECOND

      setGeometry((previous) =>
        previous.copies === copies && Math.abs(previous.durationSeconds - durationSeconds) < 0.01
          ? previous
          : { copies, durationSeconds }
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(rail)
    observer.observe(sequence)
    return () => observer.disconnect()
  }, [itemCount])

  return { railRef, sequenceRef, ...geometry }
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
  const { railRef, sequenceRef, copies, durationSeconds } = useCrawlGeometry(tiles?.length ?? 0)

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

  // Left unset until measured, so the crawl runs at the stylesheet's fallback
  // rather than a zero-second lap on the first frame.
  const crawl: CSSProperties = {
    "--pulse-ticker-shift": `${100 / copies}%`,
    ...(durationSeconds > 0 ? { "--pulse-ticker-duration": `${durationSeconds}s` } : {}),
  } as CSSProperties

  return (
    <section aria-label="Market pulse" className="border-b border-[#006D95]/10 bg-white">
      <div className="mx-auto w-full max-w-[1100px] py-3.5">
        <div className="mb-2 flex items-baseline justify-between px-5 md:px-[20px]">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#006D95]/70">Market Pulse</h2>
          <p className="text-[11px] text-slate-400">FRED · measured, not generated</p>
        </div>
        {tiles ? (
          <div ref={railRef} className="pulse-ticker relative overflow-hidden duration-500 animate-in fade-in">
            <div className="pulse-ticker-track flex w-max items-center" style={crawl}>
              {Array.from({ length: copies }).map((_, copy) => (
                <div
                  key={copy}
                  ref={copy === 0 ? sequenceRef : undefined}
                  className="flex shrink-0 items-center"
                  aria-hidden={copy > 0}
                >
                  {tiles.map((tile) => (
                    <TickerItem key={tile.id} tile={tile} />
                  ))}
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-white to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent" />
          </div>
        ) : (
          <div className="flex items-center overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <TickerItemSkeleton key={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
