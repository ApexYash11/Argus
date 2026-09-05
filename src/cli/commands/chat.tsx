import React from "react";
import path from "path";
import fs from "fs";
import type { ChatEvent, FinancialEvent } from "../../model/types";
import { runSupervisor } from "../../agents/supervisor";
import { ingestFile } from "./ingest";
import { getFindings, getFindingById, getRecordCount, getAllVendors } from "../../db/queries";

export interface ChatContext {
  cwd: string;
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
        const findings = getFindings();
        if (findings.length === 0) {
          yield { type: "agent_thinking", message: "No findings found." };
        } else {
          for (const f of findings) {
            yield { type: "agent_thinking", message: `${f.id} | ${f.title} | [${f.severity}] ${(f.confidence * 100).toFixed(0)}% \u2014 ${f.status}` };
          }
        }
        yield { type: "done", durationMs: 0 };
        return;
      }
      case "investigate":
      case "run": {
        yield { type: "agent_thinking", message: "Starting investigation..." };
        const trigger: FinancialEvent = {
          type: "daily_tick",
          timestamp: new Date().toISOString(),
        };
        const stream = await runSupervisor(ctx.cwd, trigger, undefined, undefined, signal);
        for await (const event of stream) {
          switch (event.type) {
            case "agent_start":
              yield { type: "agent_thinking", message: event.description };
              break;
            case "step":
              yield { type: "agent_thinking", message: event.message };
              break;
            case "finding":
              yield { type: "agent_thinking", message: `${event.finding.id} | ${event.finding.title} | [${event.finding.severity}] ${(event.finding.confidence * 100).toFixed(0)}%` };
              break;
            case "done":
              yield { type: "done", totalFindings: event.totalFindings, durationMs: event.durationMs };
              return;
          }
        }
        yield { type: "done", durationMs: 0 };
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
            { name: "/cd <path>", description: "Switch workspace directory" },
            { name: "/clear", description: "Clear chat history" },
            { name: "/help", description: "Show this help" },
            { name: "findings", description: "List all findings" },
            { name: "investigate", description: "Run investigation agents" },
            { name: "explain <id>", description: "Inspect a finding" },
            { name: "ingest <path>", description: "Ingest a file" },
            { name: "exit", description: "Quit chat mode" },
          ],
        };
        yield { type: "done", durationMs: 0 };
        return;
      }
    }
  }

  if (recCount === 0 && !/^(ingest|init|demo|help|exit|quit)\b/.test(lower)) {
    yield { type: "agent_thinking", message: "No financial data ingested yet." };
    yield { type: "tool_start", tool: "ingest", args: "check", toolCallId: "empty-check" };
    yield { type: "tool_end", tool: "ingest", summary: "Run `argus ingest <file>` first, or try `argus demo`.", durationMs: 0, toolCallId: "empty-check" };
    yield { type: "done", durationMs: 0 };
    return;
  }

  if (/^(investigate|check|run)\b/.test(lower)) {
    yield { type: "agent_thinking", message: "Starting investigation..." };
    const trigger: FinancialEvent = {
      type: "daily_tick",
      timestamp: new Date().toISOString(),
    };
    const stream = await runSupervisor(ctx.cwd, trigger, undefined, undefined, signal);
    for await (const event of stream) {
      switch (event.type) {
        case "agent_start":
          yield { type: "agent_thinking", message: event.description };
          break;
        case "step":
          yield { type: "agent_thinking", message: event.message };
          break;
        case "finding":
          yield { type: "agent_thinking", message: `${event.finding.id} | ${event.finding.title} | [${event.finding.severity}] ${(event.finding.confidence * 100).toFixed(0)}%` };
          break;
        case "done":
          yield { type: "done", totalFindings: event.totalFindings, durationMs: event.durationMs };
          return;
      }
    }
    yield { type: "done", durationMs: 0 };
    return;
  }

  if (/^(findings|show|list|what did you find)\b/.test(lower)) {
    const findings = getFindings();
    if (findings.length === 0) {
      yield { type: "agent_thinking", message: "No findings found." };
      yield { type: "done", durationMs: 0 };
      return;
    }
    for (const f of findings) {
      yield { type: "agent_thinking", message: `${f.id} | ${f.title} | [${f.severity}] ${(f.confidence * 100).toFixed(0)}% \u2014 ${f.status}` };
    }
    yield { type: "done", durationMs: 0 };
    return;
  }

  if (/^explain\b/i.test(input)) {
    const id = parts[1];
    if (!id) {
      yield { type: "agent_thinking", message: "Usage: explain FINDING-XXX" };
      yield { type: "done", durationMs: 0 };
      return;
    }
    const finding = getFindingById(id.toUpperCase());
    if (!finding) {
      yield { type: "agent_thinking", message: `Finding ${id.toUpperCase()} not found.` };
      yield { type: "done", durationMs: 0 };
      return;
    }
    yield { type: "agent_thinking", message: `${finding.id}` };
    yield { type: "agent_thinking", message: `Title: ${finding.title}` };
    yield { type: "agent_thinking", message: `Severity: ${finding.severity}` };
    yield { type: "agent_thinking", message: `Confidence: ${(finding.confidence * 100).toFixed(0)}%` };
    yield { type: "agent_thinking", message: `Status: ${finding.status}` };
    yield { type: "agent_thinking", message: `Summary: ${finding.summary}` };
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
  for await (const event of runAgent(`${context}\n\nUser: ${input}`, toolCtx)) {
    if (signal?.aborted) break;
    switch (event.type) {
      case "thinking":
        yield { type: "agent_thinking", message: event.message };
        break;
      case "tool_start":
        yield { type: "tool_start", tool: event.tool, args: event.args, toolCallId: `${event.tool}-${Date.now()}` };
        break;
      case "tool_end":
        yield { type: "tool_end", tool: event.tool, summary: event.summary, durationMs: 0, toolCallId: `${event.tool}-last` };
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
