import type { Evidence } from "../../model/types";
import type { AgentContext } from "../state-machine";
import { getFinancialRecordsByVendor, getFinancialRecordsByType, getAllFinancialRecords, getAllVendors } from "../../db/queries";

export async function retrieveEvidence(ctx: AgentContext): Promise<Evidence[]> {
  const { agentType, trigger } = ctx.state;
  const evidence: Evidence[] = [];

  ctx.emit({ type: "step", agent: agentType, message: `Retrieving evidence for ${agentType}` });

  const allRecords = getAllFinancialRecords();
  const vendors = getAllVendors();

  evidence.push({
    key: "total_records",
    value: String(allRecords.length),
    sourceDocId: "db",
  });

  evidence.push({
    key: "total_vendors",
    value: String(vendors.length),
    sourceDocId: "db",
  });

  if (trigger.vendorId) {
    const vendorRecords = getFinancialRecordsByVendor(trigger.vendorId);
    evidence.push({
      key: `vendor_records_${trigger.vendorId}`,
      value: JSON.stringify(vendorRecords.slice(0, 20)),
      sourceDocId: "db",
    });
  }

  const byType = getFinancialRecordsByType(trigger.type === "new_subscription" ? "subscription" : trigger.type === "new_invoice" ? "invoice" : trigger.type === "new_expense" ? "expense" : "payment");
  evidence.push({
    key: `records_type_${trigger.type}`,
    value: `${byType.length} records of type`,
    sourceDocId: "db",
  });

  ctx.state.evidence = evidence;
  for (const e of evidence) {
    ctx.emit({ type: "evidence_found", key: e.key, value: e.value.slice(0, 200), sourceDocId: e.sourceDocId });
  }

  return evidence;
}
