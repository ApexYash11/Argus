export type AgentType =
  | "saas-waste"
  | "duplicate-payments"
  | "vendor-overbilling"
  | "policy-violations"
  | "reconciliation"
  | "anomaly-detection"
  | "cashflow-risk";

export type FindingStatus = "open" | "resolved" | "dismissed";
export type Severity = "critical" | "high" | "warning" | "info";
export type FinancialRecordType = "invoice" | "payment" | "subscription" | "expense" | "commitment";
export type FinancialRecordStatus = "cleared" | "pending" | "cancelled";

export interface FinancialRecord {
  id: string;
  type: FinancialRecordType;
  vendorId: string;
  amount: number;
  currency: string;
  date: string;
  periodStart?: string;
  periodEnd?: string;
  description?: string;
  status: FinancialRecordStatus;
  sourceDocId?: string;
  raw: string;
  ingestedAt: string;
}

export interface Vendor {
  id: string;
  canonicalName: string;
  aliases: string[];
  trustScore: number;
  firstSeen: string;
  lastSeen: string;
}

export interface Finding {
  id: string;
  fingerprint: string;
  agentType: AgentType;
  vendorId?: string;
  title: string;
  summary: string;
  evidenceChain: string;
  impactAmount?: number;
  impactCurrency?: string;
  confidence: number;
  severity: Severity;
  status: FindingStatus;
  statusReason?: string;
  scratchpadRunId?: string;
  investigationEvents: string;
  dismissedCount: number;
  createdAt: string;
  resolvedAt?: string;
}

export interface Feedback {
  id: string;
  findingId: string;
  action: "resolve" | "dismiss" | "escalate";
  reason?: string;
  confidenceDelta?: number;
  createdAt: string;
}

export interface Calibration {
  workspaceId: string;
  agentType: AgentType;
  vendorId?: string;
  thresholdOverride?: number;
  dismissCount: number;
  lastUpdated: string;
}

export interface ContractTerms {
  vendorId: string;
  basePrice: number;
  billingFrequency: "monthly" | "quarterly" | "yearly";
  escalationClause?: number;
  volumeDiscounts?: string;
  paymentTerms?: string;
  scopeOfServices?: string;
  extractedFrom: string;
  extractedAt: string;
}

export type AuditEvent =
  | { type: "agent_start"; agent: string; description: string; timestamp?: string }
  | { type: "step"; agent: string; message: string; timestamp?: string }
  | { type: "evidence_found"; key: string; value: string; sourceDocId: string; timestamp?: string }
  | { type: "comparison"; label: string; expected: string; actual: string; delta?: string; timestamp?: string }
  | { type: "confidence"; score: number; reason: string; timestamp?: string }
  | { type: "finding"; finding: Finding; timestamp?: string }
  | { type: "llm_token"; token: string; timestamp?: string }
  | { type: "agent_skipped"; agent: string; reason: string; timestamp?: string }
  | { type: "done"; totalFindings: number; durationMs: number; timestamp?: string };

export interface InvestigationState {
  trigger: FinancialEvent;
  agentType: AgentType;
  evidence: Evidence[];
  comparisons: Comparison[];
  confidence: number;
  iterations: number;
  finding?: Finding;
  events: AuditEvent[];
  effectiveFloor?: number;
}

export interface FinancialEvent {
  type: "new_invoice" | "new_payment" | "new_subscription" | "new_expense" | "daily_tick";
  recordId?: string;
  vendorId?: string;
  amount?: number;
  timestamp: string;
}

export interface Evidence {
  key: string;
  value: string;
  sourceDocId: string;
}

export interface Comparison {
  label: string;
  expected: string;
  actual: string;
  delta?: string;
}

export interface AppConfig {
  company: string;
  currency: string;
  minRunwayMonths: number;
  minOperatingReserve: number;
  maxIterations: number;
  confidenceFloor: number;
  scratchpad: {
    retentionCount: number;
  };
  policy?: PolicyRules;
}

export interface PolicyRules {
  maxExpenseWithoutReceipt?: number;
  perCategoryLimits?: Record<string, number>;
  prohibitedCategories?: string[];
  submissionWindowDays?: number;
  preApprovalThreshold?: number;
  perDiemLimits?: Record<string, number>;
}
