import { registerAgent } from "./supervisor";
import type { Comparison } from "../model/types";
import { getFinancialRecordsByType } from "../db/queries";
import type { AppConfig } from "../model/types";

const DEFAULT_PER_DIEM_LIMITS: Record<string, number> = {
  meals: 3000,
  travel: 10000,
  "client-entertainment": 20000,
  "office-supplies": 2000,
};

const DEFAULT_PROHIBITED_CATEGORIES = ["alcohol", "gambling", "personal"];

const DEFAULT_MAX_WITHOUT_RECEIPT = 1000;

function parseExpenseFields(description: string): { category: string; employee: string } {
  const parts = description.split(" — ");
  const category = parts[0] ?? "unknown";
  const employee = parts[1] ?? "unknown";
  return { category, employee };
}

registerAgent("policy-violations", {
  async classify(ctx) {
    ctx.emit({ type: "step", agent: "policy-violations", message: "Checking expense policy compliance..." });
  },

  async retrieve(ctx) {
    const expenses = getFinancialRecordsByType("expense");
    const rawRecords = expenses.map((e) => {
      try { return JSON.parse(e.raw); } catch { return null; }
    }).filter(Boolean) as Record<string, unknown>[];

    ctx.state.evidence = [
      { key: "expense_count", value: String(expenses.length), sourceDocId: "db" },
    ];

    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const comparisons: Comparison[] = [];
    const expenses = getFinancialRecordsByType("expense");

    const config = (ctx as any).config as AppConfig | undefined;
    const policy = config?.policy;

    const perDiemLimits = { ...DEFAULT_PER_DIEM_LIMITS, ...(policy?.perDiemLimits ?? {}) };
    const prohibitedCategories = policy?.prohibitedCategories ?? DEFAULT_PROHIBITED_CATEGORIES;
    const maxWithoutReceipt = policy?.maxExpenseWithoutReceipt ?? DEFAULT_MAX_WITHOUT_RECEIPT;
    const preApprovalThreshold = policy?.preApprovalThreshold ?? 20000;

    for (const exp of expenses) {
      const { category, employee } = parseExpenseFields(exp.description ?? "");

      let rawRecord: Record<string, unknown> = {};
      try { rawRecord = JSON.parse(exp.raw); } catch { rawRecord = {}; }
      const hasReceipt = rawRecord.has_receipt === true || rawRecord.has_receipt === "true" || rawRecord.has_receipt === "yes";

      if (prohibitedCategories.includes(category)) {
        comparisons.push({
          label: `${employee} — ${category}`,
          expected: "prohibited category not allowed",
          actual: `${exp.amount} ${exp.currency} spent on ${category}`,
          delta: "Policy violation: prohibited category",
        });
        continue;
      }

      const limit = perDiemLimits[category];
      if (limit && exp.amount > limit) {
        comparisons.push({
          label: `${employee} — ${category}`,
          expected: `max ${limit} ${exp.currency} per diem`,
          actual: `${exp.amount} ${exp.currency} spent`,
          delta: `Exceeds per-diem limit by ${(exp.amount - limit).toFixed(0)}`,
        });
      }

      if (!hasReceipt && exp.amount > maxWithoutReceipt) {
        comparisons.push({
          label: `${employee} — ${category}`,
          expected: `receipt required over ${maxWithoutReceipt}`,
          actual: `${exp.amount} without receipt`,
          delta: "Missing receipt",
        });
      }

      if (exp.amount >= preApprovalThreshold) {
        comparisons.push({
          label: `${employee} — ${category}`,
          expected: `pre-approval required over ${preApprovalThreshold}`,
          actual: `${exp.amount} exceeds threshold`,
          delta: "Pre-approval may be required",
        });
      }
    }

    return comparisons;
  },

  async score(ctx) {
    const cmpCount = ctx.state.comparisons.length;
    const prohibitedCount = ctx.state.comparisons.filter((c) => c.delta === "Policy violation: prohibited category").length;
    const receiptMissingCount = ctx.state.comparisons.filter((c) => c.delta === "Missing receipt").length;

    let score = 0.5;
    const reasons: string[] = [];

    if (prohibitedCount > 0) { score += 0.3; reasons.push(`${prohibitedCount} prohibited category violation(s)`); }
    if (receiptMissingCount > 0) { score += 0.15; reasons.push(`${receiptMissingCount} missing receipt(s)`); }
    const overLimitCount = cmpCount - prohibitedCount - receiptMissingCount;
    if (overLimitCount > 0) { score += Math.min(overLimitCount * 0.05, 0.1); reasons.push(`${overLimitCount} over-limit item(s)`); }
    if (cmpCount === 0) { score = 0; reasons.push("no violations found"); }

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
