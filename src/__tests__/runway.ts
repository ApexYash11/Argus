/**
 * Slice 3 verification: spend & burn math (pure functions, no DB).
 * Run: bun src/__tests__/runway.ts
 */
import { computeBurn, yearlySavings } from "../engine/runway";
import type { FinancialRecord } from "../model/types";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

function rec(partial: Partial<FinancialRecord> & { date: string; amount: number }): FinancialRecord {
  return {
    id: Math.random().toString(36).slice(2),
    type: "payment",
    vendorId: "v1",
    currency: "INR",
    status: "cleared",
    raw: "{}",
    ingestedAt: new Date().toISOString(),
    ...partial,
  } as FinancialRecord;
}

async function main() {
  console.log("=== Runway verification ===\n");
  const asOf = new Date(Date.UTC(2026, 8, 15)); // 2026-09-15: Sep is partial

  // 3 complete months: Jun 100, Jul 100, Aug 160 → avg 120, trend +33.3%
  const records = [
    rec({ date: "2026-06-05", amount: 60 }), rec({ date: "2026-06-20", amount: 40 }),
    rec({ date: "2026-07-11", amount: 100 }),
    rec({ date: "2026-08-02", amount: 160 }),
    rec({ date: "2026-09-01", amount: 9999 }), // partial month Ignored
  ];
  const out = computeBurn(records, [], asOf);
  assert(out.ok === true, "ok with 3 complete months");
  assert(out.avgMonthlyBurn === 120, `avg is 120 (got ${out.avgMonthlyBurn})`);
  assert(out.monthCount === 3, "monthCount is 3");
  assert(out.lastMonthLabel === "2026-08" && out.lastMonthTotal === 160, "last month is Aug=160");
  assert(out.trendPct === 33.3, `trend +33.3% (got ${out.trendPct})`);

  // Expenses count, zero/negative/refunds and non-spend types don't
  const mixed = [
    rec({ date: "2026-06-05", amount: 50 }),
    rec({ date: "2026-06-06", amount: 50, type: "expense" }),
    rec({ date: "2026-07-05", amount: 100 }),
    rec({ date: "2026-07-06", amount: -20 }),
    rec({ date: "2026-07-07", amount: 0 }),
    rec({ date: "2026-06-07", amount: 500, type: "subscription" }),
    rec({ date: "2026-08-05", amount: 100 }),
    rec({ date: "not-a-date", amount: 100 }),
  ];
  const mixedOut = computeBurn(mixed, [], asOf);
  assert(mixedOut.ok === true && mixedOut.avgMonthlyBurn === 100, `only payment+expense positive count (got ${mixedOut.avgMonthlyBurn})`);

  // < 2 complete months → graceful
  const thin = computeBurn([rec({ date: "2026-08-05", amount: 10 })], [], asOf);
  assert(thin.ok === false && !!thin.reason, "graceful with <2 months");

  // Commitments: future counts, past doesn't
  const com = computeBurn(records, [
    rec({ date: "2026-10-01", amount: 380, type: "commitment" }),
    rec({ date: "2026-01-01", amount: 999, type: "commitment" }),
  ], asOf);
  assert(com.committedTotal === 380, `committed upcoming 380 (got ${com.committedTotal})`);

  assert(yearlySavings(100000) === 1200000, "yearly savings math");
  assert(yearlySavings(-5) === 0, "negative cut clamps to 0");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
