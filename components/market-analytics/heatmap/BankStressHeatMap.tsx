"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { Card } from "@/components/ui/card"
import { MapControls } from "./MapControls"
import { StateTooltip, MetroTooltip, BankTooltip } from "./MapTooltip"
import type { MapMetric } from "@/lib/map-stress-utils"

const MAP_STYLE = "https://demotiles.maplibre.org/style.json"
const US_CENTER: [number, number] = [-95.7, 37.1]

const STATE_CENTROIDS: Record<string, [number, number]> = {
  Alabama: [-86.9, 32.3],
  Alaska: [-153.5, 64.2],
  Arizona: [-111.6, 34.2],
  Arkansas: [-92.4, 34.9],
  California: [-119.4, 36.8],
  Colorado: [-105.3, 38.9],
  Connecticut: [-72.8, 41.6],
  Delaware: [-75.5, 38.9],
  "District of Columbia": [-77.0, 38.9],
  Florida: [-81.5, 27.7],
  Georgia: [-83.6, 32.2],
  Hawaii: [-155.6, 19.9],
  Idaho: [-114.6, 44.4],
  Illinois: [-89.6, 40.0],
  Indiana: [-86.1, 40.3],
  Iowa: [-93.1, 41.9],
  Kansas: [-98.4, 38.5],
  Kentucky: [-84.3, 37.5],
  Louisiana: [-91.9, 31.2],
  Maine: [-69.4, 45.4],
  Maryland: [-76.6, 38.9],
  Massachusetts: [-71.4, 42.0],
  Michigan: [-84.5, 43.3],
  Minnesota: [-94.7, 46.4],
  Mississippi: [-89.6, 32.7],
  Missouri: [-91.8, 37.9],
  Montana: [-110.4, 46.9],
  Nebraska: [-99.9, 41.1],
  Nevada: [-116.4, 39.3],
  "New Hampshire": [-71.6, 43.2],
  "New Jersey": [-74.6, 40.2],
  "New Mexico": [-105.9, 34.5],
  "New York": [-75.5, 43.0],
  "North Carolina": [-79.0, 35.6],
  "North Dakota": [-100.4, 47.5],
  Ohio: [-82.8, 40.4],
  Oklahoma: [-97.5, 35.0],
  Oregon: [-120.6, 43.9],
  Pennsylvania: [-77.2, 40.9],
  "Rhode Island": [-71.5, 41.7],
  "South Carolina": [-81.2, 33.9],
  "South Dakota": [-99.9, 44.4],
  Tennessee: [-86.6, 35.8],
  Texas: [-99.3, 31.0],
  Utah: [-111.6, 39.3],
  Vermont: [-72.6, 44.1],
  Virginia: [-78.7, 37.4],
  Washington: [-120.7, 47.4],
  "West Virginia": [-80.5, 38.6],
  Wisconsin: [-89.6, 44.3],
  Wyoming: [-107.3, 43.0],
  "Puerto Rico": [-66.5, 18.2],
}
const US_ZOOM = 3
const METRO_ZOOM = 6
const BANK_ZOOM = 10

export type ColorByOption = "high_stress_share" | "stress_p90" | "stress_avg"

type StateData = {
  state: string
  stateCode: string
  bankCount: number
  highStressCount: number
  stressAvg: number
  stressP90: number
  highStressShare: number
  topBanks: Array<{ name: string; stressScore: number }>
}

type MetroData = {
  cbsaNo: string
  cbsaName: string
  lat: number
  lon: number
  bankCount: number
  highStressCount: number
  stressAvg: number
  stressP90: number
  highStressShare: number
  topBanks: Array<{ name: string; stressScore: number }>
}

/** FIPS (GeoJSON id) to 2-letter STALP for consistent join */
const FIPS_TO_STALP: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "72": "PR",
}

type BankData = {
  id: string
  name: string
  stressScore: number
  creToCapital?: number
  nplRatio: number
  loanLossReserve: number
  noncurrent_to_loans_ratio: number
  noncurrent_to_assets_ratio: number
  lat: number
  lon: number
}

const STRESS_COLORS = ["#e2e8f0", "#fcd34d", "#fb923c", "#f87171", "#dc2626"]

/**
 * PREVIOUS "ALL GREEN" ROOT CAUSE:
 * - Hardcoded domain [0,30,50,70,85,100] assumed stress scores 0–100.
 * - CRE/Capital metric is 0–9x; Composite/NPL etc. often clustered in 5–20.
 * - Values in 5–20 all fell into the lowest bucket (0–30) → gray/green.
 * FIX: Data-driven quantile scale (q20,q40,q60,q80) + p97 clamp so the
 * actual value distribution defines buckets. High-stress share (0–1) and
 * P90 stress now produce visible contrast.
 */
/** Data-driven: 5 buckets from quantiles q20,q40,q60,q80. Clamp upper to p97. */
function computeQuantileScale(
  values: number[]
): { quantiles: number[]; legendLabels: string[]; getColor: (v: number) => string } {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length < 2) {
    return {
      quantiles: [0, 0.25, 0.5, 0.75, 1],
      legendLabels: ["—", "—", "—", "—", "—"],
      getColor: () => STRESS_COLORS[0],
    }
  }
  const sorted = [...valid].sort((a, b) => a - b)
  const p97Idx = Math.min(Math.floor(valid.length * 0.97), valid.length - 1)
  const upperBound = sorted[p97Idx]
  const clamped = sorted.filter((v) => v <= upperBound)
  const q20 = clamped[Math.floor(clamped.length * 0.2)] ?? clamped[0]
  const q40 = clamped[Math.floor(clamped.length * 0.4)] ?? clamped[0]
  const q60 = clamped[Math.floor(clamped.length * 0.6)] ?? clamped[0]
  const q80 = clamped[Math.floor(clamped.length * 0.8)] ?? clamped[0]
  const quantiles = [q20, q40, q60, q80]

  const isPct = upperBound <= 1.01
  const fmt = (n: number) =>
    isPct ? `${(n * 100).toFixed(1)}%` : n.toFixed(1)
  const legendLabels = [
    `< ${fmt(q20)}`,
    `${fmt(q20)}–${fmt(q40)}`,
    `${fmt(q40)}–${fmt(q60)}`,
    `${fmt(q60)}–${fmt(q80)}`,
    `≥ ${fmt(q80)}`,
  ]

  const getColor = (v: number) => {
    if (!Number.isFinite(v)) return STRESS_COLORS[0]
    const clampedV = Math.min(v, upperBound)
    if (clampedV < q20) return STRESS_COLORS[0]
    if (clampedV < q40) return STRESS_COLORS[1]
    if (clampedV < q60) return STRESS_COLORS[2]
    if (clampedV < q80) return STRESS_COLORS[3]
    return STRESS_COLORS[4]
  }
  return { quantiles, legendLabels, getColor }
}

export function BankStressHeatMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [quarter, setQuarter] = useState<string>("")
  const [quarters, setQuarters] = useState<string[]>([])
  const [metric, setMetric] = useState<MapMetric>("composite")
  const [threshold, setThreshold] = useState(70)
  const [colorBy, setColorBy] = useState<ColorByOption>("high_stress_share")
  const [statesData, setStatesData] = useState<StateData[]>([])
  const [metrosData, setMetrosData] = useState<MetroData[]>([])
  const [banksData, setBanksData] = useState<BankData[]>([])
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{
    type: "state" | "metro" | "bank"
    x: number
    y: number
    data: StateData | MetroData | BankData
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(US_ZOOM)
  const [legendLabels, setLegendLabels] = useState<string[]>([])
  const [noVariation, setNoVariation] = useState(false)

  const fetchStates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/map/states?quarter=${quarter || ""}&metric=${metric}&threshold=${threshold}`
      )
      const json = await res.json()
      if (json.states) setStatesData(json.states)
      if (json.quarters?.length) {
        setQuarters(json.quarters)
        if (!quarter) setQuarter(json.quarters[0])
      }
      if (json.quarter) setQuarter(json.quarter)
    } catch (e) {
      console.error("Failed to fetch states:", e)
    } finally {
      setLoading(false)
    }
  }, [quarter, metric, threshold])

  const fetchMetros = useCallback(async () => {
    if (!selectedState) return
    try {
      const res = await fetch(
        `/api/map/metros?state=${encodeURIComponent(selectedState)}&quarter=${quarter}&metric=${metric}&threshold=${threshold}`
      )
      const json = await res.json()
      setMetrosData(json.metros || [])
    } catch (e) {
      console.error("Failed to fetch metros:", e)
      setMetrosData([])
    }
  }, [selectedState, quarter, metric, threshold])

  const fetchBanks = useCallback(async () => {
    if (!map.current) return
    const b = map.current.getBounds()
    const bbox = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    }
    try {
      const res = await fetch(
        `/api/map/banks?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&state=${selectedState || ""}&quarter=${quarter}&metric=${metric}`
      )
      const json = await res.json()
      setBanksData(json.banks || [])
    } catch (e) {
      console.error("Failed to fetch banks:", e)
      setBanksData([])
    }
  }, [selectedState, quarter, metric])

  useEffect(() => {
    fetchStates()
  }, [fetchStates])

  useEffect(() => {
    setThreshold(metric === "creCapital" ? 4 : 70)
  }, [metric])

  useEffect(() => {
    if (selectedState) fetchMetros()
    else setMetrosData([])
  }, [selectedState, fetchMetros])

  useEffect(() => {
    if (!mapContainer.current) return

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: US_CENTER,
      zoom: US_ZOOM,
    })

    map.current.addControl(new maplibregl.NavigationControl(), "top-right")

    const onZoom = () => {
      const z = map.current?.getZoom() ?? US_ZOOM
      setZoom(z)
      if (z >= BANK_ZOOM) fetchBanks()
      else setBanksData([])
    }

    map.current.on("zoomend", onZoom)
    map.current.on("moveend", onZoom)

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (zoom >= BANK_ZOOM && map.current) {
      fetchBanks()
    }
  }, [zoom, quarter, metric, selectedState, fetchBanks])

  const loadGeoJSON = useCallback(() => {
    if (!map.current || statesData.length === 0) return

    const stateMapByCode = new Map(statesData.map((s) => [s.stateCode.toUpperCase(), s]))
    const getColorValue = (s: StateData): number => {
      if (colorBy === "high_stress_share") return s.highStressShare
      if (colorBy === "stress_p90") return s.stressP90
      return s.stressAvg
    }
    const colorValues = statesData.map(getColorValue).filter((v) => Number.isFinite(v))
    const { getColor, legendLabels: labels } = computeQuantileScale(colorValues)
    setLegendLabels(labels)
    const min = Math.min(...colorValues, 0)
    const max = Math.max(...colorValues, 0)
    setNoVariation(
      colorValues.length < 10 || Math.abs(max - min) < 1e-6
    )

    fetch("/data/us-states.json")
      .then((r) => r.json())
      .then((geojson) => {
        if (!map.current) return
        const source = map.current.getSource("states")
        if (source) map.current.removeLayer("states-fill")
        if (source) map.current.removeSource("states")

        geojson.features.forEach((f: GeoJSON.Feature) => {
          const fips = String(f.id ?? "").padStart(2, "0")
          const stusps = FIPS_TO_STALP[fips] ?? fips
          const stateData = stateMapByCode.get(stusps)
          const props = f.properties as Record<string, unknown>
          if (stateData) {
            const val = getColorValue(stateData)
            props.fillColor = getColor(val)
          } else {
            props.fillColor = STRESS_COLORS[0]
          }
        })

        map.current.addSource("states", {
          type: "geojson",
          data: geojson,
        })

        map.current.addLayer({
          id: "states-fill",
          type: "fill",
          source: "states",
          paint: {
            "fill-color": ["get", "fillColor"],
            "fill-opacity": 0.75,
          },
        })

        map.current.on("click", "states-fill", (e) => {
          const name = e.features?.[0]?.properties?.name as string
          if (name) {
            setSelectedState(name)
            const center = STATE_CENTROIDS[name]
            if (center && map.current) {
              map.current.flyTo({ center, zoom: 5, duration: 800 })
            }
          }
        })

        map.current.on("mouseenter", "states-fill", () => {
          map.current!.getCanvas().style.cursor = "pointer"
        })
        map.current.on("mouseleave", "states-fill", () => {
          map.current!.getCanvas().style.cursor = ""
        })
      })
      .catch((e) => console.error("Failed to load states GeoJSON:", e))
  }, [statesData, colorBy])

  useEffect(() => {
    loadGeoJSON()
  }, [loadGeoJSON])

  const updateMetrosLayer = useCallback(() => {
    if (!map.current) return

    const source = map.current.getSource("metros")
    if (source) {
      map.current.removeLayer("metros-circles")
      map.current.removeSource("metros")
    }

    if (metrosData.length === 0) return

    const getMetroColorVal = (m: MetroData) =>
      colorBy === "high_stress_share" ? m.highStressShare : colorBy === "stress_p90" ? m.stressP90 : m.stressAvg
    const metroValues = metrosData.map(getMetroColorVal).filter((v) => Number.isFinite(v))
    const { getColor } = computeQuantileScale(metroValues)

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: metrosData.map((m) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [m.lon, m.lat],
        },
        properties: {
          ...m,
          stressColor: getColor(getMetroColorVal(m)),
        },
      })),
    }

    map.current.addSource("metros", {
      type: "geojson",
      data: geojson,
    })

    map.current.addLayer({
      id: "metros-circles",
      type: "circle",
      source: "metros",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "bankCount"],
          1,
          6,
          50,
          20,
        ],
        "circle-color": ["get", "stressColor"],
        "circle-opacity": 0.8,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#475569",
      },
    })

    map.current.on("click", "metros-circles", (e) => {
      const props = e.features?.[0]?.properties as MetroData
      if (props) {
        map.current?.flyTo({
          center: [props.lon, props.lat],
          zoom: 8,
        })
      }
    })
  }, [metrosData, colorBy])

  useEffect(() => {
    updateMetrosLayer()
  }, [updateMetrosLayer])

  const updateBanksLayer = useCallback(() => {
    if (!map.current) return

    const source = map.current.getSource("banks")
    if (source) {
      map.current.removeLayer("banks-circles")
      map.current.removeSource("banks")
    }

    if (banksData.length === 0) return

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: banksData.map((b) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [b.lon, b.lat],
        },
        properties: b,
      })),
    }

    map.current.addSource("banks", {
      type: "geojson",
      data: geojson,
    })

    map.current.addLayer({
      id: "banks-circles",
      type: "circle",
      source: "banks",
      paint: {
        "circle-radius": 6,
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "stressScore"],
          0,
          "#e2e8f0",
          30,
          "#fcd34d",
          50,
          "#fb923c",
          70,
          "#f87171",
          85,
          "#dc2626",
        ],
        "circle-opacity": 0.85,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#334155",
      },
    })
  }, [banksData])

  useEffect(() => {
    updateBanksLayer()
  }, [updateBanksLayer])

  const handleResetView = useCallback(() => {
    setSelectedState(null)
    setMetrosData([])
    setBanksData([])
    setTooltip(null)
    map.current?.flyTo({ center: US_CENTER, zoom: US_ZOOM })
  }, [])

  const handleMouseMove = useCallback(
    (e: maplibregl.MapMouseEvent) => {
      if (!map.current) return
      const features = map.current.queryRenderedFeatures(e.point)
      const stateF = features.find((f) => f.layer?.id === "states-fill")
      const metroF = features.find((f) => f.layer?.id === "metros-circles")
      const bankF = features.find((f) => f.layer?.id === "banks-circles")

      if (stateF) {
        const name = stateF.properties?.name as string
        const s = statesData.find((x) => x.state === name)
        if (s)
          setTooltip({
            type: "state",
            x: e.originalEvent.clientX,
            y: e.originalEvent.clientY,
            data: s,
          })
        return
      }
      if (metroF) {
        const p = metroF.properties as unknown as MetroData
        if (p)
          setTooltip({
            type: "metro",
            x: e.originalEvent.clientX,
            y: e.originalEvent.clientY,
            data: p,
          })
        return
      }
      if (bankF) {
        const p = bankF.properties as unknown as BankData
        if (p)
          setTooltip({
            type: "bank",
            x: e.originalEvent.clientX,
            y: e.originalEvent.clientY,
            data: p,
          })
        return
      }
      setTooltip(null)
    },
    [statesData]
  )

  useEffect(() => {
    const m = map.current
    if (!m) return
    m.on("mousemove", handleMouseMove)
    return () => {
      m.off("mousemove", handleMouseMove)
    }
  }, [handleMouseMove])

  return (
    <Card className="p-4 border-slate-200/80 bg-white overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-serif text-base font-semibold text-slate-800">
            Bank Stress Heat Map
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Click a state to zoom to metros; zoom further for bank locations
          </p>
        </div>
        <MapControls
          quarters={quarters}
          quarter={quarter}
          onQuarterChange={setQuarter}
          metric={metric}
          onMetricChange={setMetric}
          threshold={threshold}
          onThresholdChange={setThreshold}
          colorBy={colorBy}
          onColorByChange={setColorBy}
          onResetView={handleResetView}
        />
      </div>
      <div className="relative rounded-lg overflow-hidden border border-slate-200">
        <div
          ref={mapContainer}
          className="w-full h-[420px]"
          style={{ minHeight: 420 }}
        />
        {loading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <p className="text-sm text-slate-600">Loading map data…</p>
          </div>
        )}
        {noVariation && !loading && (
          <div className="absolute bottom-2 left-2 right-2 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            No variation detected — try a different quarter, metric, or color-by option.
          </div>
        )}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            {tooltip.type === "state" && (
              <StateTooltip {...(tooltip.data as StateData)} />
            )}
            {tooltip.type === "metro" && (
              <MetroTooltip {...(tooltip.data as MetroData)} />
            )}
            {tooltip.type === "bank" && (
              <BankTooltip {...(tooltip.data as BankData)} />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500 mt-2">
        {STRESS_COLORS.map((fill, i) => (
          <span key={i} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300"
              style={{ backgroundColor: fill }}
            />
            {legendLabels[i] ?? "—"}
          </span>
        ))}
        <span>· {colorBy === "high_stress_share" ? "High-stress share" : colorBy === "stress_p90" ? "P90 stress" : "Avg stress"}</span>
      </div>
    </Card>
  )
}
