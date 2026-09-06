import path from "path";
import crypto from "crypto";
import type { AuditEvent, SchemaDetectionResult } from "../../model/types";
import { parseCsvFile } from "../../ingest/csv-parser";
import { parseXlsxFile } from "../../ingest/xlsx-parser";
import { normalizeRecord, normalizeUsageRecord } from "../../ingest/normalizer";
import { universalNormalize, resetDateLocaleCache } from "../../ingest/universal-normalizer";
import { inspectFile } from "../../ingest/file-inspector";
import { sampleRows } from "../../ingest/smart-sampler";
import { detectSchema } from "../../ingest/schema-detector";
import { extractPdf, extractInvoiceFields } from "../../ingest/pdf-extractor";
import { insertFinancialRecord, insertUsageRecord } from "../../db/queries";
import { getDb, withTransaction } from "../../db/index";
import { writeScratchpadEntry, writeScratchpadEntries, initScratchpad } from "../../engine/scratchpad";
import { clearVendorCache } from "../../ingest/vendor-resolver";

export interface IngestOptions {
  type?: string;
  force?: boolean;
  dryRun?: boolean;
}

export async function ingestFile(
  cwd: string,
  filePath: string,
  options: IngestOptions = {}
): Promise<AsyncGenerator<AuditEvent>> {
  async function* gen(): AsyncGenerator<AuditEvent> {
    const absPath = path.resolve(filePath);
    const ext = path.extname(absPath).toLowerCase();

    initScratchpad(cwd);
    clearVendorCache();

    if (ext === ".pdf") {
      yield* oldPipeline(absPath, options.type);
      return;
    }

    yield* newPipeline(absPath, options);
  }

  return gen();
}

async function* oldPipeline(filePath: string, type?: string): AsyncGenerator<AuditEvent> {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  writeScratchpadEntry({ type: "ingest_start", message: `Ingesting ${filename}` });
  yield { type: "step", agent: "ingest", message: `Ingesting ${filename}...` };

  if (ext === ".csv" || ext === ".xlsx") {
    const result = ext === ".xlsx" ? parseXlsxFile(filePath) : parseCsvFile(filePath, type);

    for (const err of result.errors) {
      writeScratchpadEntry({ type: "parse_error", message: `Line ${err.line}: ${err.message}` });
    }

    yield { type: "step", agent: "ingest", message: `Parsed ${result.records.length} records, ${result.errors.length} errors` };

    if (result.errors.length > 0 && result.records.length === 0) {
      yield { type: "step", agent: "ingest", message: "All rows failed validation. Aborting." };
      writeScratchpadEntry({ type: "ingest_abort", message: "All rows failed validation" });
      yield { type: "done", totalFindings: 0, durationMs: 0 };
      return;
    }

    let ingestedCount = 0;

    const before = result.records.length;
    const seen = new Set<string>();
    result.records = result.records.filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const dupes = before - result.records.length;
    if (dupes > 0) {
      yield { type: "step", agent: "ingest", message: `Removed ${dupes} duplicate rows before ingest` };
    }

    for (const raw of result.records) {
      try {
        const usageRecord = normalizeUsageRecord(raw);
        if (usageRecord) {
          const id = `USAGE-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
          insertUsageRecord({
            id,
            employeeEmail: usageRecord.employeeEmail,
            tool: usageRecord.tool,
            lastLogin: usageRecord.lastLogin,
            vendorId: usageRecord.vendorId,
            ingestedAt: new Date().toISOString(),
          });
          yield { type: "evidence_found", key: id, value: `Usage: ${usageRecord.employeeEmail} → ${usageRecord.tool} (last: ${usageRecord.lastLogin})`, sourceDocId: id };
          ingestedCount++;
          writeScratchpadEntry({ type: "record_ingested", message: `Usage: ${usageRecord.employeeEmail} → ${usageRecord.tool}` });
          continue;
        }

        const { record, vendorResolution } = normalizeRecord(raw);
        yield { type: "evidence_found", key: record.id, value: `${vendorResolution.canonicalName} — ${record.amount} ${record.currency}`, sourceDocId: record.id };
        insertFinancialRecord(record);
        ingestedCount++;
        writeScratchpadEntry({ type: "record_ingested", message: `${vendorResolution.canonicalName} | ${record.amount} ${record.currency} | resolved via ${vendorResolution.method}` });
      } catch (err) {
        yield { type: "step", agent: "ingest", message: `Skipped row — ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    yield { type: "step", agent: "ingest", message: `Ingested ${ingestedCount} records from ${filename}` };

  } else if (ext === ".pdf") {
    yield { type: "step", agent: "ingest", message: `Extracting PDF: ${filename}...` };

    const pdfResult = await extractPdf(filePath);
    if (pdfResult.error) {
      yield { type: "step", agent: "ingest", message: `PDF error: ${pdfResult.error}` };
      yield { type: "done", totalFindings: 0, durationMs: 0 };
      return;
    }

    yield { type: "step", agent: "ingest", message: `Extracted ${pdfResult.pages} page(s) via ${pdfResult.method} (${pdfResult.text.length} chars)` };

    const fields = await extractInvoiceFields(filePath);
    const hasVendor = !!fields.vendorName;
    const hasAmount = !!fields.amount && fields.amount > 0;
    if (hasVendor && hasAmount) {
      const mockRaw = {
        _raw: JSON.stringify(fields),
        _line: 0,
        _type: "invoices",
        vendor_name: fields.vendorName!,
        amount: fields.amount!,
        date: fields.date ?? new Date().toISOString().slice(0, 10),
        description: `Invoice ${fields.invoiceNumber ?? "unknown"}`,
        cleared: true,
      };

      const { record, vendorResolution } = normalizeRecord(mockRaw);
      insertFinancialRecord(record);
      yield { type: "evidence_found", key: record.id, value: `Invoice: ${vendorResolution.canonicalName} — ${record.amount} ${record.currency}`, sourceDocId: record.id };
      yield { type: "step", agent: "ingest", message: `Ingested invoice: ${vendorResolution.canonicalName} — ${record.amount}` };
    } else {
      const db = getDb();
      db.run("INSERT INTO documents (id, filename, type, record_count, extracted_text) VALUES ($id, $filename, 'pdf', 0, $text)", {
        $id: `DOC-${Date.now().toString(36).toUpperCase()}`,
        $filename: filename,
        $text: pdfResult.text.slice(0, 10000),
      });
      yield { type: "step", agent: "ingest", message: "Stored as document (no structured fields extracted)" };
    }

  } else {
    yield { type: "step", agent: "ingest", message: `Unsupported file type: ${ext}. Use .csv, .xlsx, or .pdf` };
    yield { type: "done", totalFindings: 0, durationMs: 0 };
    return;
  }

  yield { type: "done", totalFindings: 0, durationMs: 0 };
}

async function* newPipeline(filePath: string, options: IngestOptions): AsyncGenerator<AuditEvent> {
  const filename = path.basename(filePath);
  writeScratchpadEntry({ type: "ingest_start", message: `Ingesting ${filename}` });
  yield { type: "step", agent: "ingest", message: `Ingesting ${filename}...` };

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".csv" && ext !== ".xlsx") {
    yield { type: "step", agent: "ingest", message: `Unsupported file type. Fallback to old pipeline.` };
    yield* oldPipeline(filePath, options.type);
    return;
  }

  // Step 1: Inspect
  yield { type: "step", agent: "ingest", message: "Inspecting file..." };
  const inspection = inspectFile(filePath);
  for (const w of inspection.warnings) {
    yield { type: "step", agent: "ingest", message: `Warning: ${w}` };
  }

  if (inspection.totalDataRows === 0) {
    if (inspection.headers.length > 0) {
      yield { type: "step", agent: "ingest", message: "File has headers but no data rows. Aborting." };
    } else if (inspection.warnings.length > 0) {
      yield { type: "step", agent: "ingest", message: `File inspection failed: ${inspection.warnings[0]}. Falling back to old pipeline.` };
      yield* oldPipeline(filePath, options.type);
      return;
    }
    yield { type: "done", totalFindings: 0, durationMs: 0 };
    return;
  }

  yield {
    type: "step",
    agent: "ingest",
    message: `Delimiter: ${inspection.delimiter === "\t" ? "tab" : inspection.delimiter} | Encoding: ${inspection.encoding} | Rows: ${inspection.totalDataRows} | Headers: ${inspection.headers.length}`,
  };

  // Step 2: Sample
  yield { type: "step", agent: "ingest", message: "Sampling rows..." };
  const { sampledRows, columnStats } = sampleRows(
    inspection.headers,
    inspection.allRows,
    inspection.totalDataRows
  );
  yield { type: "step", agent: "ingest", message: `Sampled ${sampledRows.length} rows (${inspection.totalDataRows} total)` };

  // Step 3: Schema detection
  yield { type: "step", agent: "ingest", message: "Detecting schema..." };
  let schema: SchemaDetectionResult;
  try {
    schema = await detectSchema(inspection.headers, sampledRows, columnStats, filePath, options.force);
    yield {
      type: "step",
      agent: "ingest",
      message: `Schema: vendor=${schema.vendor_col ?? "?"}, amount=${schema.amount_col ?? "?"}, date=${schema.date_col ?? "?"}, type=${schema.data_type}, confidence=${schema.confidence}`,
    };
    if (schema.warnings.length > 0) {
      for (const w of schema.warnings.slice(0, 3)) {
        yield { type: "step", agent: "ingest", message: `  🔶 ${w}` };
      }
    }
  } catch (err: any) {
    yield { type: "step", agent: "ingest", message: `Schema detection failed: ${err.message}. Falling back to old pipeline.` };
    yield* oldPipeline(filePath, options.type);
    return;
  }

  // Step 4-5: Normalize + Store
  const allQualityFlags = new Map<string, number>();
  let ingestedCount = 0;
  const seen = new Set<string>();
  const pending: Array<{ record: import("../../model/types").FinancialRecord; summary: string; scratch: string }> = [];
  const rowLimit = options.dryRun ? Math.min(5, inspection.totalDataRows) : inspection.totalDataRows;

  // Filter empty trailing rows
  const dataRows = inspection.allRows.slice(0, inspection.totalDataRows);

  resetDateLocaleCache();

  // Single transaction for the whole file: vendor upserts during normalization
  // otherwise cost one transaction each (was: ~9k transactions on large files).
  // Committed in finally so abandoned generators still persist partial work.
  const bulkDb = getDb();
  let bulkOpen = false;
  try {
    bulkDb.exec("BEGIN IMMEDIATE");
    bulkOpen = true;
  for (let i = 0; i < rowLimit; i++) {
    const rawRowValues = dataRows[i];
    if (!rawRowValues) continue;

    const rawRow: Record<string, string> = {};
    for (let j = 0; j < inspection.headers.length; j++) {
      rawRow[inspection.headers[j]!] = (rawRowValues[j] ?? "").trim();
    }

    try {
      const normalized = universalNormalize(rawRow, schema, sampledRows, columnStats);
      const { record: partiallyNormalized, qualityFlags, amount, date, currency } = normalized;

      // Dedup
      const dedupKey = `${partiallyNormalized.vendor}:${amount}:${date}`;
      if (seen.has(dedupKey) && amount > 0) {
        continue;
      }
      seen.add(dedupKey);

      // Track quality flags
      for (const f of qualityFlags) {
        allQualityFlags.set(f, (allQualityFlags.get(f) ?? 0) + 1);
      }

      // Inject quality into raw JSON (single stringify — was: two per row)
      let rawStr: string;
      try {
        rawStr = JSON.stringify({ ...rawRow, _quality: qualityFlags });
      } catch {
        rawStr = JSON.stringify(rawRow);
      }

      // Build mock _raw record for existing normalizeRecord
      const mockRaw: Record<string, unknown> = {
        ...partiallyNormalized,
        _raw: rawStr,
        _line: inspection.headerRowIndex + 2 + i,
        _type: options.type ?? schema.data_type ?? "transactions",
      };

      if (options.dryRun) {
        yield {
          type: "evidence_found",
          key: `DRY-RUN-${i}`,
          value: `${partiallyNormalized.vendor} | ${amount} ${currency} | ${date} | flags: ${qualityFlags.join(",") || "none"}`,
          sourceDocId: "dry-run",
        };
        continue;
      }

      const { record, vendorResolution } = normalizeRecord(mockRaw as any, currency);
      pending.push({
        record,
        summary: `${vendorResolution.canonicalName} — ${record.amount} ${record.currency}`,
        scratch: `${vendorResolution.canonicalName} | ${record.amount} ${record.currency} | resolved via ${vendorResolution.method}`,
      });
    } catch (err) {
      yield {
        type: "step",
        agent: "ingest",
        message: `Skipped row ${i} — ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  } finally {
    if (bulkOpen) {
      try { bulkDb.exec("COMMIT"); } catch { try { bulkDb.exec("ROLLBACK"); } catch { /* ignore */ } }
    }
  }

  // Bulk insert in a single transaction (was: one transaction per row, ~30 rows/s)
  if (pending.length > 0 && !options.dryRun) {
    withTransaction(() => {
      for (const p of pending) insertFinancialRecord(p.record);
    });
  }
  for (const p of pending) {
    ingestedCount++;
    yield {
      type: "evidence_found",
      key: p.record.id,
      value: p.summary,
      sourceDocId: p.record.id,
    };
  }
  writeScratchpadEntries(pending.map((p) => ({ type: "record_ingested" as const, message: p.scratch })));

  // Quality summary
  if (allQualityFlags.size > 0) {
    const sortedFlags = [...allQualityFlags.entries()].sort((a, b) => b[1] - a[1]);
    const summary = sortedFlags.map(([f, c]) => `${f}:${c}`).join(", ");
    yield { type: "step", agent: "ingest", message: `Quality flags: ${summary}` };
  }

  const action = options.dryRun ? "Previewed" : "Ingested";
  yield { type: "step", agent: "ingest", message: `${action} ${ingestedCount} records from ${filename}` };
  yield { type: "done", totalFindings: 0, durationMs: 0 };
}
