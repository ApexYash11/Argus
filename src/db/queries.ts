import { getDb } from "./index";
import type { Finding, Feedback, Calibration, FinancialRecord, Vendor, ContractTerms } from "../model/types";

export function insertFinancialRecord(record: FinancialRecord): void {
  const db = getDb();
  db.run(
    `INSERT OR REPLACE INTO financial_records (id, type, vendor_id, amount, currency, date, period_start, period_end, description, status, source_doc_id, raw, ingested_at)
     VALUES ($id, $type, $vendorId, $amount, $currency, $date, $periodStart, $periodEnd, $description, $status, $sourceDocId, $raw, $ingestedAt)`,
    {
      $id: record.id,
      $type: record.type,
      $vendorId: record.vendorId,
      $amount: record.amount,
      $currency: record.currency,
      $date: record.date,
      $periodStart: record.periodStart ?? null,
      $periodEnd: record.periodEnd ?? null,
      $description: record.description ?? null,
      $status: record.status,
      $sourceDocId: record.sourceDocId ?? null,
      $raw: record.raw,
      $ingestedAt: record.ingestedAt,
    }
  );
}

function mapFinancialRecord(row: Record<string, unknown>): FinancialRecord {
  return {
    id: row.id as string,
    type: row.type as FinancialRecord["type"],
    vendorId: row.vendor_id as string,
    amount: row.amount as number,
    currency: row.currency as string,
    date: row.date as string,
    periodStart: row.period_start as string | undefined,
    periodEnd: row.period_end as string | undefined,
    description: row.description as string | undefined,
    status: row.status as FinancialRecord["status"],
    sourceDocId: row.source_doc_id as string | undefined,
    raw: row.raw as string,
    ingestedAt: row.ingested_at as string,
  };
}

export function getFinancialRecordsByVendor(vendorId: string): FinancialRecord[] {
  const db = getDb();
  return (db.query("SELECT * FROM financial_records WHERE vendor_id = $vendorId ORDER BY date DESC").all({ $vendorId: vendorId }) as Record<string, unknown>[]).map(mapFinancialRecord);
}

export function getFinancialRecordsByType(type: string): FinancialRecord[] {
  const db = getDb();
  return (db.query("SELECT * FROM financial_records WHERE type = $type ORDER BY date DESC").all({ $type: type }) as Record<string, unknown>[]).map(mapFinancialRecord);
}

export function getAllFinancialRecords(): FinancialRecord[] {
  const db = getDb();
  return (db.query("SELECT * FROM financial_records ORDER BY date DESC").all() as Record<string, unknown>[]).map(mapFinancialRecord);
}

export function getDateRange(): { min: string; max: string } | null {
  const db = getDb();
  const row = db.query("SELECT MIN(date) as min, MAX(date) as max FROM financial_records").get() as { min: string | null; max: string | null } | undefined;
  if (!row || !row.min || !row.max) return null;
  return { min: row.min, max: row.max };
}

export function upsertVendor(vendor: Vendor): void {
  const db = getDb();
  db.run(
    `INSERT INTO vendors (id, canonical_name, aliases, trust_score, first_seen, last_seen)
     VALUES ($id, $name, $aliases, $score, $firstSeen, $lastSeen)
     ON CONFLICT(id) DO UPDATE SET
       canonical_name = excluded.canonical_name,
       aliases = excluded.aliases,
       trust_score = excluded.trust_score,
       last_seen = excluded.last_seen`,
    {
      $id: vendor.id,
      $name: vendor.canonicalName,
      $aliases: JSON.stringify(vendor.aliases),
      $score: vendor.trustScore,
      $firstSeen: vendor.firstSeen,
      $lastSeen: vendor.lastSeen,
    }
  );
}

export function getVendorByAlias(name: string): Vendor | null {
  const db = getDb();
  const rows = db.query("SELECT * FROM vendors").all() as Array<{ id: string; canonical_name: string; aliases: string; trust_score: number; first_seen: string; last_seen: string }>;
  for (const row of rows) {
    const aliases: string[] = JSON.parse(row.aliases);
    if (aliases.some((a) => a.toLowerCase() === name.toLowerCase()) || row.canonical_name.toLowerCase() === name.toLowerCase()) {
      return {
        id: row.id,
        canonicalName: row.canonical_name,
        aliases,
        trustScore: row.trust_score,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      };
    }
  }
  return null;
}

export function getAllVendors(): Vendor[] {
  const db = getDb();
  return (db.query("SELECT * FROM vendors ORDER BY canonical_name").all() as Array<{
    id: string; canonical_name: string; aliases: string; trust_score: number; first_seen: string; last_seen: string;
  }>).map((r) => ({
    id: r.id,
    canonicalName: r.canonical_name,
    aliases: JSON.parse(r.aliases),
    trustScore: r.trust_score,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  }));
}

export function insertFinding(finding: Finding): void {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO findings (id, fingerprint, agent_type, vendor_id, title, summary, evidence_chain, impact_amount, impact_currency, confidence, severity, status, scratchpad_run_id, investigation_events, dismissed_count, created_at)
     VALUES ($id, $fingerprint, $agentType, $vendorId, $title, $summary, $evidenceChain, $impactAmount, $impactCurrency, $confidence, $severity, $status, $scratchpadRunId, $investigationEvents, $dismissedCount, $createdAt)`,
    {
      $id: finding.id,
      $fingerprint: finding.fingerprint,
      $agentType: finding.agentType,
      $vendorId: finding.vendorId ?? null,
      $title: finding.title,
      $summary: finding.summary,
      $evidenceChain: finding.evidenceChain,
      $impactAmount: finding.impactAmount ?? null,
      $impactCurrency: finding.impactCurrency ?? null,
      $confidence: finding.confidence,
      $severity: finding.severity,
      $status: finding.status,
      $scratchpadRunId: finding.scratchpadRunId ?? null,
      $investigationEvents: finding.investigationEvents,
      $dismissedCount: finding.dismissedCount,
      $createdAt: finding.createdAt,
    }
  );
}

export function findExistingFingerprint(fingerprint: string): Finding | null {
  const db = getDb();
  const row = db.query("SELECT * FROM findings WHERE fingerprint = $fingerprint").get({ $fingerprint: fingerprint }) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToFinding(row);
}

export function getFindings(filters?: { status?: string; severity?: string; agentType?: string; since?: string }): Finding[] {
  const db = getDb();
  let sql = "SELECT * FROM findings WHERE 1=1";
  const params: Record<string, string> = {};
  if (filters?.status) {
    sql += " AND status = $status";
    params.$status = filters.status;
  }
  if (filters?.severity) {
    sql += " AND severity = $severity";
    params.$severity = filters.severity;
  }
  if (filters?.agentType) {
    sql += " AND agent_type = $agentType";
    params.$agentType = filters.agentType;
  }
  if (filters?.since) {
    sql += " AND created_at >= datetime('now', '-' || $since || ' days')";
    params.$since = filters.since;
  }
  sql += " ORDER BY created_at DESC";
  return (db.query(sql).all(params) as Record<string, unknown>[]).map(rowToFinding);
}

export function getFindingById(id: string): Finding | null {
  const db = getDb();
  const row = db.query("SELECT * FROM findings WHERE id = $id").get({ $id: id }) as Record<string, unknown> | null;
  if (!row) return null;
  return rowToFinding(row);
}

export function updateFindingStatus(id: string, status: string, reason?: string): void {
  const db = getDb();
  db.run(
    `UPDATE findings SET status = $status, status_reason = $reason, resolved_at = CASE WHEN $status IN ('resolved','dismissed') THEN datetime('now') ELSE resolved_at END WHERE id = $id`,
    { $id: id, $status: status, $reason: reason ?? null }
  );
}

export function incrementDismissCount(id: string): void {
  const db = getDb();
  db.run("UPDATE findings SET dismissed_count = dismissed_count + 1 WHERE id = $id", { $id: id });
}

export function insertFeedback(feedback: Feedback): void {
  const db = getDb();
  db.run(
    `INSERT INTO feedback (id, finding_id, action, reason, confidence_delta, created_at)
     VALUES ($id, $findingId, $action, $reason, $confidenceDelta, $createdAt)`,
    {
      $id: feedback.id,
      $findingId: feedback.findingId,
      $action: feedback.action,
      $reason: feedback.reason ?? null,
      $confidenceDelta: feedback.confidenceDelta ?? null,
      $createdAt: feedback.createdAt,
    }
  );
}

export function getCalibrationsForAgent(agentType: string): Calibration[] {
  const db = getDb();
  return (db.query("SELECT * FROM calibration WHERE agent_type = $agentType").all({ $agentType: agentType }) as Record<string, unknown>[]).map((row) => ({
    workspaceId: row.workspace_id as string,
    agentType: row.agent_type as Calibration["agentType"],
    vendorId: row.vendor_id as string | undefined,
    thresholdOverride: row.threshold_override as number | undefined,
    dismissCount: row.dismiss_count as number,
    lastUpdated: row.last_updated as string,
  }));
}

export function getCalibration(agentType: string, vendorId?: string): Calibration | null {
  const db = getDb();
  const row = db.query(
    "SELECT * FROM calibration WHERE workspace_id = 'default' AND agent_type = $agentType AND (vendor_id = $vendorId OR ($vendorId IS NULL AND vendor_id IS NULL))"
  ).get({ $agentType: agentType, $vendorId: vendorId ?? null }) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    workspaceId: row.workspace_id as string,
    agentType: row.agent_type as Calibration["agentType"],
    vendorId: row.vendor_id as string | undefined,
    thresholdOverride: row.threshold_override as number | undefined,
    dismissCount: row.dismiss_count as number,
    lastUpdated: row.last_updated as string,
  };
}

export function upsertCalibration(cal: Calibration): void {
  const db = getDb();
  db.run(
    `INSERT INTO calibration (workspace_id, agent_type, vendor_id, threshold_override, dismiss_count, last_updated)
     VALUES ($workspaceId, $agentType, $vendorId, $thresholdOverride, $dismissCount, $lastUpdated)
     ON CONFLICT(workspace_id, agent_type, vendor_id) DO UPDATE SET
       threshold_override = excluded.threshold_override,
       dismiss_count = excluded.dismiss_count,
       last_updated = excluded.last_updated`,
    {
      $workspaceId: cal.workspaceId,
      $agentType: cal.agentType,
      $vendorId: cal.vendorId ?? null,
      $thresholdOverride: cal.thresholdOverride ?? null,
      $dismissCount: cal.dismissCount,
      $lastUpdated: cal.lastUpdated,
    }
  );
}

export interface UsageRecord {
  id: string;
  employeeEmail: string;
  tool: string;
  lastLogin: string;
  vendorId?: string;
  ingestedAt: string;
}

export function insertUsageRecord(record: UsageRecord): void {
  const db = getDb();
  db.run(
    `INSERT OR REPLACE INTO usage_records (id, employee_email, tool, last_login, vendor_id, ingested_at)
     VALUES ($id, $email, $tool, $lastLogin, $vendorId, $ingestedAt)`,
    {
      $id: record.id,
      $email: record.employeeEmail,
      $tool: record.tool,
      $lastLogin: record.lastLogin,
      $vendorId: record.vendorId ?? null,
      $ingestedAt: record.ingestedAt,
    }
  );
}

export function getAllUsageRecords(): UsageRecord[] {
  const db = getDb();
  return (db.query("SELECT * FROM usage_records ORDER BY last_login DESC").all() as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    employeeEmail: row.employee_email as string,
    tool: row.tool as string,
    lastLogin: row.last_login as string,
    vendorId: row.vendor_id as string | undefined,
    ingestedAt: row.ingested_at as string,
  }));
}

export function getUsageByTool(tool: string): UsageRecord[] {
  const db = getDb();
  return (db.query("SELECT * FROM usage_records WHERE tool = $tool ORDER BY last_login DESC").all({ $tool: tool }) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    employeeEmail: row.employee_email as string,
    tool: row.tool as string,
    lastLogin: row.last_login as string,
    vendorId: row.vendor_id as string | undefined,
    ingestedAt: row.ingested_at as string,
  }));
}

export function getAllContractTerms(): ContractTerms[] {
  const db = getDb();
  return (db.query("SELECT * FROM contract_terms ORDER BY vendor_id").all() as Record<string, unknown>[]).map((row) => ({
    vendorId: row.vendor_id as string,
    basePrice: row.base_price as number,
    billingFrequency: row.billing_frequency as ContractTerms["billingFrequency"],
    escalationClause: row.escalation_clause != null ? (row.escalation_clause as number) : undefined,
    volumeDiscounts: (row.volume_discounts as string) ?? undefined,
    paymentTerms: (row.payment_terms as string) ?? undefined,
    scopeOfServices: (row.scope_of_services as string) ?? undefined,
    extractedFrom: row.extracted_from as string,
    extractedAt: row.extracted_at as string,
  }));
}

export function getContractTermsByVendor(vendorId: string): ContractTerms | null {
  const db = getDb();
  const row = db.query("SELECT * FROM contract_terms WHERE vendor_id = $vendorId").get({ $vendorId: vendorId }) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    vendorId: row.vendor_id as string,
    basePrice: row.base_price as number,
    billingFrequency: row.billing_frequency as ContractTerms["billingFrequency"],
    escalationClause: row.escalation_clause != null ? (row.escalation_clause as number) : undefined,
    volumeDiscounts: (row.volume_discounts as string) ?? undefined,
    paymentTerms: (row.payment_terms as string) ?? undefined,
    scopeOfServices: (row.scope_of_services as string) ?? undefined,
    extractedFrom: row.extracted_from as string,
    extractedAt: row.extracted_at as string,
  };
}

export function getRecordCount(): number {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) as count FROM financial_records").get() as { count: number };
  return row.count;
}

export function updateVendorTrustScore(vendorId: string, delta: number): void {
  const db = getDb();
  db.run(
    "UPDATE vendors SET trust_score = MAX(0.0, MIN(1.0, COALESCE(trust_score, 1.0) + $delta)) WHERE id = $id",
    { $id: vendorId, $delta: delta }
  );
}

export function getRecordCountByType(type: string): number {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) as count FROM financial_records WHERE type = $type").get({ $type: type }) as { count: number };
  return row.count;
}

export function getHistoryDays(): number {
  const db = getDb();
  const row = db.query("SELECT (julianday(MAX(date)) - julianday(MIN(date))) as days FROM financial_records").get() as { days: number | null };
  return row.days ?? 0;
}

function rowToFinding(row: Record<string, unknown>): Finding {
  return {
    id: row.id as string,
    fingerprint: row.fingerprint as string,
    agentType: row.agent_type as Finding["agentType"],
    vendorId: row.vendor_id as string | undefined,
    title: row.title as string,
    summary: row.summary as string,
    evidenceChain: row.evidence_chain as string,
    impactAmount: row.impact_amount as number | undefined,
    impactCurrency: row.impact_currency as string | undefined,
    confidence: row.confidence as number,
    severity: row.severity as Finding["severity"],
    status: row.status as Finding["status"],
    statusReason: row.status_reason as string | undefined,
    scratchpadRunId: row.scratchpad_run_id as string | undefined,
    investigationEvents: row.investigation_events as string,
    dismissedCount: row.dismissed_count as number,
    createdAt: row.created_at as string,
    resolvedAt: row.resolved_at as string | undefined,
  };
}
