import { getFindings, getRecordCount, getFpRates, getDominantCurrency, getAllVendors, getDateRange } from "../../db/queries";
import { getCacheStats } from "../../ingest/schema-detector";

export interface ReportOutput {
  period: string;
  generatedAt: string;
  summary: {
    total: number;
    open: number;
    critical: number;
    resolved: number;
    dismissed: number;
    totalImpact: number;
    moneyFound: number;
    currency: string;
    recordCount: number;
    vendorCount: number;
    dateRange: { min: string; max: string } | null;
  };
  findings: Array<{
    id: string;
    agentType: string;
    vendorId?: string;
    severity: string;
    status: string;
    impactAmount?: number;
    impactCurrency?: string;
    confidence: number;
    createdAt: string;
  }>;
  schemaCache: { hits: number; misses: number };
  agentRates: Array<{
    agentType: string;
    resolved: number;
    dismissed: number;
    escalated: number;
    fpRate: number | null;
    tpRate: number | null;
  }>;
}

export async function generateReport(period?: string): Promise<ReportOutput> {
  const since = period ? period.replace(/^Q\d-/, "").replace(/-.*$/, "") + "-01" : undefined;
  const findings = getFindings({ since });
  const openFindings = findings.filter((f) => f.status === "open");
  const criticalFindings = findings.filter((f) => f.severity === "critical");
  const totalImpact = findings.reduce((sum, f) => sum + (f.impactAmount ?? 0), 0);
  const moneyFound = findings
    .filter((f) => f.status === "open" || f.status === "resolved")
    .reduce((sum, f) => sum + (f.impactAmount ?? 0), 0);

  return {
    period: period ?? "all-time",
    generatedAt: new Date().toISOString(),
    summary: {
      total: findings.length,
      open: openFindings.length,
      critical: criticalFindings.length,
      resolved: findings.filter((f) => f.status === "resolved").length,
      dismissed: findings.filter((f) => f.status === "dismissed").length,
      totalImpact,
      moneyFound,
      currency: getDominantCurrency(),
      recordCount: getRecordCount(),
      vendorCount: getAllVendors().length,
      dateRange: getDateRange(),
    },
    findings: findings.map((f) => ({
      id: f.id,
      agentType: f.agentType,
      vendorId: f.vendorId,
      severity: f.severity,
      status: f.status,
      impactAmount: f.impactAmount,
      impactCurrency: f.impactCurrency,
      confidence: f.confidence,
      createdAt: f.createdAt,
    })),
    schemaCache: getCacheStats(),
    agentRates: getFpRates(),
  };
}
