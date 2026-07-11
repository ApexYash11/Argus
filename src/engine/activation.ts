import type { AgentType } from "../model/types";
import { getRecordCount, getRecordCountByType, getHistoryDays, getDateRange, getRecordQualityFlagCount } from "../db/queries";

interface AgentActivation {
  agent: AgentType;
  ready: boolean;
  missingData: string[];
  reason?: string;
}

function getQualityFlagRatio(flagName: string): number {
  const totalCount = getRecordCount();
  if (totalCount === 0) return 0;
  const matchCount = getRecordQualityFlagCount(flagName);
  return matchCount / totalCount;
}

function getLatestRecordDate(): string | null {
  const range = getDateRange();
  return range?.max ?? null;
}

export function getActiveAgents(dataSources: string[]): AgentActivation[] {
  const allAgents: AgentType[] = [
    "saas-waste",
    "duplicate-payments",
    "vendor-overbilling",
    "policy-violations",
    "reconciliation",
    "anomaly-detection",
    "cashflow-risk",
  ];

  return allAgents.map((agent) => checkAgentActivation(agent, dataSources));
}

function checkAgentActivation(
  agent: AgentType,
  dataSources: string[]
): AgentActivation {
  const missingData: string[] = [];
  const recordCount = getRecordCount();
  const historyDays = getHistoryDays();
  const latestDate = getLatestRecordDate();

  // Data freshness check (applies to all agents except saas-waste which checks subscriptions)
  if (latestDate && agent !== "saas-waste") {
    const latest = new Date(latestDate);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    if (latest < cutoff) {
      return {
        agent,
        ready: false,
        missingData: [],
        reason: `data is stale — latest record is ${latestDate} (>90 days old)`,
      };
    }
  }

  switch (agent) {
    case "saas-waste":
      if (!dataSources.includes("subscriptions")) missingData.push("subscriptions data (CSV)");
      break;

    case "duplicate-payments": {
      const paymentCount = getRecordCountByType("payment") + getRecordCountByType("invoice") + getRecordCountByType("expense");
      if (paymentCount < 2) {
        return {
          agent,
          ready: false,
          missingData: [],
          reason: `need at least 2 payment/invoice/expense records (found ${paymentCount})`,
        };
      }
      const amountZeroRatio = getQualityFlagRatio("amount_zero");
      if (amountZeroRatio > 0.5) {
        return {
          agent,
          ready: false,
          missingData: [],
          reason: `too many zero-amount records (${(amountZeroRatio * 100).toFixed(0)}%) — amount-based duplicate detection unreliable`,
        };
      }
      break;
    }

    case "vendor-overbilling":
      if (!dataSources.includes("transactions")) missingData.push("transactions data (CSV)");
      if (!dataSources.includes("contracts") && !dataSources.includes("invoices")) {
        missingData.push("invoice or contract documents (PDF or CSV)");
      }
      break;

    case "policy-violations":
      if (!dataSources.includes("expense-reports")) missingData.push("expense reports data (CSV)");
      break;

    case "reconciliation":
      if (!dataSources.includes("transactions")) missingData.push("transactions data (CSV)");
      if (!dataSources.includes("invoices")) missingData.push("invoices data (PDF or CSV)");
      break;

    case "anomaly-detection": {
      const anyRecords = recordCount;
      if (anyRecords < 10) {
        return {
          agent,
          ready: false,
          missingData: [],
          reason: `need at least 10 records for anomaly detection (found ${anyRecords})`,
        };
      }
      if (historyDays < 60) {
        return {
          agent,
          ready: false,
          missingData: [],
          reason: `insufficient history — need 60+ days (have ${Math.round(historyDays)} days)`,
        };
      }
      const dateDefaultedRatio = getQualityFlagRatio("date_defaulted");
      if (dateDefaultedRatio > 0.5) {
        return {
          agent,
          ready: false,
          missingData: [],
          reason: `too many records with defaulted dates (${(dateDefaultedRatio * 100).toFixed(0)}%) — date-sensitive analysis unreliable`,
        };
      }
      break;
    }

    case "cashflow-risk": {
      const paymentCount = getRecordCountByType("payment");
      const committedCount = getRecordCountByType("commitment");
      const hasPayments = paymentCount >= 10 && historyDays >= 60;
      const hasCommitted = committedCount >= 1;
      if (!hasPayments && !hasCommitted) {
        const reasons: string[] = [];
        if (paymentCount < 10) reasons.push(`need 10+ payment records (have ${paymentCount})`);
        if (historyDays < 60) reasons.push(`need 60+ days history (have ${Math.round(historyDays)} days)`);
        if (committedCount < 1) reasons.push("need at least 1 committed expense record");
        return {
          agent,
          ready: false,
          missingData: [],
          reason: reasons.join("; "),
        };
      }
      break;
    }
  }

  return {
    agent,
    ready: missingData.length === 0 && recordCount > 0,
    missingData,
  };
}
