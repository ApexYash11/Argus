/**
 * Slice 1 verification: report --share HTML.
 * Run: bun src/__tests__/report-share.ts
 * Uses the current workspace DB (.audit/spend-auditor.db) read-only.
 */
import { initDb } from "../db/index";
import { generateReport } from "../cli/commands/report";
import { buildShareHtml } from "../cli/commands/share";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

async function main() {
  console.log("=== Report --share verification ===\n");
  initDb(".");

  const report = await generateReport(undefined);
  assert(typeof report.summary.moneyFound === "number", "moneyFound is a number");
  assert(typeof report.summary.currency === "string" && report.summary.currency.length > 0, `currency present (${report.summary.currency})`);
  assert(typeof report.summary.vendorCount === "number", "vendorCount present");

  const html = buildShareHtml(report);
  assert(html.includes("<!DOCTYPE html>"), "HTML doctype present");
  assert(html.includes("recoverable (open + resolved)"), "money-found hero present");
  assert(html.includes("Top 5 open leaks"), "top-5 section present");
  assert(html.includes("All findings"), "all-findings table present");
  assert(html.includes("FP/TP by agent"), "FP/TP section present");
  assert(!html.includes("https://") || html.includes("no external requests"), "self-contained (no CDN links)");
  assert(html.includes(escapeCheck(report)), "period rendered");

  // Empty-report path: build with zero findings must not crash
  const empty = buildShareHtml({
    ...report,
    findings: [],
    summary: { ...report.summary, total: 0, open: 0, critical: 0, resolved: 0, dismissed: 0, totalImpact: 0, moneyFound: 0 },
    agentRates: [],
  });
  assert(empty.includes("all clear") || empty.includes("All findings (0)"), "empty state renders");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

function escapeCheck(report: { period: string }): string {
  return report.period;
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
