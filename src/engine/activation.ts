import type { AgentType } from "../model/types";
import { getRecordCount, getHistoryDays } from "../db/queries";

interface AgentActivation {
  agent: AgentType;
  ready: boolean;
  missingData: string[];
  reason?: string;
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

  switch (agent) {
    case "saas-waste":
      if (!dataSources.includes("subscriptions")) missingData.push("subscriptions data (CSV)");
      break;

    case "duplicate-payments":
      if (!dataSources.includes("transactions")) missingData.push("transactions data (CSV)");
      break;

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
      if (!dataSources.includes("transactions")) {
        missingData.push("transactions data (CSV, 3+ months)");
      } else if (historyDays < 60) {
        return {
          agent,
          ready: false,
          missingData: [],
          reason: `insufficient history — need 60+ days (have ${Math.round(historyDays)} days)`,
        };
      }
      break;
    }

    case "cashflow-risk": {
      if (!dataSources.includes("transactions")) {
        missingData.push("transactions data (CSV)");
      }
      if (!dataSources.includes("committed-expenses")) {
        missingData.push("committed expenses data (CSV)");
      }
      if (historyDays < 60) {
        return {
          agent,
          ready: false,
          missingData: [],
          reason: `insufficient history — need 60+ days (have ${Math.round(historyDays)} days)`,
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
