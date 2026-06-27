import path from "path";
import crypto from "crypto";
import type { AuditEvent } from "../../model/types";
import { parseCsvFile } from "../../ingest/csv-parser";
import { normalizeRecord, normalizeUsageRecord } from "../../ingest/normalizer";
import { extractPdf, extractInvoiceFields } from "../../ingest/pdf-extractor";
import { insertFinancialRecord, insertUsageRecord } from "../../db/queries";
import { getDb } from "../../db/index";
import { writeScratchpadEntry, initScratchpad } from "../../engine/scratchpad";

export async function ingestFile(
  cwd: string,
  filePath: string,
  type?: string
): Promise<AsyncGenerator<AuditEvent>> {
  async function* gen(): AsyncGenerator<AuditEvent> {
    const absPath = path.resolve(filePath);
    const ext = path.extname(absPath).toLowerCase();
    const filename = path.basename(absPath);

    initScratchpad(cwd);
    writeScratchpadEntry({ type: "ingest_start", message: `Ingesting ${filename}` });

    yield { type: "step", agent: "ingest", message: `Ingesting ${filename}...` };

    if (ext === ".csv") {
      const result = parseCsvFile(absPath, type);

      for (const err of result.errors) {
        writeScratchpadEntry({ type: "parse_error", message: `Line ${err.line}: ${err.message}` });
      }

      yield {
        type: "step",
        agent: "ingest",
        message: `Parsed ${result.records.length} records, ${result.errors.length} errors`,
      };

      if (result.errors.length > 0 && result.records.length === 0) {
        yield { type: "step", agent: "ingest", message: "All rows failed validation. Aborting." };
        writeScratchpadEntry({ type: "ingest_abort", message: "All rows failed validation" });
        yield { type: "done", totalFindings: 0, durationMs: 0 };
        return;
      }

      let ingestedCount = 0;
      for (const raw of result.records) {
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
          yield {
            type: "evidence_found",
            key: id,
            value: `Usage: ${usageRecord.employeeEmail} → ${usageRecord.tool} (last: ${usageRecord.lastLogin})`,
            sourceDocId: id,
          };
          ingestedCount++;
          writeScratchpadEntry({ type: "record_ingested", message: `Usage: ${usageRecord.employeeEmail} → ${usageRecord.tool}` });
          continue;
        }

        const { record, vendorResolution } = normalizeRecord(raw);

        yield {
          type: "evidence_found",
          key: record.id,
          value: `${vendorResolution.canonicalName} — ${record.amount} ${record.currency}`,
          sourceDocId: record.id,
        };

        insertFinancialRecord(record);
        ingestedCount++;

        writeScratchpadEntry({
          type: "record_ingested",
          message: `${vendorResolution.canonicalName} | ${record.amount} ${record.currency} | resolved via ${vendorResolution.method}`,
        });
      }

      yield {
        type: "step",
        agent: "ingest",
        message: `Ingested ${ingestedCount} records from ${filename}`,
      };

    } else if (ext === ".pdf") {
      yield { type: "step", agent: "ingest", message: `Extracting PDF: ${filename}...` };

      const pdfResult = await extractPdf(absPath);
      if (pdfResult.error) {
        yield { type: "step", agent: "ingest", message: `PDF error: ${pdfResult.error}` };
        yield { type: "done", totalFindings: 0, durationMs: 0 };
        return;
      }

      yield {
        type: "step",
        agent: "ingest",
        message: `Extracted ${pdfResult.pages} page(s) via ${pdfResult.method} (${pdfResult.text.length} chars)`,
      };

      const fields = await extractInvoiceFields(absPath);
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
        yield {
          type: "evidence_found",
          key: record.id,
          value: `Invoice: ${vendorResolution.canonicalName} — ${record.amount} ${record.currency}`,
          sourceDocId: record.id,
        };
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
      yield { type: "step", agent: "ingest", message: `Unsupported file type: ${ext}. Use .csv or .pdf` };
      yield { type: "done", totalFindings: 0, durationMs: 0 };
      return;
    }

    yield { type: "done", totalFindings: 0, durationMs: 0 };
  }

  return gen();
}
