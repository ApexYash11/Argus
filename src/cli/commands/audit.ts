import fs from "fs";
import path from "path";
import type { AuditEvent, AgentType, Severity, SchemaDetectionResult } from "../../model/types";
import { inspectFile } from "../../ingest/file-inspector";
import { sampleRows } from "../../ingest/smart-sampler";
import { detectSchema } from "../../ingest/schema-detector";
import { ingestFile } from "./ingest";
import { investigate } from "./investigate";
import { initScratchpad, pruneScratchpad } from "../../engine/scratchpad";
import { getCacheStats } from "../../ingest/schema-detector";

const SUPPORTED_EXTS = new Set([".csv", ".xlsx", ".pdf"]);

type FileSig = Record<string, { mtimeMs: number; size: number }>;

function manifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".audit", "last-ingest.json");
}

function fileSignature(files: string[]): FileSig {
  const sig: FileSig = {};
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      sig[path.resolve(f)] = { mtimeMs: Math.round(st.mtimeMs), size: st.size };
    } catch {
      sig[path.resolve(f)] = { mtimeMs: -1, size: -1 };
    }
  }
  return sig;
}

function signaturesEqual(a: FileSig, b: FileSig): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a[k]!.mtimeMs === b[k]!.mtimeMs && a[k]!.size === b[k]!.size);
}

function readIngestManifest(workspaceDir: string): { files: FileSig } | null {
  try {
    const raw = fs.readFileSync(manifestPath(workspaceDir), "utf-8");
    const parsed = JSON.parse(raw) as { files?: FileSig };
    if (!parsed || typeof parsed.files !== "object") return null;
    return { files: parsed.files };
  } catch {
    return null;
  }
}

function writeIngestManifest(workspaceDir: string, files: FileSig): void {
  try {
    fs.mkdirSync(path.join(workspaceDir, ".audit"), { recursive: true });
    fs.writeFileSync(manifestPath(workspaceDir), JSON.stringify({ files, ingestedAt: new Date().toISOString() }));
  } catch {
    // manifest is best-effort
  }
}

function scanDirectory(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) walk(fullPath);
      } else if (SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results.sort();
}

interface FileClassification {
  filePath: string;
  dataType: string;
  confidence: number;
  warnings: string[];
  schema: SchemaDetectionResult;
}

async function classifyFile(filePath: string, forceRefresh?: boolean): Promise<FileClassification> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    return {
      filePath,
      dataType: "invoices",
      confidence: 0.5,
      warnings: ["PDF classification is a best guess based on extension"],
      schema: {
        vendor_col: null,
        amount_col: null,
        amount_col_credit: null,
        date_col: null,
        reference_col: null,
        description_col: null,
        currency_col: null,
        data_type: "invoices",
        expense_rows_only: false,
        confidence: 0.5,
        reasoning: "PDF extension heuristic",
        warnings: ["PDF classification is a best guess based on extension"],
      },
    };
  }

  const inspection = inspectFile(filePath);
  if (inspection.totalDataRows === 0 || inspection.headers.length === 0) {
    return {
      filePath,
      dataType: "unknown",
      confidence: 0,
      warnings: inspection.warnings.length > 0 ? inspection.warnings : ["No data rows or headers found"],
      schema: {
        vendor_col: null, amount_col: null, amount_col_credit: null,
        date_col: null, reference_col: null, description_col: null,
        currency_col: null, data_type: "unknown", expense_rows_only: false,
        confidence: 0, reasoning: "Unreadable file", warnings: [],
      },
    };
  }

  const { sampledRows, columnStats } = sampleRows(inspection.headers, inspection.allRows, inspection.totalDataRows);
  const schema = await detectSchema(inspection.headers, sampledRows, columnStats, filePath, forceRefresh);

  return {
    filePath,
    dataType: schema.data_type,
    confidence: schema.confidence,
    warnings: schema.warnings ?? [],
    schema,
  };
}

export async function* audit(
  auditPath: string,
  options: { dryRun?: boolean; nonInteractive?: boolean; forceRefresh?: boolean; agentType?: AgentType; webhookUrl?: string; alertMin?: Severity } = {}
): AsyncGenerator<AuditEvent> {
  const resolvedPath = path.resolve(auditPath);
  const isDir = fs.statSync(resolvedPath).isDirectory();
  const searchPath = isDir ? resolvedPath : path.dirname(resolvedPath);
  const singleFile = isDir ? null : resolvedPath;

  const auditStartTime = performance.now();
  initScratchpad(resolvedPath);

  yield { type: "step", agent: "audit", message: `Scanning ${searchPath} for financial data files...` };

  const candidates = singleFile ? [singleFile] : scanDirectory(searchPath);
  if (candidates.length === 0) {
    yield { type: "step", agent: "audit", message: "No supported files found (.csv, .xlsx, .pdf)." };
    yield { type: "done", totalFindings: 0, durationMs: 0 };
    return;
  }

  yield { type: "step", agent: "audit", message: `Found ${candidates.length} candidate file(s)` };

  const classified: FileClassification[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const fp = candidates[i]!;
    yield { type: "step", agent: "audit", message: `[${i + 1}/${candidates.length}] Classifying ${path.basename(fp)}...` };
    try {
      const result = await classifyFile(fp, options.forceRefresh);
      classified.push(result);
      yield {
        type: "step", agent: "audit",
        message: `  ${path.basename(fp)} → ${result.dataType} (${(result.confidence * 100).toFixed(0)}% confidence)`,
      };
    } catch (err: any) {
      yield { type: "step", agent: "audit", message: `  ${path.basename(fp)} → classification failed: ${err.message}` };
    }
  }

  if (options.dryRun) {
    yield { type: "step", agent: "audit", message: "" };
    yield { type: "step", agent: "audit", message: "=== Classification Summary (dry-run) ===" };
    for (const c of classified) {
      yield { type: "step", agent: "audit", message: `${path.basename(c.filePath)}` };
      yield { type: "step", agent: "audit", message: `  Type:       ${c.dataType}` };
      yield { type: "step", agent: "audit", message: `  Confidence: ${(c.confidence * 100).toFixed(0)}%` };
      for (const w of c.warnings.slice(0, 3)) {
        yield { type: "step", agent: "audit", message: `  Warning:    ${w}` };
      }
    }
    yield { type: "step", agent: "audit", message: `Dry-run complete. ${classified.length} file(s) classified.` };
    yield { type: "done", totalFindings: 0, durationMs: 0 };
    return;
  }

  const knownFiles = classified.filter((c) => c.dataType !== "unknown");
  const unknownFiles = classified.filter((c) => c.dataType === "unknown");
  if (unknownFiles.length > 0) {
    yield { type: "step", agent: "audit", message: `${unknownFiles.length} unclassified file(s) skipped:` };
    for (const uf of unknownFiles) {
      yield { type: "step", agent: "audit", message: `  ${path.basename(uf.filePath)} — type unknown, confidence ${(uf.confidence * 100).toFixed(0)}%` };
    }
  }

  let ingestCount = 0;
  const qualityFlagTotals = new Map<string, number>();

  // Idempotency: skip re-ingesting files that haven't changed since the last
  // audit of this workspace. `audit --share` on unchanged data then finishes
  // in seconds instead of re-running the whole pipeline.
  const manifest = readIngestManifest(resolvedPath);
  const currentSig = fileSignature(knownFiles.map((c) => c.filePath));
  const unchanged = !options.forceRefresh && manifest !== null && signaturesEqual(manifest.files, currentSig);
  const toIngest = unchanged ? [] : knownFiles;
  if (unchanged && knownFiles.length > 0) {
    yield { type: "step", agent: "audit", message: `0 new/changed files — reusing existing records (use --force to re-ingest).` };
  }
  for (let i = 0; i < toIngest.length; i++) {
    const c = toIngest[i]!;
    yield { type: "step", agent: "audit", message: `[${i + 1}/${toIngest.length}] Ingesting ${path.basename(c.filePath)}...` };
    try {
      const ingestStream = await ingestFile(resolvedPath, c.filePath);
      for await (const event of ingestStream) {
        if (event.type === "step") {
          if (event.message.startsWith("Quality flags:")) {
            for (const part of event.message.replace("Quality flags: ", "").split(", ")) {
              const [flag, countStr] = part.split(":");
              if (flag && countStr) {
                qualityFlagTotals.set(flag, (qualityFlagTotals.get(flag) ?? 0) + parseInt(countStr, 10));
              }
            }
          }
          yield { type: "step", agent: "audit", message: `  ${event.message}` };
        }
      }
      ingestCount++;
    } catch (err: any) {
      yield { type: "step", agent: "audit", message: `  Ingest failed: ${err.message}` };
    }
  }

  yield { type: "step", agent: "audit", message: `Ingested ${ingestCount}/${toIngest.length} new file(s). Starting investigation...` };

  let totalFindings = 0;
  try {
    const investigateStream = await investigate(resolvedPath, options.agentType, false, {
      webhookUrl: options.webhookUrl,
      alertMin: options.alertMin,
    });
    for await (const event of investigateStream) {
      if (event.type === "step") {
        yield { type: "step", agent: "audit", message: `  ${event.message}` };
      } else if (event.type === "finding") {
        yield event;
        totalFindings++;
      } else if (event.type === "done") {
        totalFindings = event.totalFindings ?? totalFindings;
        yield { type: "step", agent: "audit", message: `Investigation complete: ${totalFindings} finding(s)` };
      }
    }
  } catch (err: any) {
    yield { type: "step", agent: "audit", message: `Investigation error: ${err.message}` };
  }

  pruneScratchpad(resolvedPath);

  if (!unchanged && ingestCount > 0) {
    writeIngestManifest(resolvedPath, currentSig);
  }

  yield { type: "step", agent: "audit", message: "" };
  yield { type: "step", agent: "audit", message: "=== Audit Summary ===" };
  yield { type: "step", agent: "audit", message: `Files discovered:  ${candidates.length}` };
  yield { type: "step", agent: "audit", message: `Files classified:  ${classified.length}` };
  yield { type: "step", agent: "audit", message: `Files ingested:    ${ingestCount}` };
  yield { type: "step", agent: "audit", message: `Findings (new):    ${totalFindings} (see \`argus findings\` for all)` };
  if (qualityFlagTotals.size > 0) {
    const qualitySummary = [...qualityFlagTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f, c]) => `${f}:${c}`)
      .join(", ");
    yield { type: "step", agent: "audit", message: `Quality flags:     ${qualitySummary}` };
  }
  const elapsedMs = Math.round(performance.now() - auditStartTime);
  const elapsed = elapsedMs >= 60000 ? `${(elapsedMs / 60000).toFixed(1)} min` : `${elapsedMs} ms`;
  yield { type: "step", agent: "audit", message: `Elapsed time:      ${elapsed}` };
  const cacheStats = getCacheStats();
  yield { type: "step", agent: "audit", message: `Schema cache:      ${cacheStats.hits} hit(s), ${cacheStats.misses} miss(es)` };
  yield { type: "step", agent: "audit", message: "" };
  yield { type: "step", agent: "audit", message: "Next steps:" };
  yield { type: "step", agent: "audit", message: "  argus audit --share   forwardable HTML report" };
  yield { type: "step", agent: "audit", message: "  argus digest           weekly markdown summary" };
  yield { type: "step", agent: "audit", message: "  argus status           system health + spend & burn" };
  yield { type: "done", totalFindings, durationMs: elapsedMs };
}
