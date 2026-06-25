import type { InvestigationState, AuditEvent, AgentType, FinancialEvent, Comparison, AppConfig } from "../model/types";
import { classifyEvent } from "./nodes/classify";
import { retrieveEvidence } from "./nodes/retrieve-evidence";
import { runComparison } from "./nodes/run-comparison";
import { scoreConfidence } from "./nodes/score-confidence";
import { generateFinding } from "./nodes/generate-finding";
import { getCalibration } from "../db/queries";

export const MAX_ITERATIONS = 5;
export const CONFIDENCE_FLOOR = 0.7;

export interface AgentContext {
  agentType: AgentType;
  state: InvestigationState;
  emit: (event: AuditEvent) => void;
  config?: { maxIterations?: number; confidenceFloor?: number };
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
  const vendorId = trigger.vendorId;
  const cal = vendorId ? getCalibration(agentType, vendorId) : null;
  const floor = cal?.thresholdOverride ?? config?.confidenceFloor ?? CONFIDENCE_FLOOR;

  const state: InvestigationState = {
    trigger,
    agentType,
    evidence: [],
    comparisons: [],
    confidence: 0,
    iterations: 0,
    events: [],
    effectiveFloor: floor,
  };

  function recordEvent(event: AuditEvent): void {
    const stamped = { ...event, timestamp: new Date().toISOString() };
    state.events.push(stamped);
    if (event.type !== "done") emit(stamped);
  }

  const ctx: AgentContext = { agentType, state, emit: recordEvent, config };

  if (cal && cal.thresholdOverride) {
    recordEvent({ type: "step", agent: agentType, message: `Calibration loaded — threshold ${(cal.thresholdOverride * 100).toFixed(0)}% (${cal.dismissCount} dismissals)` });
  }

  recordEvent({ type: "agent_start", agent: agentType, description: `Starting ${agentType} investigation` });

  try {
    await agentDef.classify(ctx);
  } catch (err: any) {
    recordEvent({ type: "step", agent: agentType, message: `Classify error: ${err.message}` });
    state.events.push({ type: "done", totalFindings: 0, durationMs: 0, timestamp: new Date().toISOString() });
    return state;
  }
  state.iterations++;

  while (state.iterations <= maxIters) {
    try { await agentDef.retrieve(ctx); } catch (err: any) {
      recordEvent({ type: "step", agent: agentType, message: `Retrieve error: ${err.message}` });
      break;
    }
    try {
      const comparisons = await agentDef.compare(ctx);
      state.comparisons.push(...comparisons);
    } catch (err: any) {
      recordEvent({ type: "step", agent: agentType, message: `Compare error: ${err.message}` });
      break;
    }
    let score = 0;
    let reason = "";
    try {
      const result = await agentDef.score(ctx);
      score = result.score;
      reason = result.reason;
    } catch (err: any) {
      recordEvent({ type: "step", agent: agentType, message: `Score error: ${err.message}` });
      break;
    }
    state.confidence = score;

    recordEvent({ type: "confidence", score, reason });

    if (score >= floor) {
      try { await generateFinding(ctx); } catch (err: any) {
        recordEvent({ type: "step", agent: agentType, message: `Generate finding error: ${err.message}` });
      }
      break;
    }

    if (state.iterations >= maxIters) break;
    state.iterations++;
    recordEvent({ type: "step", agent: agentType, message: `Confidence ${(score * 100).toFixed(0)}% < ${(floor * 100).toFixed(0)}% floor, re-investigating (pass ${state.iterations})` });
  }

  state.events.push({ type: "done", totalFindings: state.finding ? 1 : 0, durationMs: 0, timestamp: new Date().toISOString() });
  return state;
}
