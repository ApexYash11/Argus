import { registerAgent } from "./supervisor";
import type { Comparison } from "../model/types";
import { getFinancialRecordsByType, getAllContractTerms, getContractTermsByVendor } from "../db/queries";

registerAgent("vendor-overbilling", {
  async classify(ctx) {
    ctx.emit({ type: "step", agent: "vendor-overbilling", message: "Comparing invoices against contracted terms..." });
  },

  async retrieve(ctx) {
    const invoices = getFinancialRecordsByType("invoice");
    const contracts = getAllContractTerms();

    ctx.state.evidence = [
      { key: "invoice_count", value: String(invoices.length), sourceDocId: "db" },
      { key: "contract_count", value: String(contracts.length), sourceDocId: "db" },
    ];

    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const comparisons: Comparison[] = [];
    const invoices = getFinancialRecordsByType("invoice");
    const contracts = getAllContractTerms();
    const contractsByVendor = new Map(contracts.map((c) => [c.vendorId.toLowerCase(), c]));

    const invoicesByVendor = new Map<string, typeof invoices>();
    for (const inv of invoices) {
      const key = inv.vendorId.toLowerCase();
      const list = invoicesByVendor.get(key) ?? [];
      list.push(inv);
      invoicesByVendor.set(key, list);
    }

    for (const [vendorKey, invs] of invoicesByVendor) {
      const contract = contractsByVendor.get(vendorKey);

      invs.sort((a, b) => a.date.localeCompare(b.date));

      const totalBilled = invs.reduce((s, i) => s + i.amount, 0);
      const avgInvoice = totalBilled / invs.length;

      if (contract) {
        const expectedPerPeriod = contract.basePrice;
        const freq = contract.billingFrequency;
        const periodLabel = freq === "monthly" ? "mo" : freq === "quarterly" ? "qtr" : "yr";

        if (avgInvoice > expectedPerPeriod * 1.1) {
          const deviation = ((avgInvoice - expectedPerPeriod) / expectedPerPeriod * 100).toFixed(0);
          comparisons.push({
            label: invs[0]!.vendorId,
            expected: `~${expectedPerPeriod}/${periodLabel} per contract`,
            actual: `${avgInvoice.toFixed(0)} avg invoice`,
            delta: `Overbilled by ${deviation}% vs contracted rate`,
          });
        }

        if (contract.escalationClause) {
          const maxAllowed = expectedPerPeriod * (1 + contract.escalationClause);
          const overLimit = invs.filter((i) => i.amount > maxAllowed);
          for (const inv of overLimit) {
            comparisons.push({
              label: `${invs[0]!.vendorId} (${inv.date})`,
              expected: `max ${maxAllowed.toFixed(0)} per ${periodLabel} (incl. ${(contract.escalationClause * 100).toFixed(0)}% escalation)`,
              actual: `${inv.amount} billed`,
              delta: `Exceeds escalation clause by ${(inv.amount - maxAllowed).toFixed(0)}`,
            });
          }
        }
      } else {
        if (invs.length >= 2) {
          comparisons.push({
            label: invs[0]!.vendorId,
            expected: "contracted rate on file",
            actual: `${invs.length} invoice(s), avg ${avgInvoice.toFixed(0)}`,
            delta: "No contract terms available for comparison",
          });
        }
      }
    }

    return comparisons;
  },

  async score(ctx) {
    const cmpCount = ctx.state.comparisons.length;
    const overbilledCount = ctx.state.comparisons.filter((c) => c.delta?.includes("Overbilled")).length;
    const escalationCount = ctx.state.comparisons.filter((c) => c.delta?.includes("escalation")).length;

    let score = 0.5;
    const reasons: string[] = [];

    if (overbilledCount > 0) { score += 0.25; reasons.push(`${overbilledCount} overbilling signal(s)`); }
    if (escalationCount > 0) { score += 0.2; reasons.push(`${escalationCount} escalation breach(es)`); }
    const noContractCount = cmpCount - overbilledCount - escalationCount;
    if (noContractCount > 0) { score += 0.05; reasons.push(`${noContractCount} vendor(s) without contract`); }
    if (cmpCount === 0) { score = 0; reasons.push("no vendors flagged"); }

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
