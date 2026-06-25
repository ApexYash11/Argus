import { registerAgent } from "./supervisor";
import type { FinancialRecord, Comparison } from "../model/types";
import { getFinancialRecordsByType } from "../db/queries";

function daysSince(dateStr: string, referenceDate: string): number {
  const d = new Date(dateStr);
  const ref = new Date(referenceDate);
  return (ref.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function getAgingBucket(days: number): string {
  if (days <= 7) return "normal";
  if (days <= 30) return "warning";
  return "critical";
}

registerAgent("reconciliation", {
  async classify(ctx) {
    ctx.emit({ type: "step", agent: "reconciliation", message: "Matching invoices to payments..." });
  },

  async retrieve(ctx) {
    const invoices = getFinancialRecordsByType("invoice");
    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);

    ctx.state.evidence = [
      { key: "invoice_count", value: String(invoices.length), sourceDocId: "db" },
      { key: "payment_count", value: String(payments.length), sourceDocId: "db" },
    ];

    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const comparisons: Comparison[] = [];
    const invoices = getFinancialRecordsByType("invoice");
    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);

    const dates = [...invoices.map((i) => i.date), ...payments.map((p) => p.date)].filter(Boolean);
    const referenceDate = dates.length > 0 ? dates[dates.length - 1]! : new Date().toISOString().slice(0, 10);

    const paymentsByVendor = new Map<string, FinancialRecord[]>();
    for (const p of payments) {
      const list = paymentsByVendor.get(p.vendorId) ?? [];
      list.push(p);
      paymentsByVendor.set(p.vendorId, list);
    }

    const invoicesByVendor = new Map<string, FinancialRecord[]>();
    for (const inv of invoices) {
      const list = invoicesByVendor.get(inv.vendorId) ?? [];
      list.push(inv);
      invoicesByVendor.set(inv.vendorId, list);
    }

    const allVendorIds = new Set([...invoicesByVendor.keys(), ...paymentsByVendor.keys()]);

    for (const vendorId of allVendorIds) {
      const vendorInvoices = invoicesByVendor.get(vendorId) ?? [];
      const vendorPayments = paymentsByVendor.get(vendorId) ?? [];

      const invTotal = vendorInvoices.reduce((s, i) => s + i.amount, 0);
      const payTotal = vendorPayments.reduce((s, p) => s + p.amount, 0);

      if (invTotal === 0 && payTotal === 0) continue;

      if (vendorInvoices.length > 0 && vendorPayments.length === 0) {
        const sorted = [...vendorInvoices].sort((a, b) => b.date.localeCompare(a.date));
        const mostRecent = sorted[0]!;
        const aging = daysSince(mostRecent.date, referenceDate);
        const bucket = getAgingBucket(aging);
        comparisons.push({
          label: vendorId,
          expected: `${vendorInvoices.length} invoice(s) totaling ${invTotal}`,
          actual: "0 payments received",
          delta: `Unpaid invoice — ${Math.round(aging)} days outstanding (${bucket})`,
        });
      }

      if (vendorPayments.length > 0 && vendorInvoices.length === 0) {
        comparisons.push({
          label: vendorId,
          expected: "matched invoice",
          actual: `${vendorPayments.length} payment(s) totaling ${payTotal}`,
          delta: "Orphan payment — no matching invoice found",
        });
      }

      if (vendorInvoices.length > 0 && vendorPayments.length > 0) {
        const gap = Math.abs(invTotal - payTotal);
        const gapPct = invTotal > 0 ? (gap / invTotal) * 100 : 0;

        const unpaidInvoices = vendorInvoices.filter((inv) => {
          return !vendorPayments.some((p) =>
            Math.abs(p.amount - inv.amount) < 1 &&
            Math.abs(daysSince(p.date, inv.date)) <= 45
          );
        });

        for (const inv of unpaidInvoices) {
          const aging = daysSince(inv.date, referenceDate);
          const bucket = getAgingBucket(aging);
          comparisons.push({
            label: `${vendorId} — ${inv.amount}`,
            expected: `matched payment for ${inv.amount}`,
            actual: `unmatched invoice (${Math.round(aging)} days old)`,
            delta: `Aging bucket: ${bucket}`,
          });
        }

        if (gap > 0.01 && unpaidInvoices.length === 0) {
          comparisons.push({
            label: `${vendorId} — total gap`,
            expected: `${vendorInvoices.length} invoice(s): ${invTotal}`,
            actual: `${vendorPayments.length} payment(s): ${payTotal}`,
            delta: `Gap: ${gapPct.toFixed(1)}% (${gap.toFixed(0)} ${vendorInvoices[0]?.currency ?? "INR"})`,
          });
        }
      }
    }

    return comparisons;
  },

  async score(ctx) {
    const cmpCount = ctx.state.comparisons.length;
    const criticalCount = ctx.state.comparisons.filter((c) => c.delta?.includes("critical")).length;
    const warningCount = ctx.state.comparisons.filter((c) => c.delta?.includes("warning")).length;

    let score = 0.5;
    const reasons: string[] = [];

    if (criticalCount > 0) { score += 0.25; reasons.push(`${criticalCount} critical aging item(s)`); }
    if (warningCount > 0) { score += 0.1; reasons.push(`${warningCount} warning aging item(s)`); }
    if (cmpCount > 0 && criticalCount === 0 && warningCount === 0) { score += 0.1; reasons.push(`${cmpCount} reconciliation gap(s)`); }
    if (cmpCount === 0) { score = 0; reasons.push("fully reconciled"); }

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
