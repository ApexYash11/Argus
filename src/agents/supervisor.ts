import type { AuditEvent, AgentType, FinancialEvent } from "../model/types";
import { getActiveAgents } from "../engine/activation";
import { runInvestigation, type AgentDefinition } from "./state-machine";
import { initScratchpad, writeScratchpadEntry, pruneScratchpad } from "../engine/scratchpad";

const agentImpls: Partial<Record<AgentType, AgentDefinition>> = {};

export function registerAgent(agentType: AgentType, def: AgentDefinition): void {
  agentImpls[agentType] = def;
}

export async function runSupervisor(
  cwd: string,
  trigger: FinancialEvent,
  filterType?: AgentType,
  config?: { maxIterations?: number; confidenceFloor?: number }
): Promise<AsyncGenerator<AuditEvent>> {
  const agents: AgentType[] = filterType
    ? [filterType]
    : (Object.keys(agentImpls) as AgentType[]);

  async function* gen(): AsyncGenerator<AuditEvent> {
    const startTime = performance.now();
    initScratchpad(cwd);
    writeScratchpadEntry({ type: "supervisor_start", message: `Trigger: ${trigger.type}` });

    yield {
      type: "agent_start",
      agent: "supervisor",
      description: `Supervisor routing trigger: ${trigger.type}`,
    };

    let findingsCount = 0;
    for (const agentType of agents) {
      const def = agentImpls[agentType];
      if (!def) {
        yield { type: "step", agent: "supervisor", message: `No implementation for ${agentType}, skipping` };
        continue;
      }

      yield {
        type: "step",
        agent: "supervisor",
        message: `Dispatching ${agentType} agent`,
      };

      try {
        const eventsBuffer: AuditEvent[] = [];
        const state = await runInvestigation(trigger, agentType, def, (event) => {
          writeScratchpadEntry({ type: "agent_event", agent: agentType, message: JSON.stringify(event) });
          eventsBuffer.push(event);
        }, config);

        let hadFinding = false;
        for (const event of eventsBuffer) {
          yield event;
          if (event.type === "finding") hadFinding = true;
        }

        if (hadFinding) {
          findingsCount++;
        } else if (state.finding === undefined && state.confidence >= (state.effectiveFloor ?? 0.7)) {
          yield { type: "step", agent: agentType, message: `Finding suppressed — duplicate fingerprint already exists for this period` };
        } else if (state.iterations >= (config?.maxIterations ?? 5)) {
          yield { type: "step", agent: agentType, message: `No finding — max iterations (${state.iterations}) reached at confidence ${(state.confidence * 100).toFixed(0)}%` };
        } else {
          const pct = (state.confidence * 100).toFixed(0);
          yield { type: "step", agent: agentType, message: `No finding — confidence ${pct}% below threshold` };
        }
      } catch (err: any) {
        yield { type: "step", agent: agentType, message: `Error: ${err.message}` };
        writeScratchpadEntry({ type: "agent_error", agent: agentType, message: err.message });
      }
    }

    pruneScratchpad(cwd);
    yield { type: "done", totalFindings: findingsCount, durationMs: Math.round(performance.now() - startTime) };
  }

  return gen();
}
