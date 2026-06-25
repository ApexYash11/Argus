export interface RiskScore {
  score: number;
  financialImpact: number;
  recurrenceProbability: number;
  detectionDifficulty: number;
}

export function calculateRiskScore(
  impactAmount: number,
  confidence: number,
  isRecurring: boolean,
  isHidden: boolean
): RiskScore {
  const financialImpact = Math.min(impactAmount / 100000, 1);
  const recurrenceProbability = isRecurring ? 0.8 : 0.2;
  const detectionDifficulty = isHidden ? 0.9 : 0.3;

  const score =
    financialImpact * 0.4 +
    confidence * 0.3 +
    recurrenceProbability * 0.2 +
    detectionDifficulty * 0.1;

  return {
    score: Math.min(score, 1),
    financialImpact,
    recurrenceProbability,
    detectionDifficulty,
  };
}
