/**
 * Duplicate-payments v2 + calibration v2 verification.
 * Run: bun src/__tests__/duplicate-v2.ts
 */
import { initDb, getDb } from "../db/index";
import { upsertVendor, insertFinancialRecord, getCalibration, getFindings } from "../db/queries";
import "../agents/index";
import { submitFeedback } from "../cli/commands/feedback";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

function rec(partial: Partial<{ id: string; type: any; vendorId: string; amount: number; date: string; periodStart: string; periodEnd: string; description: string; status: any; currency: string; raw: string }>) {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    type: partial.type ?? "payment" as const,
    vendorId: partial.vendorId ?? "vnd-test",
    amount: partial.amount ?? 1000,
    currency: partial.currency ?? "INR",
    date: partial.date ?? "2024-06-15",
    periodStart: partial.periodStart,
    periodEnd: partial.periodEnd,
    description: partial.description,
    status: partial.status ?? "cleared" as const,
    sourceDocId: undefined,
    raw: partial.raw ?? "{}",
    ingestedAt: new Date().toISOString(),
  };
}

function freshDb() {
  const db = getDb();
  db.run("DELETE FROM financial_records");
  db.run("DELETE FROM vendors");
  db.run("DELETE FROM findings");
  db.run("DELETE FROM feedback");
  db.run("DELETE FROM calibration");
  db.run("DELETE FROM scratchpad_runs");
  db.run("DELETE FROM documents");
}

async function runAgent(agent: "duplicate-payments"): Promise<number> {
  const { runSupervisor } = await import("../agents/supervisor");
  const stream = await runSupervisor(".", { type: "daily_tick", timestamp: new Date().toISOString() }, agent);
  let findings = 0;
  for await (const ev of stream) {
    if (ev.type === "finding") findings++;
  }
  return findings;
}

async function main() {
  console.log("=== Duplicate-payments v2 ===\n");
  initDb(".");
  freshDb();

  // Case 1: TRUE duplicate — same vendor, exact amount, 7d apart, same period
  upsertVendor({ id: "vnd-acme", canonicalName: "Acme", aliases: ["Acme"], trustScore: 0.95, firstSeen: "2024-01-01", lastSeen: "2024-06-30" });
  insertFinancialRecord(rec({ id: "t1", vendorId: "vnd-acme", amount: 4500, date: "2024-06-10", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "INV-100", status: "cleared" }));
  insertFinancialRecord(rec({ id: "t2", vendorId: "vnd-acme", amount: 4500, date: "2024-06-15", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "INV-100-A", status: "cleared" }));
  let n = await runAgent("duplicate-payments");
  assert(n === 1, `true duplicate fires (got ${n})`);

  // Case 2: NOT a duplicate — same amount, 200 days apart
  insertFinancialRecord(rec({ id: "t3", vendorId: "vnd-acme", amount: 4500, date: "2024-12-30", periodStart: "2024-12-01", periodEnd: "2024-12-31", description: "INV-101", status: "cleared" }));
  freshDb();
  upsertVendor({ id: "vnd-acme", canonicalName: "Acme", aliases: ["Acme"], trustScore: 0.95, firstSeen: "2024-01-01", lastSeen: "2024-12-30" });
  insertFinancialRecord(rec({ id: "t1", vendorId: "vnd-acme", amount: 4500, date: "2024-06-10", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "INV-100", status: "cleared" }));
  insertFinancialRecord(rec({ id: "t2", vendorId: "vnd-acme", amount: 4500, date: "2024-06-15", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "INV-100-A", status: "cleared" }));
  insertFinancialRecord(rec({ id: "t3", vendorId: "vnd-acme", amount: 4500, date: "2024-12-30", periodStart: "2024-12-01", periodEnd: "2024-12-31", description: "INV-101", status: "cleared" }));
  n = await runAgent("duplicate-payments");
  assert(n === 1, `200d-apart pair not flagged (got ${n})`);

  // Case 3: monthly subscription (same periodStart, same amount) — NOT duplicate
  freshDb();
  upsertVendor({ id: "vnd-saas", canonicalName: "SaaS", aliases: ["SaaS"], trustScore: 0.95, firstSeen: "2024-01-01", lastSeen: "2024-08-30" });
  insertFinancialRecord(rec({ id: "s1", vendorId: "vnd-saas", amount: 500, date: "2024-07-01", periodStart: "2024-07-01", periodEnd: "2024-07-31", description: "Subscription Jul", status: "cleared" }));
  insertFinancialRecord(rec({ id: "s2", vendorId: "vnd-saas", amount: 500, date: "2024-08-01", periodStart: "2024-08-01", periodEnd: "2024-08-31", description: "Subscription Aug", status: "cleared" }));
  n = await runAgent("duplicate-payments");
  assert(n === 0, `monthly subscription not flagged (got ${n})`);

  // Case 4: zeros/refunds excluded
  freshDb();
  upsertVendor({ id: "vnd-x", canonicalName: "X", aliases: ["X"], trustScore: 0.95, firstSeen: "2024-01-01", lastSeen: "2024-06-30" });
  insertFinancialRecord(rec({ id: "z1", vendorId: "vnd-x", amount: 0, date: "2024-06-10", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "z", status: "cleared" }));
  insertFinancialRecord(rec({ id: "z2", vendorId: "vnd-x", amount: 0, date: "2024-06-15", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "z", status: "cleared" }));
  n = await runAgent("duplicate-payments");
  assert(n === 0, `zero-amount pair not flagged (got ${n})`);

  console.log("\n=== Calibration v2 ===\n");
  freshDb();
  upsertVendor({ id: "vnd-cal", canonicalName: "Cal", aliases: ["Cal"], trustScore: 0.95, firstSeen: "2024-01-01", lastSeen: "2024-06-30" });
  insertFinancialRecord(rec({ id: "c1", vendorId: "vnd-cal", amount: 1000, date: "2024-06-10", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "x", status: "cleared" }));
  insertFinancialRecord(rec({ id: "c2", vendorId: "vnd-cal", amount: 1000, date: "2024-06-15", periodStart: "2024-06-01", periodEnd: "2024-06-30", description: "x", status: "cleared" }));
  n = await runAgent("duplicate-payments");
  assert(n === 1, `setup: produced 1 finding (got ${n})`);
  const finding = getFindings().find((f) => f.status === "open");
  if (!finding) { console.error("  FAIL: no open finding for calibration test"); failed++; }
  else {
    const startFloor = getCalibration(finding.agentType, finding.vendorId)?.thresholdOverride ?? 0.7;
    await submitFeedback(finding.id, "dismiss", "manual review OK");
    const after1 = getCalibration(finding.agentType, finding.vendorId)?.thresholdOverride ?? startFloor;
    assert(after1 > startFloor, `dismiss raises floor (${startFloor} -> ${after1})`);
    await submitFeedback(finding.id, "dismiss", "manual review OK");
    const after2 = getCalibration(finding.agentType, finding.vendorId)?.thresholdOverride ?? after1;
    assert(after2 >= after1, `2nd dismiss keeps floor raised (${after1} -> ${after2})`);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
