import { registerAgent } from "./supervisor";
import type { Comparison, FinancialRecord } from "../model/types";
import type { AgentDefinition } from "./state-machine";
import { getFinancialRecordsByType, getFinancialRecordsByVendor, getAllFinancialRecords } from "../db/queries";

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
    },
    async compare(ctx) {
      const records = getAllFinancialRecords();
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

registerBaseAgent("saas-waste", (records) => {
  const subs = records.filter((r) => r.type === "subscription");
  return subs.map((s) => ({
    label: s.vendorId,
    expected: "active subscription",
    actual: `${s.amount} ${s.currency}/mo`,
  }));
});

registerBaseAgent("duplicate-payments", (records) => {
  const payments = records.filter((r) => r.type === "payment");
  const seen = new Map<string, FinancialRecord[]>();
  for (const p of payments) {
    const key = `${p.vendorId}|${p.amount}`;
    const existing = seen.get(key) ?? [];
    existing.push(p);
    seen.set(key, existing);
  }
  const dups: Comparison[] = [];
  for (const [key, group] of seen) {
    if (group.length > 1) {
      dups.push({
        label: `Duplicate: ${key}`,
        expected: "1 payment",
        actual: `${group.length} payments totalling ${group.reduce((s, p) => s + p.amount, 0)}`,
        delta: `${group.length - 1} extra payment(s)`,
      });
    }
  }
  return dups;
});

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

registerBaseAgent("policy-violations", (records) => {
  const expenses = records.filter((r) => r.type === "expense");
  return expenses.map((e) => ({
    label: e.vendorId,
    expected: "within policy",
    actual: `${e.amount} ${e.currency}`,
    delta: e.description,
  }));
});

registerBaseAgent("reconciliation", (records) => {
  const invoices = records.filter((r) => r.type === "invoice");
  const payments = records.filter((r) => r.type === "payment");
  const invTotal = invoices.reduce((s, i) => s + i.amount, 0);
  const payTotal = payments.reduce((s, p) => s + p.amount, 0);
  return [{
    label: "Invoices vs Payments",
    expected: `${invoices.length} invoices (${invTotal})`,
    actual: `${payments.length} payments (${payTotal})`,
    delta: `${((invTotal - payTotal) / (invTotal || 1) * 100).toFixed(1)}% gap`,
  }];
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
  const avg = months.slice(0, -1).reduce((s, [, v]) => s + v, 0) / (months.length - 1);
  const last = months[months.length - 1][1];
  return [{
    label: "Monthly spend trend",
    expected: `${avg.toFixed(0)} avg (${months.length - 1} months)`,
    actual: `${last} current month`,
    delta: last > avg ? `+${((last - avg) / avg * 100).toFixed(0)}% above avg` : `${((avg - last) / avg * 100).toFixed(0)}% below avg`,
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
