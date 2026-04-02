export type AssignmentRecord = {
  id: string
  assignor: string
  assignee: string
  loanAmount?: number | null
  valueStatus: "known" | "unknown"
  valueSource?: "assignment.loanAmount" | "assignment.amount" | "linkedMortgage.mortgageAmount" | "linkedMortgage.loanAmount" | "relatedMortgage.amount" | "aom.upb" | "aom.consideration" | "unknown"
  recordingDate: string
  property?: string
  propertyType?: string
  geography?: string
  linkedMortgageId?: string
  raw?: Record<string, unknown>
}

export type MortgageRecord = {
  id: string
  lender: string
  borrower: string
  amount?: number
  mortgageAmount?: number
  loanAmount?: number
  recordingDate?: string
  linkedAssignmentIds?: string[]
  property?: string
  propertyType?: string
  geography?: string
  raw?: Record<string, unknown>
}

export type PreforeclosureRecord = {
  id: string
  plaintiff: string
  defendant: string
  lender?: string
  auctionDate: string
  loanAmount?: number
  property?: string
  propertyType?: string
  geography?: string
  raw?: Record<string, unknown>
}

export type CompetitorRanking = {
  name: string
  volume: number
  volumePrev: number
  count: number
  countPrev: number
  percentChange: number
  avgDealSize: number
  category?: string   // e.g. "Buyer - Investment Firm", "Private Money"
  buyerType?: string  // e.g. "Private Money", "Bank"
  rank: number
}

export type LenderAnalyticsRecord = {
  lender: string
  volume?: number
  marketShare?: number
  trend?: "up" | "down" | "flat"
  lenderType?: string        // e.g. "Private Money", "Bank", "Mortgage Banker"
  category?: string          // e.g. "Servicer", "Trustee", "Buyer - Investment Firm"
  avgDealSize?: number       // average deal/assignment size in dollars
  dealCount?: number         // number of deals
  countPrev?: number         // prior period deal count for trend comparison
}

export type SearchEntityResult = {
  id: string
  name: string
  type: "firm" | "person" | "lender"
  location?: string
}

export type ParticipantType =
  | "institutional_lender_bank"
  | "servicer"
  | "trust_securitization_vehicle"
  | "borrower_owner_entity"
  | "individual"
  | "government_agency"
  | "unknown"

export type ParticipantProfile = {
  normalizedName: string
  displayName: string
  participantType: ParticipantType
  confidence: number
}

export type FlowEdge = {
  from_party: string
  to_party: string
  amount: number | null
  amountKnown: boolean
  valueSource?: AssignmentRecord["valueSource"]
  date: string
  rawAssignor: string
  rawAssignee: string
  property?: string
  propertyType?: string
  geography?: string
  commerciallyRelevant: boolean
  relevanceReason: string[]
  fromProfile: ParticipantProfile
  toProfile: ParticipantProfile
}

export type FlowWindowStats = {
  firm: string
  participantType: ParticipantType
  confidence: number
  inbound30d: number
  outbound30d: number
  net30d: number
  assignments30d: number
  assignments90d: number
  pctChange30dVsPrior30d: number
  inbound90d: number
  outbound90d: number
  net90d: number
  assignmentsPrior30d: number
  knownValueAssignments30d: number
  unknownValueAssignments30d: number
  valueCoveragePct30d: number
  commerciallyRelevantAssignments30d: number
  firstSeenDate?: string
  lastSeenDate?: string
  activityScore: number
  inferredRole: "assignor-heavy" | "assignee-heavy" | "balanced" | "servicer" | "trust-conduit" | "unknown"
}

export type PairAggregate = {
  assignor: string
  assignee: string
  totalVolumeKnown: number
  transactions: number
  lastActivityDate: string
  knownValueTransactions: number
  unknownValueTransactions: number
  valueCoveragePct: number
}

export type MonthlyFlowPoint = {
  month: string
  inbound: number
  outbound: number
}

export type ExecutiveAlert = {
  type: "spike" | "new_relationship" | "large_transaction" | "preforeclosure_spike" | "repeat_lender" | "repeat_borrower"
  message: string
  firm?: string
  severity: "low" | "medium" | "high"
  label?: string
}

export type CoverageMetrics = {
  totalAssignments: number
  assignmentsWithRecoveredValue: number
  assignmentsWithUnknownValue: number
  assignmentsLinkedToMortgage: number
  mortgageRecordsLoaded: number
  preforeclosureRecordsLoaded: number
  institutionalParticipants: number
  individualParticipants: number
  commerciallyRelevantRecords: number
  geographicCoverageCount: number
  valueRecoveredPct: number
  unknownValuePct: number
  mortgageLinkedPct: number
}

export type ResourceDiagnostics = {
  source: "external_api" | "local_fallback"
  totalFetched: number
  notes: string[]
  extractionStats?: Record<string, number | string>
}

export type ResourcePayload<T> = {
  items: T[]
  diagnostics: ResourceDiagnostics
}

