import "./saas-waste";
import "./duplicate-payments";
import "./policy-violations";
import "./reconciliation";

import { registerAgent } from "./supervisor";
import type { Comparison, FinancialRecord } from "../model/types";
import { getAllFinancialRecords } from "../db/queries";

function registerBaseAgent(agentType: string, analyze: (records: FinancialRecord[]) => Comparison[]): void {
  registerAgent(agentType as any, {
    async classify(ctx) {
      ctx.emit({ type: "step", agent: agentType, message: `Analyzing ${agentType.replace(/-/g, " ")}...` });
    },
    async retrieve(ctx) {
      const records = getAllFinancialRecords();
      ctx.state.evidence = [{
        key: "total_records",
        value: String(records.length),
        sourceDocId: "db",
      }];
      (ctx.state as any)._cachedRecords = records;
    },
    async compare(ctx) {
      const records = (ctx.state as any)._cachedRecords ?? getAllFinancialRecords();
      return analyze(records);
    },
    async score(ctx) {
      const cmpCount = ctx.state.comparisons.length;
      const score = 0.5 + Math.min(cmpCount * 0.15, 0.4);
      return {
        score: Math.round(score * 100) / 100,
        reason: `${cmpCount} comparison(s) analyzed`,
      };
    },
  });
}

registerBaseAgent("vendor-overbilling", (records) => {
  const invoices = records.filter((r) => r.type === "invoice");
  const byVendor = new Map<string, FinancialRecord[]>();
  for (const inv of invoices) {
    const existing = byVendor.get(inv.vendorId) ?? [];
    existing.push(inv);
    byVendor.set(inv.vendorId, existing);
  }
  const result: Comparison[] = [];
  for (const [vendorId, invs] of byVendor) {
    if (invs.length > 1) {
      const totals = invs.reduce((s, i) => s + i.amount, 0);
      result.push({
        label: vendorId,
        expected: `${invs.length} invoice(s)`,
        actual: `${totals} total billed`,
      });
    }
  }
  return result;
});

registerBaseAgent("anomaly-detection", (records) => {
  const payments = records.filter((r) => r.type === "payment");
  const byMonth = new Map<string, number>();
  for (const p of payments) {
    const month = p.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + p.amount);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (months.length < 2) return [];
  const priorMonths = months.slice(0, -1);
  const priorSum = priorMonths.reduce((s, [, v]) => s + v, 0);
  if (priorSum === 0) return [];
  const avg = priorSum / priorMonths.length;
  const last = months[months.length - 1]![1];
  const pct = avg !== 0 ? ((last - avg) / avg * 100).toFixed(0) : "n/a";
  return [{
    label: "Monthly spend trend",
    expected: `${avg.toFixed(0)} avg (${priorMonths.length} months)`,
    actual: `${last} current month`,
    delta: last > avg ? `+${pct}% above avg` : `${Math.abs(Number(pct))}% below avg`,
  }];
});

registerBaseAgent("cashflow-risk", (records) => {
  const commitments = records.filter((r) => r.type === "commitment");
  const totalCommitted = commitments.reduce((s, c) => s + c.amount, 0);
  const payments = records.filter((r) => r.type === "payment");
  const monthlyBurn = payments.length > 0 ? payments.reduce((s, p) => s + p.amount, 0) / Math.max(payments.length, 1) * 30 : 0;
  return [{
    label: "Cash flow projection",
    expected: `${totalCommitted} committed`,
    actual: `${monthlyBurn.toFixed(0)} est. monthly burn`,
    delta: totalCommitted > 0 ? `${(monthlyBurn > 0 ? totalCommitted / monthlyBurn : 0).toFixed(1)} months coverage` : "no commitments",
  }];
});
