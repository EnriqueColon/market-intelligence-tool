export type SurveillanceEvent = {
  competitor_id: number
  source_type: string
  event_type: string
  title?: string
  summary?: string
  event_date?: string
  url?: string
  raw_json?: string
}

export type ConnectorResult = {
  events: SurveillanceEvent[]
  records: number
  status: "ok" | "partial" | "error"
  message?: string
}

export type ConnectorConfig = Record<string, unknown>

export interface Connector {
  key: string
  name: string
  sourceType: string
  run(ctx: RunContext): Promise<ConnectorResult>
  isConfigured?(): boolean
}

export type RunContext = {
  competitorIds?: number[]
  dryRun?: boolean
}
