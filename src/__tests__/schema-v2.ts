/**
 * Schema-detector v2 verification (pure, no DB, no network).
 * Run: bun src/__tests__/schema-v2.ts
 */
import { deterministicFallback } from "../ingest/schema-detector";
import type { ColumnStats } from "../model/types";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

function stats(name: string, o: Partial<ColumnStats> = {}): ColumnStats {
  return {
    columnName: name,
    numeric_ratio: 0,
    looks_like_date: false,
    looks_like_amount: false,
    null_count: 0,
    distinct_count: 10,
    empty_ratio: 0,
    min: null,
    max: null,
    common_prefix: "",
    sample_values: [],
    ...o,
  } as ColumnStats;
}

async function main() {
  console.log("=== Schema-detector v2 ===\n");

  // 1. Real-world non-canonical headers map via broadened keywords
  const r1 = deterministicFallback(
    ["payee_name", "check_date", "amount_paid", "check_number"],
    "nyc.csv",
    [
      stats("payee_name", { distinct_count: 500 }),
      stats("check_date", { looks_like_date: true }),
      stats("amount_paid", { numeric_ratio: 0.99, looks_like_amount: true }),
      stats("check_number", { distinct_count: 900 }),
    ]
  );
  assert(r1.vendor_col === "payee_name", `payee_name -> vendor (got ${r1.vendor_col})`);
  assert(r1.date_col === "check_date", `check_date -> date (got ${r1.date_col})`);
  assert(r1.amount_col === "amount_paid", `amount_paid -> amount (got ${r1.amount_col})`);
  assert(r1.reference_col === "check_number", `check_number -> reference (got ${r1.reference_col})`);

  // 2. Symbol-only headers: must NOT force Symbol into amount/date
  const r2 = deterministicFallback(
    ["Symbol", "Security Name"],
    "nasdaq.csv",
    [
      stats("Symbol", { numeric_ratio: 0, distinct_count: 5000 }),
      stats("Security Name", { numeric_ratio: 0, distinct_count: 5000 }),
    ]
  );
  assert(r2.amount_col === null, `no amount forced (got ${r2.amount_col})`);
  assert(r2.date_col === null, `no date forced (got ${r2.date_col})`);
  assert(r2.warnings.some((w) => /No vendor|No date|inferred/i.test(w)), "warnings explain the gap");

  // 3. Numeric column with no keyword -> inferred from content
  const r3 = deterministicFallback(
    ["counterparty", "value_usd", "posted"],
    "bank.csv",
    [
      stats("counterparty", { distinct_count: 300 }),
      stats("value_usd", { numeric_ratio: 1, looks_like_amount: true }),
      stats("posted", { looks_like_date: true }),
    ]
  );
  assert(r3.amount_col === "value_usd", `content-inferred amount (got ${r3.amount_col})`);
  assert(r3.date_col === "posted", `posted -> date via keyword (got ${r3.date_col})`);
  assert(r3.warnings.some((w) => /inferred from content/.test(w)), "inference warning present");

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
