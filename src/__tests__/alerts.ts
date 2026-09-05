/**
 * Slice 2 verification: alerts + digest.
 * Run: bun src/__tests__/alerts.ts
 */
import { initDb } from "../db/index";
import {
  formatSlack,
  postWebhook,
  resolveWebhook,
  shouldAlert,
  type SlackPayload,
} from "../alerts/webhook";
import { generateDigest } from "../cli/commands/digest";
import type { Finding } from "../model/types";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

function fakeFinding(severity: Finding["severity"]): Finding {
  return {
    id: "FINDING-TEST",
    fingerprint: "abc",
    agentType: "duplicate-payments",
    vendorId: "Acme <Corp>",
    title: "duplicate payments — Anomaly Detected",
    summary: "2 payments of 4200 on 2026-01-01 and 2026-01-03",
    evidenceChain: "[]",
    impactAmount: 4200,
    impactCurrency: "INR",
    confidence: 0.85,
    severity,
    status: "open",
    investigationEvents: "[]",
    dismissedCount: 0,
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  console.log("=== Alerts verification ===\n");

  // Thresholds
  assert(shouldAlert("critical", "high") === true, "critical passes min=high");
  assert(shouldAlert("high", "high") === true, "high passes min=high");
  assert(shouldAlert("warning", "high") === false, "warning blocked by min=high");
  assert(shouldAlert("info", "info") === true, "info passes min=info");
  assert(shouldAlert("critical", "critical") === true, "critical passes min=critical");
  assert(shouldAlert("high", "critical") === false, "high blocked by min=critical");

  // Webhook resolution
  delete process.env.ARGUS_WEBHOOK_URL;
  assert(resolveWebhook(undefined) === null, "no webhook when unset");
  process.env.ARGUS_WEBHOOK_URL = "https://hooks.example.com/x";
  assert(resolveWebhook(undefined) === "https://hooks.example.com/x", "env fallback works");
  assert(resolveWebhook("https://flag.example.com") === "https://flag.example.com", "flag beats env");
  delete process.env.ARGUS_WEBHOOK_URL;

  // Payload shape
  const payload = formatSlack(fakeFinding("high"), "INR");
  assert(typeof payload.text === "string" && payload.text.includes("FINDING-TEST") === false, "text is one-line summary");
  assert(payload.text.includes("[high]"), "text carries severity");
  assert(Array.isArray(payload.blocks) && payload.blocks.length === 3, "3 Slack blocks");
  assert(JSON.stringify(payload).includes("Acme <Corp>"), "vendor preserved for Slack mrkdwn");

  // Live POST against localhost receiver
  let received: SlackPayload | null = null;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      received = (await req.json()) as SlackPayload;
      return new Response("ok", { status: 200 });
    },
  });
  await postWebhook(`http://127.0.0.1:${server.port}/hook`, payload);
  assert(received !== null && (received as unknown as SlackPayload).text === payload.text, "localhost receiver got payload");
  server.stop();

  // Failing webhook throws (caller converts to one-line warning)
  let threw = false;
  const bad = Bun.serve({ port: 0, fetch() { return new Response("nope", { status: 500 }); } });
  try {
    await postWebhook(`http://127.0.0.1:${bad.port}/hook`, payload);
  } catch { threw = true; }
  assert(threw === true, "non-2xx throws for caller to downgrade");
  bad.stop();

  // Digest
  initDb(".");
  const digest = await generateDigest(undefined);
  assert(digest.includes("# Argus Weekly Digest"), "digest header present");
  assert(digest.includes("recoverable"), "digest hero present");
  assert(digest.includes("Top 5 open leaks"), "digest top-5 present");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
