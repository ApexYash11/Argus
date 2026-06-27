import * as readline from "readline";
import type { AuditEvent, FinancialEvent } from "../../model/types";
import { runSupervisor } from "../../agents/supervisor";
import { ingestFile } from "./ingest";
import { getFindings, getFindingById, getRecordCount, getAllVendors } from "../../db/queries";
import { groqComplete } from "../../llm/groq";

const BANNER = "\u2578ARGUS\u257A  chat mode  \u00B7  type \"exit\" to quit  \u00B7  Ctrl+C to stop";

function formatEvent(event: AuditEvent): string | null {
  switch (event.type) {
    case "agent_start":
      return `  ${event.description}`;
    case "step":
      return `  \u25C6 ${event.message}`;
    case "evidence_found":
      return `  \u2192 ${event.key}: ${event.value.slice(0, 120)}`;
    case "comparison":
      return `  ${event.label}: expected ${event.expected}, got ${event.actual}${event.delta ? ` (${event.delta})` : ""}`;
    case "confidence":
      return `  ${(event.score * 100).toFixed(0)}% \u2014 ${event.reason}`;
    case "finding": {
      const f = event.finding;
      const icon = f.severity === "critical" ? "\u26A0" : f.severity === "high" ? "!" : "\u00B7";
      return `  ${icon} ${f.id} | ${f.title} | [${f.severity}] ${(f.confidence * 100).toFixed(0)}%`;
    }
    case "agent_skipped":
      return `  ~ ${event.agent}: ${event.reason}`;
    case "done":
      return `  Done \u2014 ${event.totalFindings} finding(s) in ${event.durationMs}ms`;
    default:
      return null;
  }
}

export async function* handleChatMessage(input: string, cwd: string): AsyncGenerator<string> {
  const lower = input.trim().toLowerCase();
  const parts = input.trim().split(/\s+/);

  if (/^(investigate|check|run)\b/.test(lower)) {
    yield "  Starting investigation...";
    const trigger: FinancialEvent = {
      type: "daily_tick",
      timestamp: new Date().toISOString(),
    };
    const stream = await runSupervisor(cwd, trigger);
    for await (const event of stream) {
      const line = formatEvent(event);
      if (line) yield line;
    }
    return;
  }

  if (/^(findings|show|list|what did you find)\b/.test(lower)) {
    const findings = getFindings();
    if (findings.length === 0) {
      yield "  No findings found.";
      return;
    }
    for (const f of findings) {
      const icon = f.severity === "critical" ? "\u26A0" : f.severity === "high" ? "!" : "\u00B7";
      yield `  ${icon} ${f.id} | ${f.title} | [${f.severity}] ${(f.confidence * 100).toFixed(0)}% \u2014 ${f.status}`;
    }
    return;
  }

  if (/^explain\b/i.test(input)) {
    const id = parts[1];
    if (!id) {
      yield "  Usage: explain FINDING-XXX";
      return;
    }
    const finding = getFindingById(id.toUpperCase());
    if (!finding) {
      yield `  Finding ${id.toUpperCase()} not found.`;
      return;
    }
    yield `  ${finding.id}`;
    yield `  Title: ${finding.title}`;
    yield `  Severity: ${finding.severity}`;
    yield `  Confidence: ${(finding.confidence * 100).toFixed(0)}%`;
    yield `  Status: ${finding.status}`;
    yield `  Summary: ${finding.summary}`;
    return;
  }

  if (/^ingest\b/i.test(input)) {
    const filePath = parts.slice(1).join(" ");
    if (!filePath) {
      yield "  Usage: ingest <file-path>";
      return;
    }
    try {
      const stream = await ingestFile(cwd, filePath);
      for await (const event of stream) {
        const line = formatEvent(event);
        if (line) yield line;
      }
    } catch (err: any) {
      yield `  Error: ${err.message}`;
    }
    return;
  }

  try {
    const recCount = getRecordCount();
    const vendors = getAllVendors();
    const context = [
      `Current workspace: ${cwd}`,
      `Records ingested: ${recCount}`,
      `Vendors tracked: ${vendors.length}`,
    ].join("\n");
    const systemPrompt = [
      "You are Argus, an autonomous financial investigator.",
      `The user's financial workspace is at ${cwd}.`,
      "Answer questions about their spending, findings, and",
      "financial data. Be concise and direct.",
    ].join(" ");
    const res = await groqComplete(`${context}\n\nUser: ${input}`, systemPrompt);
    yield `  ${res.content}`;
  } catch (err: any) {
    yield `  Error: ${err.message}`;
  }
}

export async function startChat(cwd: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "argus \u203A ",
  });

  console.log(`\n  ${BANNER}\n`);

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "exit" || input === "quit") {
      break;
    }

    for await (const msg of handleChatMessage(input, cwd)) {
      console.log(msg);
    }

    rl.prompt();
  }

  rl.close();
  console.log("\n  Goodbye.");
}
