import { registerAgent } from "./supervisor";
import type { Comparison } from "../model/types";
import { getFinancialRecordsByType, getHistoryDays } from "../db/queries";

function zScore(value: number, mean: number, stddev: number): number {
  if (stddev === 0) return 0;
  return (value - mean) / stddev;
}

function isMonthComplete(month: string, payments: { date: string }[]): boolean {
  const days = new Set(payments.filter((p) => p.date.startsWith(month)).map((p) => p.date.slice(8, 10)));
  return days.size >= 20;
}

registerAgent("anomaly-detection", {
  async classify(ctx) {
    ctx.emit({ type: "step", agent: "anomaly-detection", message: "Analyzing spend patterns for anomalies..." });
  },

  async retrieve(ctx) {
    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);
    const historyDays = getHistoryDays();

    ctx.state.evidence = [
      { key: "payment_count", value: String(payments.length), sourceDocId: "db" },
      { key: "history_days", value: `${Math.round(historyDays)} days`, sourceDocId: "db" },
    ];

    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const comparisons: Comparison[] = [];
    const historyDays = getHistoryDays();
    if (historyDays < 60) {
      ctx.emit({ type: "agent_skipped", agent: "anomaly-detection", reason: `Insufficient history: ${Math.round(historyDays)} days (need 60+)` });
      return [];
    }

    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);

    const byMonth = new Map<string, number[]>();
    for (const p of payments) {
      const month = p.date.slice(0, 7);
      const amounts = byMonth.get(month) ?? [];
      amounts.push(p.amount);
      byMonth.set(month, amounts);
    }

    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (months.length < 3) return [];

    const monthlyTotals = months.map(([m, vals]) => ({ month: m, total: vals.reduce((s, v) => s + v, 0), count: vals.length }));

    const completeMonths = monthlyTotals.filter((m) => isMonthComplete(m.month, payments));
    if (completeMonths.length < 2) return [];

    const currentMonth = completeMonths[completeMonths.length - 1]!;
    const priorMonths = completeMonths.slice(0, -1);

    const mean = priorMonths.reduce((s, m) => s + m.total, 0) / priorMonths.length;
    const variance = priorMonths.reduce((s, m) => s + (m.total - mean) ** 2, 0) / priorMonths.length;
    const stddev = Math.sqrt(variance);

    const z = zScore(currentMonth.total, mean, stddev);

    if (Math.abs(z) > 2) {
      const direction = z > 0 ? "spike" : "drop";
      comparisons.push({
        label: `Monthly spend (${currentMonth.month})`,
        expected: `${mean.toFixed(0)} avg (${priorMonths.length} months)`,
        actual: `${currentMonth.total} (${currentMonth.count} transactions)`,
        delta: `${direction} — z-score ${z.toFixed(2)} (threshold: ±2.0)`,
      });
    }

    const vendorByMonth = new Map<string, Map<string, number>>();
    for (const p of payments) {
      const month = p.date.slice(0, 7);
      const vendorMonth = vendorByMonth.get(p.vendorId) ?? new Map();
      vendorMonth.set(month, (vendorMonth.get(month) ?? 0) + p.amount);
      vendorByMonth.set(p.vendorId, vendorMonth);
    }

    const currentMonthStr = currentMonth.month;
    for (const [vendorId, monthMap] of vendorByMonth) {
      const vendorMonths = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      if (vendorMonths.length < 2) continue;

      const priorVendorMonths = vendorMonths.filter(([m]) => m !== currentMonthStr && isMonthComplete(m, payments));
      const currentVendorAmount = monthMap.get(currentMonthStr);
      if (!currentVendorAmount || priorVendorMonths.length === 0) continue;

      const priorAvg = priorVendorMonths.reduce((s, [, v]) => s + v, 0) / priorVendorMonths.length;
      if (priorAvg === 0) continue;

      const vendorZ = zScore(currentVendorAmount, priorAvg, Math.sqrt(priorVendorMonths.reduce((s, [, v]) => s + (v - priorAvg) ** 2, 0) / priorVendorMonths.length));

      if (vendorZ > 2) {
        comparisons.push({
          label: `${vendorId} (${currentMonthStr})`,
          expected: `${priorAvg.toFixed(0)} avg prior months`,
          actual: `${currentVendorAmount} this month`,
          delta: `Vendor-level anomaly — z-score ${vendorZ.toFixed(2)}`,
        });
      }
    }

    (ctx.state as any)._freshComparisons = comparisons.length;
    return comparisons;
  },

  async score(ctx) {
    const freshCount = (ctx.state as any)._freshComparisons ?? 0;

    let score = 0.5;
    const reasons: string[] = [];

    if (freshCount > 0) {
      score += Math.min(freshCount * 0.15, 0.35);
      reasons.push(`${freshCount} anomaly signal(s)`);
    }
    if (freshCount === 0) {
      score = 0.3;
      reasons.push("no anomalies detected");
    }

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
