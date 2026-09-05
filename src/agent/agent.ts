import type { LLMProvider } from "../model/llm";
import { pickProvider } from "../model/llm";
import { ToolRegistry, type ToolContext } from "../tools/registry";

export const MAX_AGENT_ITERATIONS = 5;

export type AgentEvent =
  | { type: "thinking"; message: string }
  | { type: "token"; text: string }
  | { type: "tool_start"; tool: string; args: string }
  | { type: "tool_end"; tool: string; summary: string }
  | { type: "final"; text: string }
  | { type: "done" };

export interface AgentOptions {
  provider?: LLMProvider;
  registry?: ToolRegistry;
  maxIterations?: number;
}

const TOOL_CONTRACT = `Reply with EXACTLY one of:
1. A tool call in a fenced block:
\`\`\`tool
{"name": "<tool>", "args": {...}}
\`\`\`
Example: \`\`\`tool {"name": "run_investigation", "args": {"agent": "anomaly-detection"}} \`\`\`
2. The final answer:
FINAL: <answer>
Rules: never do both. Never invent tool names. No chatter outside the block
or the FINAL line — any extra text is shown to the user verbatim. When the
user asks for analysis, prefer calling run_investigation or list_findings
first, then summarize. End findings summaries with one suggested next step.`;

export function buildSystemPrompt(registry: ToolRegistry, ctx: ToolContext): string {
  return [
    "You are Argus, an autonomous financial investigator.",
    `Workspace: ${ctx.cwd}. Be concise and cite finding IDs, amounts, vendors.`,
    "Available tools:",
    registry.catalog(),
    TOOL_CONTRACT,
  ].join("\n");
}

export function parseReply(reply: string): { tool?: { name: string; args: Record<string, unknown> }; final?: string } {
  const finalIdx = reply.indexOf("FINAL:");
  const fence = reply.match(/```tool\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      const parsed = JSON.parse(fence[1].trim()) as { name: string; args?: Record<string, unknown> };
      if (typeof parsed.name === "string") {
        if (finalIdx >= 0 && finalIdx < (fence.index ?? Infinity)) {
          return { final: reply.slice(finalIdx + "FINAL:".length).trim() };
        }
        return { tool: { name: parsed.name, args: parsed.args ?? {} } };
      }
    } catch {
      // malformed tool JSON → treat as final text below
    }
  }
  if (finalIdx >= 0) return { final: reply.slice(finalIdx + "FINAL:".length).trim() };
  return { final: reply.trim() };
}

export async function* runAgent(
  query: string,
  ctx: ToolContext,
  opts: AgentOptions = {}
): AsyncGenerator<AgentEvent> {
  const registry = opts.registry ?? new ToolRegistry();
  const provider = opts.provider ?? pickProvider();
  const maxIters = opts.maxIterations ?? MAX_AGENT_ITERATIONS;

  const history: Array<{ role: "user" | "assistant" | "tool"; content: string; toolName?: string }> = [
    { role: "user", content: query },
  ];

  for (let i = 0; i < maxIters; i++) {
    if (ctx.signal?.aborted) {
      yield { type: "final", text: "Cancelled." };
      break;
    }
    yield { type: "thinking", message: i === 0 ? "Planning which tools to use..." : `Follow-up step ${i + 1}...` };

    const fullMessages = [
      { role: "system", content: buildSystemPrompt(registry, ctx) },
      ...history,
    ] as Parameters<LLMProvider["complete"]>[0];

    let reply: string;
    try {
      if (provider.stream) {
        const parts: string[] = [];
        for await (const token of provider.stream(fullMessages, ctx.signal)) {
          parts.push(token);
          yield { type: "token", text: token };
        }
        reply = parts.join("");
        if (!reply) {
          reply = await provider.complete(fullMessages);
        }
      } else {
        reply = await provider.complete(fullMessages);
      }
    } catch (err: any) {
      yield { type: "final", text: `LLM error: ${err?.message ?? err}` };
      break;
    }

    const parsed = parseReply(reply);
    if (parsed.final !== undefined) {
      yield { type: "final", text: parsed.final };
      break;
    }

    const def = registry.get(parsed.tool!.name);
    if (!def) {
      history.push({ role: "assistant", content: reply });
      history.push({ role: "tool", toolName: parsed.tool!.name, content: `ERROR: unknown tool "${parsed.tool!.name}".` });
      continue;
    }

    const argsStr = JSON.stringify(parsed.tool!.args);
    yield { type: "tool_start", tool: def.name, args: argsStr };
    let result: string;
    try {
      result = await def.execute(parsed.tool!.args, ctx);
    } catch (err: any) {
      result = `ERROR: ${err?.message ?? err}`;
    }
    yield { type: "tool_end", tool: def.name, summary: result.slice(0, 200) };
    history.push({ role: "assistant", content: reply });
    history.push({ role: "tool", toolName: def.name, content: result });

    if (i === maxIters - 1) {
      yield { type: "final", text: result };
    }
  }

  yield { type: "done" };
}
