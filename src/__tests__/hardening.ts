/**
 * Hardening verification: malformed CSV, Unicode, concurrent writers.
 * Run: bun src/__tests__/hardening.ts
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { initWorkspace } from "../cli/commands/init";
import { initDb, closeDb, getDb } from "../db/index";
import { ingestFile } from "../cli/commands/ingest";

let passed = 0;
let failed = 0;
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

function mkTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-hard-"));
  return dir;
}

async function drain(stream: AsyncGenerator<any>): Promise<string[]> {
  const msgs: string[] = [];
  for await (const ev of stream) {
    if (ev.type === "step") msgs.push(ev.message);
  }
  return msgs;
}

async function main() {
  console.log("=== Hardening ===\n");

  // 1. Malformed CSV: BOM, blank lines, bad quotes, extra cols, unicode
  const dir = mkTemp();
  await initWorkspace(dir, "Hard Co");
  const bad = "\uFEFFdate,vendor_name,amount,reference,cleared\n" +
    "\n" +
    "2025-03-05,Zürich Café Pvt Ltd,1200,INV-1,yes\n" +
    "2025-03-06,\"Broken \"\"quote\"\" vendor\",2500,INV-2,yes,EXTRA_COL\n" +
    "not-a-date,No Date Vendor,300,INV-3,yes\n" +
    "2025-03-07,Empty Amount,,INV-4,yes\n" +
    "2025-03-08,Zero Vendor,0,INV-5,yes\n" +
    "\n";
  const badPath = path.join(dir, "bad.csv");
  fs.writeFileSync(badPath, bad, "utf-8");
  let threw = false;
  let msgs: string[] = [];
  try {
    msgs = await drain(await ingestFile(dir, badPath));
  } catch {
    threw = true;
  }
  assert(!threw, "malformed CSV does not throw");
  const count = (getDb().query("SELECT COUNT(*) as c FROM financial_records").get() as { c: number }).c;
  assert(count >= 2, `partial rows ingested despite bad rows (got ${count})`);
  closeDb();

  // 2. Concurrent writers: two processes ingesting different files
  const dir2 = mkTemp();
  await initWorkspace(dir2, "Race Co");
  closeDb();
  const a = path.join(dir2, "a.csv");
  const b = path.join(dir2, "b.csv");
  fs.writeFileSync(a, "date,vendor_name,amount,reference,cleared\n2025-01-05,Alpha,100,A1,yes\n2025-01-06,Alpha,200,A2,yes\n");
  fs.writeFileSync(b, "date,vendor_name,amount,reference,cleared\n2025-02-05,Beta,300,B1,yes\n2025-02-06,Beta,400,B2,yes\n");
  const run = (file: string) => new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn("bun", ["run", "src/cli/index.tsx", "--dir", dir2, "ingest", file], { cwd: "D:\\Argus" });
    let out = "";
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
  const [r1, r2] = await Promise.all([run(a), run(b)]);
  assert(r1.code === 0 && r2.code === 0, `concurrent ingests both exit 0 (got ${r1.code}, ${r2.code})`);
  initDb(dir2);
  const total = (getDb().query("SELECT COUNT(*) as c FROM financial_records").get() as { c: number }).c;
  assert(total === 4, `all 4 rows present after race (got ${total})`);
  closeDb();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
