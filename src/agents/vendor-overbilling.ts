import { registerAgent } from "./supervisor";
import type { Comparison, FinancialRecord } from "../model/types";
import { getFinancialRecordsByType, getAllContractTerms } from "../db/queries";

function invoicePeriod(dateOrPeriod: string, frequency: string): string {
  if (frequency === "monthly") return dateOrPeriod.slice(0, 7);
  if (frequency === "quarterly") {
    const m = parseInt(dateOrPeriod.slice(5, 7), 10);
    const q = m <= 3 ? "Q1" : m <= 6 ? "Q2" : m <= 9 ? "Q3" : "Q4";
    return `${dateOrPeriod.slice(0, 4)}-${q}`;
  }
  return dateOrPeriod.slice(0, 4);
}

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

    const invoicesByVendor = new Map<string, FinancialRecord[]>();
    for (const inv of invoices) {
      const key = inv.vendorId.toLowerCase();
      const list = invoicesByVendor.get(key) ?? [];
      list.push(inv);
      invoicesByVendor.set(key, list);
    }

    for (const [vendorKey, invs] of invoicesByVendor) {
      const contract = contractsByVendor.get(vendorKey);

      if (contract) {
        const freq = contract.billingFrequency;
        const periodLabel = freq === "monthly" ? "mo" : freq === "quarterly" ? "qtr" : "yr";

        const periodBuckets = new Map<string, number>();
        for (const inv of invs) {
          const invPeriod = inv.periodStart ?? inv.date;
          const period = invoicePeriod(invPeriod, freq);
          periodBuckets.set(period, (periodBuckets.get(period) ?? 0) + inv.amount);
        }

        for (const [period, periodTotal] of periodBuckets) {
          if (periodTotal > contract.basePrice) {
            const deviation = ((periodTotal - contract.basePrice) / contract.basePrice * 100).toFixed(0);
            comparisons.push({
              label: `${invs[0]!.vendorId} (${period})`,
              expected: `~${contract.basePrice}/${periodLabel} per contract`,
              actual: `${periodTotal} billed`,
              delta: `Overbilled by ${deviation}% vs contracted rate`,
            });
          }
        }

        if (contract.escalationClause !== undefined) {
          const maxAllowed = contract.basePrice * (1 + contract.escalationClause);
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
        const totalBilled = invs.reduce((s, i) => s + i.amount, 0);
        const avgInvoice = totalBilled / invs.length;
        comparisons.push({
          label: invs[0]!.vendorId,
          expected: "contracted rate on file",
          actual: `${invs.length} invoice(s), avg ${avgInvoice.toFixed(0)}`,
          delta: "No contract terms available for comparison",
        });
      }
    }

    (ctx.state as any)._freshComparisons = comparisons.length;
    return comparisons;
  },

  async score(ctx) {
    const freshCount = (ctx.state as any)._freshComparisons ?? 0;
    const overbilledCount = ctx.state.comparisons.filter((c) => c.delta?.includes("Overbilled")).length;
    const escalationCount = ctx.state.comparisons.filter((c) => c.delta?.includes("escalation")).length;

    let score = 0.5;
    const reasons: string[] = [];

    if (overbilledCount > 0) { score += 0.25; reasons.push(`${overbilledCount} overbilling signal(s)`); }
    if (escalationCount > 0) { score += 0.2; reasons.push(`${escalationCount} escalation breach(es)`); }
    const noContractCount = freshCount - overbilledCount - escalationCount;
    if (noContractCount > 0) { score += 0.05; reasons.push(`${noContractCount} vendor(s) without contract`); }
    if (freshCount === 0) { score = 0; reasons.push("no vendors flagged"); }

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
