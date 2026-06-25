import type { AgentContext } from "../state-machine";

export async function scoreConfidence(ctx: AgentContext): Promise<{ score: number; reason: string }> {
  const { evidence } = ctx.state;

  let score = 0.5;
  const reasons: string[] = [];

  if (evidence.length > 1) {
    score += 0.1;
    reasons.push(`${evidence.length} evidence items collected`);
  }

  const hasComparisons = ctx.state.comparisons.length > 0;
  if (hasComparisons) {
    score += 0.15;
    reasons.push(`${ctx.state.comparisons.length} comparison(s) available`);
  }

  score = Math.min(score, 0.95);

  return {
    score: Math.round(score * 100) / 100,
    reason: reasons.join("; ") || "Default confidence floor",
  };
}
