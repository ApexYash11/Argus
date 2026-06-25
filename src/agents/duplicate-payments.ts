import { registerAgent } from "./supervisor";
import type { FinancialRecord, Comparison } from "../model/types";
import { getFinancialRecordsByType } from "../db/queries";

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a).getTime();
  const d2 = new Date(b).getTime();
  return Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);
}

function referenceSimilarity(refA: string | undefined, refB: string | undefined): number {
  if (!refA || !refB) return 0;
  const partsA = refA.split("-");
  const partsB = refB.split("-");
  if (partsA.length < 2 || partsB.length < 2) return refA === refB ? 1 : 0;
  return partsA.slice(0, -1).join("-") === partsB.slice(0, -1).join("-") ? 0.8 : 0;
}

interface DuplicateCandidate {
  a: FinancialRecord;
  b: FinancialRecord;
  amountScore: number;
  dateScore: number;
  refScore: number;
  periodScore: number;
  statusScore: number;
}

registerAgent("duplicate-payments", {
  async classify(ctx) {
    ctx.emit({ type: "step", agent: "duplicate-payments", message: "Scanning for duplicate payments..." });
  },

  async retrieve(ctx) {
    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);

    ctx.state.evidence = [
      { key: "payment_count", value: String(payments.length), sourceDocId: "db" },
    ];

    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const comparisons: Comparison[] = [];
    const payments = getFinancialRecordsByType("payment").filter((r) => r.amount > 0);

    const byVendor = new Map<string, FinancialRecord[]>();
    for (const p of payments) {
      const list = byVendor.get(p.vendorId) ?? [];
      list.push(p);
      byVendor.set(p.vendorId, list);
    }

    for (const [, group] of byVendor) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;

          const amountScore = a.amount === b.amount ? 1 : (1 - Math.abs(a.amount - b.amount) / Math.max(a.amount, b.amount, 1));

          const gap = daysBetween(a.date, b.date);
          const dateScore = gap <= 3 ? 1 : gap <= 15 ? 0.7 : gap <= 45 ? 0.3 : 0;

          const refScore = referenceSimilarity(a.description, b.description);

          const periodScore = (a.periodStart === b.periodStart || a.periodEnd === b.periodEnd) ? 1 : 0.2;

          const statusScore = (a.status === "cleared" && b.status === "cleared") ? 1 : 0.75;

          const weightedScore =
            amountScore * 0.30 +
            dateScore * 0.20 +
            refScore * 0.25 +
            periodScore * 0.15 +
            statusScore * 0.10;

          if (weightedScore >= 0.6) {
            comparisons.push({
              label: `${a.vendorId} — ${a.amount} ${a.currency}`,
              expected: `1 payment on ${a.date}`,
              actual: `2 payments on ${a.date} and ${b.date}`,
              delta: `Duplicate score: ${(weightedScore * 100).toFixed(0)}%${refScore > 0 ? " (same reference pattern)" : ""}`,
            });
          }
        }
      }
    }

    comparisons.sort((a, b) => {
      const scoreA = parseFloat(a.delta?.match(/(\d+)/)?.[0] ?? "0");
      const scoreB = parseFloat(b.delta?.match(/(\d+)/)?.[0] ?? "0");
      return scoreB - scoreA;
    });

    return comparisons.slice(0, 20);
  },

  async score(ctx) {
    const cmpCount = ctx.state.comparisons.length;
    let score = 0.5;

    if (cmpCount >= 3) score += 0.3;
    else if (cmpCount >= 1) score += 0.2;

    const highScoreDups = ctx.state.comparisons.filter((c) => {
      const s = parseFloat(c.delta?.match(/(\d+)/)?.[0] ?? "0");
      return s >= 80;
    }).length;
    if (highScoreDups > 0) score += Math.min(highScoreDups * 0.05, 0.1);

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: cmpCount > 0
        ? `${cmpCount} potential duplicate(s), ${highScoreDups} high-confidence`
        : "No duplicates detected",
    };
  },
});
