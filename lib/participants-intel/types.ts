export type AssignmentRecord = {
  id: string
  assignor: string
  assignee: string
  loanAmount: number
  recordingDate: string
  property?: string
}

export type MortgageRecord = {
  id: string
  lender: string
  borrower: string
  amount?: number
  recordingDate?: string
  linkedAssignmentIds?: string[]
}

export type PreforeclosureRecord = {
  id: string
  plaintiff: string
  defendant: string
  lender?: string
  auctionDate: string
  loanAmount?: number
  property?: string
}

export type LenderAnalyticsRecord = {
  lender: string
  volume?: number
  marketShare?: number
  trend?: "up" | "down" | "flat"
}

export type SearchEntityResult = {
  id: string
  name: string
  type: "firm" | "person" | "lender"
  location?: string
}

export type FlowEdge = {
  from_party: string
  to_party: string
  amount: number
  date: string
  rawAssignor: string
  rawAssignee: string
  property?: string
}

export type FlowWindowStats = {
  firm: string
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
}

export type PairAggregate = {
  assignor: string
  assignee: string
  totalVolume: number
  transactions: number
  lastActivityDate: string
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
}

