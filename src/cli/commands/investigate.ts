import type { AuditEvent, AgentType } from "../../model/types";

export async function investigate(
  _type?: AgentType,
  _watch?: boolean
): Promise<AsyncGenerator<AuditEvent>> {
  async function* gen(): AsyncGenerator<AuditEvent> {
    yield { type: "step", agent: "investigate", message: "Investigation engine starting..." };
    yield { type: "done", totalFindings: 0, durationMs: 0 };
  }
  return gen();
}
