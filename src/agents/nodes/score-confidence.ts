import type { AgentContext } from "../state-machine";

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
