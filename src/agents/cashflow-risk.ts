import { registerAgent } from "./supervisor";
import type { Comparison } from "../model/types";
import { getFinancialRecordsByType, getHistoryDays } from "../db/queries";

registerAgent("cashflow-risk", {
  async classify(ctx) {
    ctx.emit({ type: "step", agent: "cashflow-risk", message: "Projecting cash flow and runway..." });
  },

  async retrieve(ctx) {
    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);
    const commitments = getFinancialRecordsByType("commitment");
    const historyDays = getHistoryDays();

    ctx.state.evidence = [
      { key: "payment_count", value: String(payments.length), sourceDocId: "db" },
      { key: "commitment_count", value: String(commitments.length), sourceDocId: "db" },
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
      ctx.emit({ type: "agent_skipped", agent: "cashflow-risk", reason: `Insufficient history: ${Math.round(historyDays)} days (need 60+)` });
      return [];
    }

    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);
    const commitments = getFinancialRecordsByType("commitment");

    const byMonth = new Map<string, number[]>();
    for (const p of payments) {
      const month = p.date.slice(0, 7);
      const amounts = byMonth.get(month) ?? [];
      amounts.push(p.amount);
      byMonth.set(month, amounts);
    }

    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (months.length < 2) return [];

    const monthlyTotals = months.map(([m, vals]) => ({ month: m, total: vals.reduce((s, v) => s + v, 0) }));

    const avgMonthlyBurn = monthlyTotals.reduce((s, m) => s + m.total, 0) / monthlyTotals.length;

    const totalCommitted = commitments.reduce((s, c) => s + c.amount, 0);

    const currentMonth = monthlyTotals[monthlyTotals.length - 1]!;
    const priorMonth = monthlyTotals.length >= 2 ? monthlyTotals[monthlyTotals.length - 2]!.total : 0;
    const monthOverMonth = priorMonth > 0 ? ((currentMonth.total - priorMonth) / priorMonth * 100).toFixed(1) : "n/a";

    comparisons.push({
      label: "Monthly burn rate",
      expected: `${avgMonthlyBurn.toFixed(0)} avg across ${monthlyTotals.length} months`,
      actual: `${currentMonth.total} this month`,
      delta: `MoM: ${monthOverMonth}%${Number(monthOverMonth) > 10 ? " (accelerating)" : ""}`,
    });

    if (totalCommitted > 0) {
      const coverageMonths = avgMonthlyBurn > 0 ? totalCommitted / avgMonthlyBurn : 0;
      const runwayStatus = coverageMonths >= 8 ? "healthy" : coverageMonths >= 4 ? "adequate" : "critical";
      comparisons.push({
        label: "Runway against commitments",
        expected: `8+ months target`,
        actual: `${totalCommitted.toFixed(0)} committed, ${coverageMonths.toFixed(1)}mo coverage`,
        delta: `Runway: ${runwayStatus} (${coverageMonths.toFixed(1)} months at avg burn)`,
      });
    }

    const largestVendors = [...new Map(payments.map((p) => [p.vendorId, (payments.filter((pp) => pp.vendorId === p.vendorId).reduce((s, pp) => s + pp.amount, 0))])).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [vendorId, total] of largestVendors) {
      const pctOfBurn = avgMonthlyBurn > 0 ? (total / monthlyTotals.length / avgMonthlyBurn * 100).toFixed(0) : "0";
      if (Number(pctOfBurn) > 20) {
        comparisons.push({
          label: vendorId,
          expected: `concentration < 20% of monthly burn`,
          actual: `~${pctOfBurn}% of avg monthly spend`,
          delta: `High vendor concentration — dependency risk`,
        });
      }
    }

    return comparisons;
  },

  async score(ctx) {
    const cmpCount = ctx.state.comparisons.length;
    const criticalRunway = ctx.state.comparisons.filter((c) => c.delta?.includes("critical")).length;
    const highConcentration = ctx.state.comparisons.filter((c) => c.delta?.includes("concentration")).length;

    let score = 0.5;
    const reasons: string[] = [];

    if (criticalRunway > 0) { score += 0.3; reasons.push("critical runway"); }
    if (highConcentration > 0) { score += Math.min(highConcentration * 0.05, 0.1); reasons.push(`${highConcentration} concentration risk(s)`); }
    if (cmpCount > 0) { score += 0.1; reasons.push(`${cmpCount} cash flow signal(s)`); }
    if (cmpCount === 0) { score = 0; reasons.push("no cash flow signals"); }

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
