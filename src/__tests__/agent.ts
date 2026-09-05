/**
 * Slice 4 verification: agentic loop with scripted stub provider (no API keys, no DB writes).
 * Run: bun src/__tests__/agent.ts
 */
import { runAgent, parseReply, MAX_AGENT_ITERATIONS } from "../agent/agent";
import { ToolRegistry } from "../tools/registry";
import type { LLMProvider } from "../model/llm";
import { queryReadOnly } from "../db/queries";
import { initDb } from "../db/index";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

function stubProvider(script: string[]): LLMProvider {
  let i = 0;
  return {
    name: "stub",
    async complete() {
      return script[Math.min(i++, script.length - 1)]!;
    },
  };
}

async function main() {
  console.log("=== Agent loop verification ===\n");

  // parseReply contract
  const tool = parseReply('Let me check.\n```tool\n{"name": "list_findings", "args": {"status": "open"}}\n```');
  assert(tool.tool?.name === "list_findings", "parses fenced tool call");
  const fin = parseReply("Some throat-clearing.\nFINAL: You have 2 open findings.");
  assert(fin.final === "You have 2 open findings.", "parses FINAL answer");
  const plain = parseReply("Just a sentence.");
  assert(plain.final === "Just a sentence.", "plain text becomes final");
  const malformed = parseReply('```tool\n{not json\n```');
  assert(typeof malformed.final === "string", "malformed tool JSON degrades to final");

  // Loop: tool executes, result feeds final answer
  const registry = new ToolRegistry([
    {
      name: "get_number",
      description: "Returns the number 42.",
      parameters: "{}",
      async execute() { return "42"; },
    },
  ]);
  const events1: string[] = [];
  let finalText = "";
  for await (const ev of runAgent("what is the number?", { cwd: "." }, {
    registry,
    provider: stubProvider([
      '```tool\n{"name": "get_number", "args": {}}\n```',
      "FINAL: The number is 42.",
    ]),
  })) {
    events1.push(ev.type);
    if (ev.type === "final") finalText = ev.text;
  }
  assert(events1.includes("tool_start") && events1.includes("tool_end"), "tool ran with start/end events");
  assert(finalText === "The number is 42.", "final answer after tool result");

  // Unknown tool → error result, loop continues to recovery
  let final2 = "";
  for await (const ev of runAgent("hi", { cwd: "." }, {
    registry,
    provider: stubProvider([
      '```tool\n{"name": "nope", "args": {}}\n```',
      "FINAL: Recovered.",
    ]),
  })) {
    if (ev.type === "final") final2 = ev.text;
  }
  assert(final2 === "Recovered.", "unknown tool degrades gracefully");

  // Max iterations guard
  let steps = 0;
  const loopForever: LLMProvider = { name: "loop", async complete() { return '```tool\n{"name": "get_number", "args": {}}\n```'; } };
  for await (const ev of runAgent("go", { cwd: "." }, { registry, provider: loopForever, maxIterations: 2 })) {
    if (ev.type === "tool_start") steps++;
  }
  assert(steps === 2, `iteration cap respected (got ${steps}, max ${MAX_AGENT_ITERATIONS} default ${MAX_AGENT_ITERATIONS})`);

  // queryReadOnly guard (needs initialized DB only for allowed query)
  for (const bad of ["DELETE FROM findings", "SELECT * FROM findings; DROP TABLE findings", "SELECT * -- x", "PRAGMA journal_mode"]) {
    let threw = false;
    try { queryReadOnly(bad); } catch { threw = true; }
    assert(threw, `rejects: ${bad.slice(0, 24)}`);
  }
  initDb(".");
  const rows = queryReadOnly("SELECT id FROM findings");
  assert(Array.isArray(rows), "SELECT allowed against workspace DB");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
