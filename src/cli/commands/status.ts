import { getActiveAgents } from "../../engine/activation";
import { getRecordCount, getRecordCountByType, getAllVendors } from "../../db/queries";

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
  };
}
