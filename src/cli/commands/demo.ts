/**
 * Bootstrap a workspace with bundled sample data. Used by the first-run wizard
 * and `argus demo` (kept as a pure helper so it's testable).
 */
import fs from "fs";
import path from "path";
import { ingestFile } from "./ingest";
import { investigate } from "./investigate";

const SAMPLE_DIR = path.resolve("test-data");

export interface DemoResult {
  workspace: string;
  ingested: number;
  findings: number;
  files: string[];
  errors: string[];
}

export async function runDemo(workspace: string): Promise<DemoResult> {
  const files: string[] = [];
  const errors: string[] = [];
  if (!fs.existsSync(SAMPLE_DIR)) {
    return { workspace, ingested: 0, findings: 0, files, errors: [`sample dir missing: ${SAMPLE_DIR}`] };
  }
  for (const f of fs.readdirSync(SAMPLE_DIR)) {
    if (!f.endsWith(".csv")) continue;
    files.push(f);
    const stream = await ingestFile(workspace, path.join(SAMPLE_DIR, f));
    for await (const ev of stream) {
      if (ev.type === "step" && /error|fail/i.test(ev.message)) errors.push(`${f}: ${ev.message}`);
    }
  }
  const stream = await investigate(workspace);
  let findings = 0;
  for await (const ev of stream) {
    if (ev.type === "finding") findings++;
  }
  const recCount = files.length;
  return { workspace, ingested: recCount, findings, files, errors };
}
