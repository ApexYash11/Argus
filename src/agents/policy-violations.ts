import { registerAgent } from "./supervisor";
import type { Comparison, FinancialRecord } from "../model/types";
import { getFinancialRecordsByType, getDominantCurrency } from "../db/queries";
import type { AppConfig } from "../model/types";
import { extractQualityFlags, computeQualityPenalty } from "./nodes/score-confidence";

function defaultPerDiemLimits(currency: string): Record<string, number> {
  if (currency === "USD") {
    return { meals: 36, travel: 120, "client-entertainment": 240, "office-supplies": 24 };
  }
  if (currency === "EUR") {
    return { meals: 30, travel: 100, "client-entertainment": 200, "office-supplies": 20 };
  }
  if (currency === "GBP") {
    return { meals: 25, travel: 85, "client-entertainment": 170, "office-supplies": 17 };
  }
  return { meals: 3000, travel: 10000, "client-entertainment": 20000, "office-supplies": 2000 };
}

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
    const expenses = getFinancialRecordsByType("expense");
    if (expenses.length === 0) {
      ctx.emit({ type: "agent_skipped", agent: "policy-violations", reason: "No expenses to check" });
      ctx.state._skip = true;
      return;
    }
    ctx.emit({ type: "step", agent: "policy-violations", message: `Found ${expenses.length} expenses to audit against policy` });
  },

  async retrieve(ctx) {
    if (!ctx.state._cache) {
      ctx.state._cache = { expenses: getFinancialRecordsByType("expense") };
    }
    const expenses = (ctx.state._cache as unknown as { expenses: FinancialRecord[] }).expenses;

    ctx.state.evidence = [
      { key: "expense_count", value: String(expenses.length), sourceDocId: "db" },
    ];

    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const comparisons: Comparison[] = [];
    const expenses = ((ctx.state._cache as unknown as { expenses: FinancialRecord[] })?.expenses ?? getFinancialRecordsByType("expense")) as FinancialRecord[];

    const config = (ctx as any).config as AppConfig | undefined;
    const policy = config?.policy;

    const companyCurrency = getDominantCurrency();
    const perDiemLimits = { ...defaultPerDiemLimits(companyCurrency), ...(policy?.perDiemLimits ?? {}) };
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

    const allCached = Object.values(ctx.state._cache ?? {}).flat() as any[];
    const qualityFlags = extractQualityFlags(allCached);
    const penalty = computeQualityPenalty(qualityFlags);
    score = Math.max(0, score - penalty);

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
