import type { AgentContext } from "../state-machine";

// STUB: classifyEvent currently only emits a step message with no real classification logic.
// The shared classify node was intended to determine whether the incoming trigger/event
// is relevant to the current agent. Today each agent implements its own filtering inline
// (e.g., checking data types, date ranges) and this node is bypassed.
// Tracked gap: wire real classification here or remove if per-agent inline logic
// is the permanent design.
export async function classifyEvent(ctx: AgentContext): Promise<void> {
  const { trigger, agentType } = ctx.state;

  ctx.emit({
    type: "step",
    agent: agentType,
    message: `Classifying event: ${trigger.type} for ${agentType} agent`,
  });
}
