import React from "react";
import path from "path";
import fs from "fs";
import type { ChatEvent, FinancialEvent, AgentType, Finding } from "../../model/types";
import { runSupervisor } from "../../agents/supervisor";
import { ingestFile } from "./ingest";
import { getFindings, getFindingById, getRecordCount, getAllVendors } from "../../db/queries";

const AGENT_KEYWORDS: Array<{ agent: AgentType; words: string[] }> = [
  { agent: "anomaly-detection", words: ["anomaly", "anomalies", "spike", "outlier", "unusual"] },
  { agent: "duplicate-payments", words: ["duplicate", "duplicates", "double-paid", "double paid", "paid twice"] },
  { agent: "saas-waste", words: ["saas", "subscription", "subscriptions", "seat", "seats", "waste", "zombie", "unused"] },
  { agent: "vendor-overbilling", words: ["overbill", "overcharge", "contract", "vendor"] },
  { agent: "policy-violations", words: ["policy", "policies", "receipt", "per-diem", "per diem", "expense"] },
  { agent: "reconciliation", words: ["reconcil", "mismatch", "orphan", "invoice"] },
  { agent: "cashflow-risk", words: ["cash", "runway", "burn", "cashflow", "cash flow"] },
];

/** Map free text ("run anomaly detection") to a single agent. Null = run all. */
export function detectAgentFromQuery(lower: string): AgentType | null {
  for (const { agent, words } of AGENT_KEYWORDS) {
    if (words.some((w) => lower.includes(w))) return agent;
  }
  return null;
}

/** Compact investigation: one line per agent + findings + summary. No engine spam. */
async function* runCompactInvestigation(
  ctx: ChatContext,
  agent: AgentType | null,
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  yield { type: "agent_thinking", message: agent ? `Running ${agent}…` : "Running all agents…" };
  const trigger: FinancialEvent = {
    type: "daily_tick",
    timestamp: new Date().toISOString(),
  };
  const stream = await runSupervisor(ctx.cwd, trigger, agent ?? undefined, undefined, signal);
  const perAgent: string[] = [];
  const newFindings: Finding[] = [];
  let current: string | null = null;
  for await (const event of stream) {
    if (signal?.aborted) break;
    switch (event.type) {
      case "agent_start":
        current = event.agent;
        break;
      case "step":
        if (/^error:/i.test(event.message)) {
          yield { type: "agent_thinking", message: `Something went wrong in ${current ?? event.agent}: ${event.message.replace(/^error:\s*/i, "")}` };
        }
        break;
      case "agent_skipped":
        perAgent.push(humanAgentName(event.agent));
        break;
      case "finding":
        newFindings.push(event.finding);
        yield { type: "finding_card", finding: event.finding };
        break;
      case "confidence":
        break;
      case "done":
        break;
    }
  }
  ctx.lastFindings = newFindings.length > 0 ? newFindings : ctx.lastFindings;
  const skipped = perAgent.length > 0 ? ` Skipped ${perAgent.join(", ")} (not enough data).` : "";
  if (newFindings.length > 0) {
    yield { type: "agent_thinking", message: await composeSummary(newFindings, agent) };
  } else {
    yield { type: "agent_thinking", message: `Nothing new to report.${skipped} Dismissed items stay dismissed — say \`feedback <id> --resolve\` in your shell to clear one.` };
  }
  yield { type: "done", totalFindings: newFindings.length, durationMs: 0 };
}

function humanAgentName(agent: string): string {
  return agent.split("-").map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Human closing paragraph: LLM-composed when available, template otherwise. */
async function composeSummary(
  findings: Finding[],
  agent: AgentType | null
): Promise<string> {
  const top = findings.slice(0, 3).map((f) =>
    `${f.severity} ${f.agentType} at ${f.vendorId ?? "unknown vendor"} (${f.impactAmount ?? 0} ${f.impactCurrency ?? ""}, ${Math.round(f.confidence * 100)}%)`
  ).join("; ");
  const fallback = findings.length === 1
    ? `Found 1 thing worth your time: ${top}. Say \`explain 1\` and I'll walk through the evidence.`
    : `Found ${findings.length} things worth your time: ${top}${findings.length > 3 ? ", and more" : ""}. Say \`explain 1\` and I'll walk through the evidence.`;
  try {
    const { pickProvider } = await import("../../model/llm");
    const provider = pickProvider();
    if (provider.name === "local") return fallback;
    const reply = await provider.complete([
      { role: "system", content: "You are Argus, a financial investigator. Write ONE short paragraph (max 3 sentences, plain words, no jargon, no markdown headers) summarizing these findings for a founder. End with which one to look at first." },
      { role: "user", content: `Scope: ${agent ?? "all agents"}. Findings: ${top}. Total: ${findings.length}.` },
    ]);
    const clean = reply.replace(/^FINAL:\s*/i, "").trim();
    return clean.length > 0 ? clean : fallback;
  } catch {
    return fallback;
  }
}

export interface ChatContext {
  cwd: string;
  lastFindings?: Finding[];
}

export async function* handleChatMessage(
  input: string,
  ctx: ChatContext,
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const lower = input.trim().toLowerCase();
  const parts = input.trim().split(/\s+/);
  const recCount = getRecordCount();

  if (parts[0]?.startsWith("/")) {
    const cmd = parts[0].slice(1).toLowerCase();
    switch (cmd) {
      case "findings": {
        const findings = getFindings().slice(0, 10);
        if (findings.length === 0) {
          yield { type: "agent_thinking", message: "Nothing flagged so far — run `argus audit` on a folder first." };
        } else {
          ctx.lastFindings = findings;
          yield { type: "agent_thinking", message: `Here's what's on my radar (${findings.length}):` };
          let n = 0;
          for (const f of findings) {
            n++;
            yield { type: "agent_thinking", message: `${n}.` };
            yield { type: "finding_card", finding: f };
          }
          yield { type: "agent_thinking", message: `Say \`explain 1\` and I'll walk through it.` };
        }
        yield { type: "done", durationMs: 0 };
        return;
      }
      case "investigate":
      case "run": {
        const rest = parts.slice(1).join(" ").toLowerCase();
        yield* runCompactInvestigation(ctx, detectAgentFromQuery(rest), signal);
        return;
      }
      case "cd": {
        const target = parts.slice(1).join(" ").trim();
        if (!target) {
          yield { type: "agent_thinking", message: `Current workspace: ${ctx.cwd}` };
          yield { type: "done", durationMs: 0 };
          return;
        }
        const resolved = path.resolve(ctx.cwd, target);
        if (!fs.existsSync(resolved)) {
          yield { type: "agent_thinking", message: `Directory not found: ${resolved}` };
          yield { type: "done", durationMs: 0 };
          return;
        }
        ctx.cwd = resolved;
        yield { type: "agent_thinking", message: `Switched to ${resolved}` };
        yield { type: "done", durationMs: 0 };
        return;
      }
      case "status": {
        const vendors = getAllVendors();
        yield { type: "agent_thinking", message: `Records ingested: ${recCount}` };
        yield { type: "agent_thinking", message: `Vendors tracked: ${vendors.length}` };
        yield { type: "agent_thinking", message: `Workspace: ${ctx.cwd}` };
        yield { type: "done", durationMs: 0 };
        return;
      }
      case "digest": {
        const { generateDigest } = await import("./digest");
        const text = await generateDigest(undefined);
        for (const line of text.split("\n")) {
          yield { type: "agent_thinking", message: line };
        }
        yield { type: "done", durationMs: 0 };
        return;
      }
      case "clear":
        yield { type: "clear" };
        yield { type: "done", durationMs: 0 };
        return;
      case "help":
      default: {
        yield {
          type: "help",
          commands: [
            { name: "/findings", description: "List all findings" },
            { name: "/investigate", description: "Run investigation agents" },
            { name: "/status", description: "Show workspace status" },
            { name: "/digest", description: "Weekly markdown summary" },
            { name: "/cd <path>", description: "Switch workspace directory" },
            { name: "/clear", description: "Clear chat history" },
            { name: "/help", description: "Show this help" },
            { name: "findings", description: "List all findings" },
            { name: "investigate", description: "Run investigation agents" },
            { name: "explain <id>", description: "Inspect a finding" },
            { name: "audit <path>", description: "Ingest + investigate a folder" },
            { name: "exit", description: "Quit chat mode" },
          ],
        };
        yield { type: "done", durationMs: 0 };
        return;
      }
    }
  }

  if (recCount === 0 && !/^(audit|init|help|exit|quit)\b/.test(lower)) {
    yield { type: "agent_thinking", message: "No financial data ingested yet." };
    yield { type: "tool_start", tool: "audit", args: "check", toolCallId: "empty-check" };
    yield { type: "tool_end", tool: "audit", summary: "Run `argus audit <folder>` first (exit chat, then audit).", durationMs: 0, toolCallId: "empty-check" };
    yield { type: "done", durationMs: 0 };
    return;
  }

  if (/^(investigate|check|run)\b/.test(lower)) {
    yield* runCompactInvestigation(ctx, detectAgentFromQuery(lower), signal);
    return;
  }

  if (/^(findings|show|list|what did you find)\b/.test(lower)) {
    const findings = getFindings().slice(0, 10);
    if (findings.length === 0) {
      yield { type: "agent_thinking", message: "Nothing flagged so far. Run `argus audit` on a folder, then ask me again." };
      yield { type: "done", durationMs: 0 };
      return;
    }
    ctx.lastFindings = findings;
    yield { type: "agent_thinking", message: `Here's what's on my radar (${findings.length}):` };
    let n = 0;
    for (const f of findings) {
      n++;
      yield { type: "agent_thinking", message: `${n}.` };
      yield { type: "finding_card", finding: f };
    }
    yield { type: "agent_thinking", message: `Say \`explain 1\` (or any number) and I'll walk through it.` };
    yield { type: "done", durationMs: 0 };
    return;
  }

  if (/^explain\b/i.test(input)) {
    const id = parts[1];
    if (!id) {
      yield { type: "agent_thinking", message: "Tell me which one — `explain 1` for the first card above, or `explain FINDING-XXX`." };
      yield { type: "done", durationMs: 0 };
      return;
    }
    const num = /^\d+$/.test(id) ? parseInt(id, 10) : null;
    const finding = num !== null
      ? ctx.lastFindings?.[num - 1] ?? null
      : getFindingById(id.toUpperCase());
    if (!finding) {
      yield { type: "agent_thinking", message: num !== null
        ? `I only have ${ctx.lastFindings?.length ?? 0} findings listed — try a smaller number, or run \`findings\` again.`
        : `Finding ${id.toUpperCase()} not found.` };
      yield { type: "done", durationMs: 0 };
      return;
    }
    yield { type: "finding_card", finding };
    yield { type: "agent_thinking", message: `Why this matters: ${finding.summary.replace(/\s+/g, " ").trim().slice(0, 280)}` };
    yield { type: "agent_thinking", message: `Confidence ${Math.round(finding.confidence * 100)}%, status ${finding.status}. In your shell: \`argus feedback ${finding.id} --resolve \"fixed\"\` to clear it.` };
    yield { type: "done", durationMs: 0 };
    return;
  }

  if (/^ingest\b/i.test(input)) {
    const filePath = parts.slice(1).join(" ");
    if (!filePath) {
      yield { type: "agent_thinking", message: "Usage: ingest <file-path>" };
      yield { type: "done", durationMs: 0 };
      return;
    }
    try {
      const stream = await ingestFile(ctx.cwd, filePath);
      for await (const event of stream) {
        if (signal?.aborted) break;
        if (event.type === "step") {
          yield { type: "agent_thinking", message: event.message };
        }
        if (event.type === "done") {
          yield { type: "done", durationMs: event.durationMs };
          return;
        }
      }
    } catch (err: any) {
      yield { type: "error", message: err.message };
    }
    yield { type: "done", durationMs: 0 };
    return;
  }

  const vendors = getAllVendors();
  const context = [
    `Current workspace: ${ctx.cwd}`,
    `Records ingested: ${recCount}`,
    `Vendors tracked: ${vendors.length}`,
  ].join("\n");

  // Agentic loop: LLM plans tool calls (list_findings, get_finding,
  // get_status, run_investigation) over up to 5 iterations.
  const { runAgent } = await import("../../agent/agent");
  const toolCtx = { cwd: ctx.cwd, signal };
  let toolSeq = 0;
  let activeToolCallId = "";
  for await (const event of runAgent(`${context}\n\nUser: ${input}`, toolCtx)) {
    if (signal?.aborted) break;
    switch (event.type) {
      case "thinking":
        yield { type: "agent_thinking", message: event.message };
        break;
      case "token":
        yield { type: "llm_chunk", text: event.text };
        break;
      case "tool_start":
        activeToolCallId = `tool-${toolSeq++}`;
        yield { type: "tool_start", tool: event.tool, args: event.args, toolCallId: activeToolCallId };
        break;
      case "tool_end":
        yield { type: "tool_end", tool: event.tool, summary: event.summary, durationMs: 0, toolCallId: activeToolCallId };
        break;
      case "final":
        yield { type: "llm_done", fullText: event.text };
        break;
      case "done":
        break;
    }
  }
  yield { type: "done", durationMs: 0 };
}

export async function startChat(cwd: string): Promise<void> {
  const { render } = await import("ink");
  const { default: ChatUI } = await import("../components/ChatUI.js");
  const ctx: ChatContext = { cwd };
  const { waitUntilExit } = render(<ChatUI cwd={cwd} chatCtx={ctx} />);
  await waitUntilExit;
}
