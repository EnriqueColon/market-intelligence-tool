"use server"

import { loadWatchlistData } from "@/app/lib/watchlist"

export type WatchlistFirm = {
  canonical_name: string
  category: string
}

export async function fetchWatchlistFirms(): Promise<WatchlistFirm[]> {
  const data = await loadWatchlistData()
  return data.entries.map((e) => ({
    canonical_name: e.canonical_name,
    category: e.category,
  }))
}
