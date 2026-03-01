"use client"

import {
  fetchFDICDemographics,
  fetchFDICFailures,
  fetchFDICFinancials,
  fetchFDICInstitutions,
} from "@/app/actions/fetch-fdic-data"
import type {
  BankFailureData,
  BankFinancialData,
  BankInstitutionData,
  DemographicsData,
} from "@/lib/fdic-data-transformer"

type FinancialsResponse = { data: BankFinancialData[]; error?: string }
type InstitutionsResponse = { data: BankInstitutionData[]; error?: string }
type FailuresResponse = { data: BankFailureData[]; error?: string }
type DemographicsResponse = { data: DemographicsData[]; error?: string }

const financialsCache = new Map<string, Promise<FinancialsResponse>>()
const institutionsCache = new Map<string, Promise<InstitutionsResponse>>()
const failuresCache = new Map<string, Promise<FailuresResponse>>()
const demographicsCache = new Map<string, Promise<DemographicsResponse>>()

function getOrSetCache<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const existing = cache.get(key)
  if (existing) return existing

  const promise = fetcher().catch(error => {
    cache.delete(key)
    throw error
  })
  cache.set(key, promise)
  return promise
}

export function fetchFDICFinancialsCached(state?: string, limit: number = 100) {
  const key = `financials|${state ?? "all"}|${limit}`
  return getOrSetCache(financialsCache, key, () => fetchFDICFinancials(state, limit))
}

export function fetchFDICInstitutionsCached(state?: string, limit: number = 100) {
  const key = `institutions|${state ?? "all"}|${limit}`
  return getOrSetCache(institutionsCache, key, () => fetchFDICInstitutions(state, limit))
}

export function fetchFDICFailuresCached(
  startDate?: string,
  endDate?: string,
  state?: string
) {
  const key = `failures|${startDate ?? "none"}|${endDate ?? "none"}|${state ?? "all"}`
  return getOrSetCache(failuresCache, key, () =>
    fetchFDICFailures(startDate, endDate, state)
  )
}

export function fetchFDICDemographicsCached(metroArea?: string, state?: string) {
  const key = `demographics|${metroArea ?? "all"}|${state ?? "all"}`
  return getOrSetCache(demographicsCache, key, () =>
    fetchFDICDemographics(metroArea, state)
  )
}

export async function prefetchFDICDashboardData() {
  const defaultState = "Florida"
  const metroArea = "Miami-Fort Lauderdale-West Palm Beach"
  const southeastStates = [
    "Florida",
    "Georgia",
    "Alabama",
    "South Carolina",
    "North Carolina",
    "Tennessee",
  ]

  const endDate = new Date()
  const startDate = new Date()
  startDate.setFullYear(endDate.getFullYear() - 1)
  const startDateStr = startDate.toISOString().split("T")[0]
  const endDateStr = endDate.toISOString().split("T")[0]

  await Promise.all([
    fetchFDICFinancialsCached(defaultState, 100),
    fetchFDICFinancialsCached(defaultState, 200),
    fetchFDICFinancialsCached(undefined, 200),
    fetchFDICInstitutionsCached(defaultState, 200),
    fetchFDICDemographicsCached(metroArea, defaultState),
    fetchFDICFailuresCached(startDateStr, endDateStr),
    ...southeastStates.map(state => fetchFDICFinancialsCached(state, 100)),
  ])
}
