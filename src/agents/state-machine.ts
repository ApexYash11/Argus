import type { InvestigationState, AuditEvent, AgentType, FinancialEvent, Comparison } from "../model/types";
import { classifyEvent } from "./nodes/classify";
import { retrieveEvidence } from "./nodes/retrieve-evidence";
import { runComparison } from "./nodes/run-comparison";
import { scoreConfidence } from "./nodes/score-confidence";
import { generateFinding } from "./nodes/generate-finding";

export const MAX_ITERATIONS = 5;
export const CONFIDENCE_FLOOR = 0.7;

export interface AgentContext {
  agentType: AgentType;
  state: InvestigationState;
  emit: (event: AuditEvent) => void;
  agents: Record<AgentType, AgentDefinition>;
}

export interface AgentDefinition {
  classify(ctx: AgentContext): Promise<void>;
  retrieve(ctx: AgentContext): Promise<void>;
  compare(ctx: AgentContext): Promise<Comparison[]>;
  score(ctx: AgentContext): Promise<{ score: number; reason: string }>;
}

export async function runInvestigation(
  trigger: FinancialEvent,
  agentType: AgentType,
  agentDef: AgentDefinition,
  emit: (event: AuditEvent) => void,
  config?: { maxIterations?: number; confidenceFloor?: number }
): Promise<InvestigationState> {
  const maxIters = config?.maxIterations ?? MAX_ITERATIONS;
  const floor = config?.confidenceFloor ?? CONFIDENCE_FLOOR;

  const state: InvestigationState = {
    trigger,
    agentType,
    evidence: [],
    comparisons: [],
    confidence: 0,
    iterations: 0,
    events: [],
  };

  const ctx: AgentContext = { agentType, state, emit, agents: {} as any };

  function recordEvent(event: AuditEvent): void {
    state.events.push(event);
    emit(event);
  }

  recordEvent({ type: "agent_start", agent: agentType, description: `Starting ${agentType} investigation` });

  await agentDef.classify(ctx);
  state.iterations++;

  while (state.iterations <= maxIters) {
    await agentDef.retrieve(ctx);
    const comparisons = await agentDef.compare(ctx);
    state.comparisons.push(...comparisons);
    const { score, reason } = await agentDef.score(ctx);
    state.confidence = score;

    recordEvent({ type: "confidence", score, reason });

    if (score >= floor) {
      await generateFinding(ctx);
      break;
    }

    if (state.iterations >= maxIters) break;
    state.iterations++;
    recordEvent({ type: "step", agent: agentType, message: `Confidence ${(score * 100).toFixed(0)}% < ${(floor * 100).toFixed(0)}% floor, re-investigating (pass ${state.iterations})` });
  }

  emit({ type: "done", totalFindings: state.finding ? 1 : 0, durationMs: 0 });
  recordEvent({ type: "done", totalFindings: state.finding ? 1 : 0, durationMs: 0 });
  return state;
}
