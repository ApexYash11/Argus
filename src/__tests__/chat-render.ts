/**
 * Human chat rendering verification (pure, no DB, no network).
 * Run: bun src/__tests__/chat-render.ts
 */
import { renderMarkdown, renderFindingCard, renderToolLine, humanImpact } from "../cli/components/chat-render";
import type { Finding } from "../model/types";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

function fakeFinding(): Finding {
  return {
    id: "FINDING-1",
    fingerprint: "abc",
    agentType: "duplicate-payments",
    vendorId: "Acme",
    title: "duplicate payments — Anomaly Detected",
    summary: "Investigation found 20 signal(s). VND-X — 4200 INR",
    evidenceChain: "[]",
    impactAmount: 4200,
    impactCurrency: "INR",
    confidence: 0.9,
    severity: "high",
    status: "open",
    investigationEvents: "[]",
    dismissedCount: 0,
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  console.log("=== Chat render verification ===\n");

  const md = renderMarkdown("## Spend\nFound **2 duplicates** worth `4200 INR`\n- Acme\n- Globex");
  assert(md.length === 4, "one rendered line per input line");
  assert(md[0]!.segments[0]?.bold === true, "header renders bold");
  assert(md[1]!.segments.some((s) => s.bold && s.text === "2 duplicates"), "bold span parsed");
  assert(md[1]!.segments.some((s) => s.text === "4200 INR"), "code span parsed");
  assert(md[2]!.segments[0]?.text.startsWith("  •") === true, "bullets humanized");

  const card = renderFindingCard(fakeFinding());
  const head = card.headline.map((s) => s.text).join("");
  assert(head.includes("HIGH") && head.includes("Duplicate Payments"), `headline human: ${head}`);
  assert(head.includes("4,200") && head.includes("90%"), "headline carries impact + confidence");
  assert(!head.includes("FINDING-1") && !head.includes("Anomaly Detected"), "no raw IDs/titles in headline");
  assert(card.hint.includes("explain FINDING-1"), "hint points at explain");

  assert(humanImpact(undefined, "INR") === "unknown impact", "missing impact handled");
  assert(humanImpact(4200, "INR") === "4,200 INR", "impact formatted");

  const start = renderToolLine("run_investigation", "start");
  assert(!start.includes("{") && start.includes("Investigating"), `tool start human: ${start}`);
  const done = renderToolLine("get_status", "done", "Records: 142, Vendors: 31");
  assert(done.includes("Checked workspace health") && done.includes("Records: 142"), "tool done carries summary");
  assert(renderToolLine("mystery_tool", "start").includes("mystery_tool"), "unknown tools degrade gracefully");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
