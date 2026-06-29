import type { AgentContext } from "../state-machine";
import type { FinancialRecord } from "../../model/types";

export function extractQualityFlags(records: FinancialRecord[]): string[] {
  return records.flatMap((r) => {
    try {
      return JSON.parse(r.raw)?._quality ?? [];
    } catch {
      return [];
    }
  });
}

const PENALTY_MAP: Record<string, number> = {
  date_defaulted: 0.08,
  vendor_fuzzy_matched: 0.05,
  vendor_new_unverified: 0.10,
  amount_zero: 0.15,
  vendor_unknown: 0.12,
  amount_negated: 0.03,
  currency_assumed: 0.03,
  schema_low_confidence: 0.10,
  debit_credit_split: 0.02,
  future_dated: 0.02,
  outlier_amount: 0.02,
  vendor_inferred: 0.05,
  date_format_assumed_ddmm: 0.02,
  amount_locale_assumed: 0.02,
  amount_guessed_locale: 0.02,
};

export function computeQualityPenalty(qualityFlags: string[]): number {
  const seen = new Set(qualityFlags);
  let penalty = 0;
  for (const [flag, value] of Object.entries(PENALTY_MAP)) {
    if (seen.has(flag)) penalty += value;
  }
  return penalty;
}

export async function scoreConfidence(ctx: AgentContext): Promise<{ score: number; reason: string }> {
  const { evidence, comparisons } = ctx.state;

  let score = 0.5;
  const reasons: string[] = [];

  const meaningfulEvidence = evidence.filter((e) => e.key !== "total_records" && e.key !== "total_vendors");
  if (meaningfulEvidence.length >= 2) {
    score += 0.1;
    reasons.push(`${meaningfulEvidence.length} meaningful evidence item(s)`);
  }

  if (comparisons.length > 0) {
    score += Math.min(comparisons.length * 0.1, 0.25);
    reasons.push(`${comparisons.length} comparison(s) available`);
  } else {
    score -= 0.1;
    reasons.push("no comparisons generated");
  }

  score = Math.max(0, Math.min(score, 0.95));

  return {
    score: Math.round(score * 100) / 100,
    reason: reasons.join("; ") || "Default confidence floor",
  };
}
