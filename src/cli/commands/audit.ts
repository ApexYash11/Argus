import fs from "fs";
import path from "path";
import type { AuditEvent, SchemaDetectionResult } from "../../model/types";
import { inspectFile } from "../../ingest/file-inspector";
import { sampleRows } from "../../ingest/smart-sampler";
import { detectSchema } from "../../ingest/schema-detector";
import { ingestFile } from "./ingest";
import { investigate } from "./investigate";
import { initScratchpad, pruneScratchpad } from "../../engine/scratchpad";

const SUPPORTED_EXTS = new Set([".csv", ".xlsx", ".pdf"]);

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

async function classifyFile(filePath: string): Promise<FileClassification> {
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
  const schema = await detectSchema(inspection.headers, sampledRows, columnStats, filePath);

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
  options: { dryRun?: boolean; nonInteractive?: boolean } = {}
): AsyncGenerator<AuditEvent> {
  const resolvedPath = path.resolve(auditPath);
  const isDir = fs.statSync(resolvedPath).isDirectory();
  const searchPath = isDir ? resolvedPath : path.dirname(resolvedPath);
  const singleFile = isDir ? null : resolvedPath;

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
  for (const fp of candidates) {
    yield { type: "step", agent: "audit", message: `Classifying ${path.basename(fp)}...` };
    try {
      const result = await classifyFile(fp);
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

  const unknownFiles = classified.filter((c) => c.dataType === "unknown");
  if (unknownFiles.length > 0) {
    yield { type: "step", agent: "audit", message: `${unknownFiles.length} file(s) could not be classified (type=unknown).` };
    for (const uf of unknownFiles) {
      yield { type: "step", agent: "audit", message: `  ${path.basename(uf.filePath)}` };
    }
    if (options.nonInteractive) {
      yield { type: "step", agent: "audit", message: "Ambiguous classification — aborting (non-interactive mode)." };
      return;
    }
  }

  let ingestCount = 0;
  for (const c of classified) {
    yield { type: "step", agent: "audit", message: `Ingesting ${path.basename(c.filePath)}...` };
    try {
      const ingestStream = await ingestFile(resolvedPath, c.filePath);
      for await (const event of ingestStream) {
        if (event.type === "step") {
          yield { type: "step", agent: "audit", message: `  ${event.message}` };
        }
      }
      ingestCount++;
    } catch (err: any) {
      yield { type: "step", agent: "audit", message: `  Ingest failed: ${err.message}` };
    }
  }

  yield { type: "step", agent: "audit", message: `Ingested ${ingestCount}/${classified.length} files. Starting investigation...` };

  let totalFindings = 0;
  try {
    const investigateStream = await investigate(resolvedPath);
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

  yield { type: "step", agent: "audit", message: "" };
  yield { type: "step", agent: "audit", message: "=== Audit Summary ===" };
  yield { type: "step", agent: "audit", message: `Files discovered:  ${candidates.length}` };
  yield { type: "step", agent: "audit", message: `Files classified:  ${classified.length}` };
  yield { type: "step", agent: "audit", message: `Files ingested:    ${ingestCount}` };
  yield { type: "step", agent: "audit", message: `Findings:          ${totalFindings}` };
  yield { type: "done", totalFindings, durationMs: 0 };
}
