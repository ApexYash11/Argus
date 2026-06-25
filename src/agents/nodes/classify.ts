import type { AgentContext } from "../state-machine";

export async function classifyEvent(ctx: AgentContext): Promise<void> {
  const { trigger, agentType } = ctx.state;

  ctx.emit({
    type: "step",
    agent: agentType,
    message: `Classifying event: ${trigger.type} for ${agentType} agent`,
  });
}
