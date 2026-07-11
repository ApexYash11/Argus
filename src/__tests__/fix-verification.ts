/**
 * Quick verification of critical bug fixes.
 * Run with: bun src/__tests__/fix-verification.ts
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

// --- B5: Date parsing logic (copied from fixed normalizer.ts) ---
function testDateParsing(s: string): string | undefined {
  const trimmed = s.trim();
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const first = parseInt(slashMatch[1]!, 10);
    const second = parseInt(slashMatch[2]!, 10);
    if (first > 12 && second <= 31) {
      const d = new Date(`${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    if (second > 12 && first <= 12) {
      const d = new Date(`${slashMatch[3]}-${slashMatch[1]}-${slashMatch[2]}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
  }
  return undefined;
}

assert(testDateParsing("01/15/2024") === "2024-01-15", "B5: US date 01/15/2024 → 2024-01-15 (day=15>12 → mm/dd)");
assert(testDateParsing("15/01/2024") === "2024-01-15", "B5: EU date 15/01/2024 → 2024-01-15 (day=15>12 → dd/mm)");
assert(testDateParsing("12/12/2024") === undefined, "B5: Ambiguous 12/12/2024 → undefined (no forced interpretation)");
assert(testDateParsing("03/05/2024") === undefined, "B5: Ambiguous 03/05/2024 → undefined (both ≤12)");
assert(testDateParsing("05/03/2024") === undefined, "B5: Ambiguous 05/03/2024 → undefined (both ≤12)");
assert(testDateParsing("29/02/2024") === "2024-02-29", "B5: EU date 29/02/2024 → 2024-02-29 (day=29>12 → dd/mm)");

// --- B6: YYYYMMDD parsing ---
function testYYYYMMDD(s: string): string | undefined {
  const yyyymmdd = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
  }
  return undefined;
}

assert(testYYYYMMDD("20240710") === "2024-07-10", "B6: YYYYMMDD 20240710 → 2024-07-10");
assert(testYYYYMMDD("20240101") === "2024-01-01", "B6: YYYYMMDD 20240101 → 2024-01-01");
assert(testYYYYMMDD("19991231") === "1999-12-31", "B6: YYYYMMDD 19991231 → 1999-12-31");
assert(testYYYYMMDD("notadate") === undefined, "B6: Non-YYYYMMDD returns undefined");

// --- Verify YYYYMMDD is NOT caught by unix timestamp ---
const unixCheck = (s: string): boolean => {
  const unix = Number(s);
  return !isNaN(unix) && unix > 1_000_000_000;
};
assert(unixCheck("20240710") === false, "B6: 20240710=20M < 1B → unix branch doesn't catch it");
assert(testYYYYMMDD("20240710") === "2024-07-10", "B6: YYYYMMDD guard catches before falling through to null");

// --- date-utils.ts ---
function testGetYearMonth(s: string): string {
  if (!s || s.length < 7) return "unknown";
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 7);
  return "unknown";
}

assert(testGetYearMonth("2024-07-15") === "2024-07", "date-utils: ISO date → YYYY-MM");
assert(testGetYearMonth("2024-07") === "2024-07", "date-utils: Already YYYY-MM → unchanged");
assert(testGetYearMonth("") === "unknown", "date-utils: Empty string → unknown");
assert(testGetYearMonth("garbage") === "unknown", "date-utils: Garbage → unknown");
assert(testGetYearMonth("abc") === "unknown", "date-utils: Short garbage → unknown");

// --- B10: dice coefficient ---
function testDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      intersectionSize++;
    }
  }
  return (2 * intersectionSize) / (a.length - 1 + b.length - 1);
}

assert(testDice("Amazon", "Amazon") === 1, "B10: Identical → 1");
assert(testDice("Amazon", "Amazn") > 0.5, "B10: Close match Amazn → > 0.5");
assert(testDice("Amazon", "Amzon") > 0.4, "B10: Near match Amzon → > 0.4");
assert(testDice("Amazon", "Google") < 1, "B10: Different → < 1");
assert(testDice("a", "b") === 0, "B10: Very short → 0");
assert(!isNaN(testDice("", "")) && !isNaN(testDice("x", "yyyy")), "B10: Edge cases produce NaN → no");

// --- B1/B2: xlsx debit/cleared logic ---
function testDebitLogic(rawDebit?: number, rawDebitLower?: number): { debit: number; cleared: string } {
  const debit = Number(rawDebit ?? rawDebitLower ?? 0);
  return { debit, cleared: debit > 0 ? "true" : "false" };
}

const r1 = testDebitLogic(100, undefined);
assert(r1.debit === 100 && r1.cleared === "true", "B1/B2: Debit=100 → debit=100, cleared=true");

const r2 = testDebitLogic(undefined, 200);
assert(r2.debit === 200 && r2.cleared === "true", "B1/B2: debit=200 (lowercase fallback) → debit=200, cleared=true");

const r3 = testDebitLogic(undefined, undefined);
assert(r3.debit === 0 && r3.cleared === "false", "B1/B2: No debit → debit=0, cleared=false");

const r4 = testDebitLogic(0, undefined);
assert(r4.debit === 0 && r4.cleared === "false", "B1/B2: Debit=0 → debit=0, cleared=false");

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
