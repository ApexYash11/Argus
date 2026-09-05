import { getActiveAgents } from "../../engine/activation";
import { getRecordCount, getRecordCountByType, getAllVendors, getFpRates, getFinancialRecordsByType, getDominantCurrency } from "../../db/queries";
import { computeBurn, type BurnOverview } from "../../engine/runway";
import { pickProvider, type LLMProvider } from "../../model/llm";

export interface KeyStatus {
  provider: string;
  ready: boolean;
  hint: string;
}

const SOURCE_CONFIG: { name: string; type: string }[] = [
  { name: "subscriptions", type: "subscription" },
  { name: "transactions", type: "payment" },
  { name: "expense-reports", type: "expense" },
  { name: "invoices", type: "invoice" },
  { name: "committed-expenses", type: "commitment" },
];

export async function getStatus() {
  const agentSourceNames = SOURCE_CONFIG.map((s) => s.name);
  const agents = getActiveAgents(agentSourceNames);
  const recordCount = getRecordCount();
  const vendors = getAllVendors();
  const dataSources = SOURCE_CONFIG.map((s) => ({
    name: s.name,
    recordCount: getRecordCountByType(s.type),
  }));

  return {
    dataSources,
    recordCount,
    vendorCount: vendors.length,
    agents,
    spend: {
      ...computeBurn(
        [...getFinancialRecordsByType("payment"), ...getFinancialRecordsByType("expense")],
        getFinancialRecordsByType("commitment")
      ),
      currency: getDominantCurrency(),
    } as BurnOverview & { currency: string },
    llm: llmStatus(),
  };
}

function llmStatus(): KeyStatus {
  const p = pickProvider() as LLMProvider;
  const model = process.env.OPENROUTER_MODEL ?? (p.name === "openrouter" ? "openrouter/free" : p.name);
  if (p.name === "local") {
    return { provider: "local", ready: false, hint: "Set OPENROUTER_API_KEY in .env to enable LLM features (chat recommendations, schema assist)." };
  }
  return { provider: `${p.name} (${model})`, ready: true, hint: "LLM ready." };
}
