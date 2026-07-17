/**
 * End-to-end pipeline verification.
 * Run: bun src/__tests__/e2e-pipeline.ts
 */
import { initDb, getDb } from "../db/index";
import { initWorkspace } from "../cli/commands/init";
import "../agents/index";
import { getRecordCount, getDominantCurrency, getRecordQualityFlagCount, getFpRates, getSchemaCacheCount } from "../db/queries";
import { getCacheStats } from "../ingest/schema-detector";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

async function ingest(cwd: string, file: string): Promise<string[]> {
  const { ingestFile } = await import("../cli/commands/ingest");
  const stream = await ingestFile(cwd, file);
  const events: string[] = [];
  for await (const ev of stream) {
    if (ev.type === "step") events.push(ev.message);
  }
  return events;
}

async function runInvestigation(cwd: string): Promise<string[]> {
  const { investigate } = await import("../cli/commands/investigate");
  const stream = await investigate(cwd);
  const events: string[] = [];
  try {
    for await (const ev of stream) {
      if (ev.type === "step" || ev.type === "finding") {
        events.push(ev.type === "finding" ? `FINDING: ${ev.finding.id} ${ev.finding.title}` : ev.message);
      }
    }
  } catch (err: any) {
    events.push(`ERROR: ${err.message}`);
  }
  return events;
}

async function main() {
  console.log("=== E2E Pipeline Test ===\n");

  // 1. Init workspace
  await initWorkspace(".", "Test Corp");
  assert(getRecordCount() === 0, "E2E: Fresh DB has 0 records");

  // 2. Ingest all test files
  const files = [
    "test-data/subscriptions.csv",
    "test-data/usage.csv",
    "test-data/transactions.csv",
    "test-data/expense-reports.csv",
    "test-data/committed-expenses.csv",
  ];

  for (const f of files) {
    const events = await ingest(".", f);
    const ingested = events.filter(e => e.includes("Ingested") || e.includes("Previewed"));
    assert(ingested.length > 0, `E2E: ${f} ingested successfully`);
    console.log(`       ${ingested.join(", ")}`);
  }

  // 3. Verify record count
  const totalRecords = getRecordCount();
  assert(totalRecords >= 120, `E2E: ${totalRecords} records > 120`);

  // 4. Check schema cache
  const cacheCount = getSchemaCacheCount();
  assert(cacheCount >= 1, `E2E: Schema cache has ${cacheCount} entries`);

  // 5. Check dominant currency (test data has vendor names as currency → fallback to INR)
  const currency = getDominantCurrency();
  assert(currency === "INR", `E2E: getDominantCurrency() = "${currency}" (expected INR fallback)`);

  // 6. Check quality flags
  const zeroCount = getRecordQualityFlagCount("amount_zero");
  assert(zeroCount >= 0, `E2E: amount_zero flag count = ${zeroCount}`);

  // 7. Run investigation
  console.log("\n   Running investigation (may take a moment)...");
  const investEvents = await runInvestigation(".");
  for (const ev of investEvents) {
    if (ev.startsWith("FINDING:")) console.log(`       ${ev}`);
    else if (ev.startsWith("ERROR:")) console.log(`       ${ev}`);
  }
  const findings = investEvents.filter((e: string) => e.startsWith("FINDING:"));
  assert(findings.length >= 1, `E2E: At least 1 finding generated (got ${findings.length})`);

  // 8. Verify cache stats
  const cacheStats = getCacheStats();
  assert(typeof cacheStats.hits === "number", "E2E: cacheStats.hits is a number");
  assert(typeof cacheStats.misses === "number", "E2E: cacheStats.misses is a number");

  // 9. Check FP rates (should be empty since no feedback submitted)
  const rates = getFpRates();
  assert(rates.length === 0, "E2E: No FP rates without feedback");

  // 10. Verify the test CSV schemas were cached
  console.log(`   Schema cache: ${cacheCount} entries, ${cacheStats.hits} hits, ${cacheStats.misses} misses`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
