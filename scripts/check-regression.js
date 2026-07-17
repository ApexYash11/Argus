#!/usr/bin/env node
/**
 * Regression check script for Argus evaluation framework.
 *
 * Usage:
 *   node scripts/check-regression.js <actual-metrics.json> [expected-metrics.json]
 *
 * If expected-metrics.json is provided, compares actual vs expected findings.
 * If only actual-metrics.json is provided, validates the metrics format.
 *
 * Exit codes:
 *   0 - all checks passed (or warnings only)
 *   1 - critical regression detected
 */

const fs = require("fs");

const actualPath = process.argv[2];
const expectedPath = process.argv[3];

if (!actualPath) {
  console.error("Usage: node scripts/check-regression.js <actual-metrics.json> [expected-metrics.json]");
  process.exit(1);
}

function loadJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`Error reading ${path}: ${err.message}`);
    process.exit(1);
  }
}

const actual = loadJson(actualPath);
let failures = 0;

console.log("=== Argus Regression Check ===");

// Validate metrics structure
const requiredFields = ["period", "generatedAt", "summary", "findings", "schemaCache", "agentRates"];
for (const field of requiredFields) {
  if (!(field in actual)) {
    console.error(`FAIL: Missing required field "${field}"`);
    failures++;
  }
}

if (actual.summary) {
  console.log(`Total findings: ${actual.summary.total}`);
  console.log(`Open: ${actual.summary.open} | Resolved: ${actual.summary.resolved} | Dismissed: ${actual.summary.dismissed}`);
  console.log(`Critical: ${actual.summary.critical}`);
  console.log(`Total impact: ${actual.summary.totalImpact}`);
  console.log(`Record count: ${actual.summary.recordCount}`);
}

if (actual.schemaCache) {
  console.log(`Schema cache: ${actual.schemaCache.hits} hits, ${actual.schemaCache.misses} misses`);
}

if (actual.agentRates && actual.agentRates.length > 0) {
  console.log("\nAgent rates:");
  for (const r of actual.agentRates) {
    console.log(`  ${r.agentType}: FP=${r.fpRate != null ? (r.fpRate * 100).toFixed(0) + "%" : "N/A"} TP=${r.tpRate != null ? (r.tpRate * 100).toFixed(0) + "%" : "N/A"} (${r.resolved}+${r.escalated}/${r.dismissed})`);
  }
}

// Compare against expected findings if provided
if (expectedPath) {
  const expected = loadJson(expectedPath);
  const expectedFindings = expected.findings || [];
  const actualFindings = actual.findings || [];

  console.log(`\nExpected findings: ${expectedFindings.length}`);
  console.log(`Actual findings:   ${actualFindings.length}`);

  const expectedFps = new Set(expectedFindings.map((f) => f.id || JSON.stringify(f)));
  const actualFps = new Set(actualFindings.map((f) => f.fingerprint));

  const missing = expectedFindings.filter((f) => !actualFps.has(f.fingerprint));
  const extra = actualFindings.filter((f) => !expectedFps.has(f.fingerprint));

  if (missing.length > 0) {
    console.warn(`\nWARNING: ${missing.length} expected finding(s) not found:`);
    for (const m of missing.slice(0, 5)) {
      console.warn(`  ${m.agentType}: ${m.title || "(no title)"}`);
    }
  }

  if (extra.length > 0) {
    console.warn(`\nWARNING: ${extra.length} unexpected finding(s) appeared:`);
    for (const e of extra.slice(0, 5)) {
      console.warn(`  ${e.agentType}: impact=${e.impactAmount}`);
    }
  }
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} regression(s) detected`);
  process.exit(1);
}

console.log("\nPASS: All checks passed");
process.exit(0);
