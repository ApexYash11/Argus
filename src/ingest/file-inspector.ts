import fs from "fs";
import { parse } from "csv-parse/sync";

export interface FileInspectionResult {
  delimiter: string;
  headers: string[];
  headerRowIndex: number;
  totalDataRows: number;
  emptyTrailingRows: number;
  encoding: string;
  sheetName?: string;
  hasMergedCells?: boolean;
  allRows: string[][];
  rawContent?: string;
  warnings: string[];
}

const SKIP_SHEET_PATTERNS = /^(summary|cover|instructions|readme|index|toc)$/i;

function stripBom(buffer: Buffer): { cleaned: Buffer; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { cleaned: buffer.subarray(3), encoding: "utf-8" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { cleaned: buffer.subarray(2), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { cleaned: buffer.subarray(2), encoding: "utf-16be" };
  }
  return { cleaned: buffer, encoding: "utf-8" };
}

function detectDelimiter(firstDataLine: string): string {
  const candidates = [",", ";", "|", "\t"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const escaped = d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = (firstDataLine.match(new RegExp(escaped, "g")) || []).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function isNumeric(val: string): boolean {
  const trimmed = val.trim();
  if (trimmed === "") return false;
  const num = Number(trimmed.replace(/[,$%\s]/g, ""));
  return !isNaN(num) && isFinite(num);
}

function detectHeaderRow(rows: string[][]): { headerRowIndex: number; headers: string[] } {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const nonEmpty = row.filter((cell) => cell.trim() !== "");
    if (nonEmpty.length === 0) continue;
    const nonNumeric = nonEmpty.filter((cell) => !isNumeric(cell)).length;
    if (nonNumeric / nonEmpty.length > 0.6) {
      return { headerRowIndex: i, headers: row.map((c) => c.trim()) };
    }
  }
  return { headerRowIndex: 0, headers: (rows[0] ?? []).map((c) => c.trim()) };
}

function deduplicateHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const key = h.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count > 0 ? `${h}_${count}` : h;
  });
}

function countEmptyTrailingRows(rows: string[][]): number {
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row || row.every((c) => c.trim() === "")) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function forwardFillLabelColumns(rows: any[][]): any[][] {
  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const fillCols = Math.min(2, maxCols);
  for (let col = 0; col < fillCols; col++) {
    let lastVal: any = "";
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || col >= row.length) continue;
      const val = String(row[col]).trim();
      if (val !== "") {
        lastVal = row[col];
      } else {
        row[col] = lastVal;
      }
    }
  }
  return rows;
}

function selectBestSheet(wb: any): { sheetName: string; ws: any } | null {
  let bestSheet: string | null = null;
  let bestRowCount = 0;
  let bestWs: any = null;

  for (const name of wb.SheetNames) {
    if (SKIP_SHEET_PATTERNS.test(name.trim())) continue;
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const rows: any[][] = require("xlsx").utils.sheet_to_json(ws, { defval: "", header: 1 });
    if (rows.length > bestRowCount) {
      bestRowCount = rows.length;
      bestSheet = name;
      bestWs = ws;
    }
  }

  if (!bestSheet) {
    if (wb.SheetNames.length > 0) {
      const fallbackName = wb.SheetNames[0]!;
      return { sheetName: fallbackName, ws: wb.Sheets[fallbackName] };
    }
    return null;
  }
  return { sheetName: bestSheet, ws: bestWs };
}

function decodeBuffer(buffer: Buffer, detectedEncoding: string): string {
  try {
    return new TextDecoder(detectedEncoding as any, { fatal: true }).decode(buffer);
  } catch {
    if (detectedEncoding !== "latin1") {
      try {
        return new TextDecoder("latin1" as any, { fatal: false }).decode(buffer);
      } catch {
        return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      }
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }
}

function inspectXlsx(filePath: string): FileInspectionResult {
  const warnings: string[] = [];
  let XLSX: any;
  try {
    XLSX = require("xlsx");
  } catch {
    return emptyResult("xlsx library not available", warnings);
  }

  let wb: any;
  try {
    wb = XLSX.readFile(filePath);
  } catch (err: any) {
    if (err.message?.includes("password") || err.message?.includes("protected")) {
      warnings.push("File appears to be password-protected. Remove password and retry.");
    } else {
      warnings.push(`Cannot read xlsx file: ${err.message}`);
    }
    return emptyResult("xlsx read failed", warnings);
  }

  const selection = selectBestSheet(wb);
  if (!selection) {
    warnings.push("No usable sheet found");
    return emptyResult("no sheets", warnings);
  }

  const { sheetName, ws } = selection;
  const hasMerged = !!ws["!merges"] && ws["!merges"].length > 0;

  const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });
  if (rawRows.length === 0) {
    warnings.push("Selected sheet is empty");
    return emptyResult("empty sheet", warnings, sheetName);
  }

  let rows = rawRows;
  if (hasMerged) {
    rows = forwardFillLabelColumns(rows);
  }

  const { headerRowIndex, headers } = detectHeaderRow(rows);
  const dedupedHeaders = deduplicateHeaders(headers);
  if (dedupedHeaders.some((h, i) => h !== headers[i])) {
    warnings.push("Duplicate column headers found — renamed with _1, _2 suffixes");
  }

  const dataRows = rows.slice(headerRowIndex + 1);
  const emptyTrailingRows = countEmptyTrailingRows(dataRows);
  const totalDataRows = dataRows.length - emptyTrailingRows;

  return {
    delimiter: ",",
    headers: dedupedHeaders,
    headerRowIndex,
    totalDataRows,
    emptyTrailingRows,
    encoding: "utf-8",
    sheetName,
    hasMergedCells: hasMerged,
    allRows: dataRows.map((r) => r.map((c) => String(c ?? ""))),
    warnings,
  };
}

function inspectCsv(filePath: string): FileInspectionResult {
  const warnings: string[] = [];
  const buffer = fs.readFileSync(filePath);

  if (buffer.length === 0) {
    warnings.push("File is empty");
    return emptyResult("empty file", warnings);
  }

  if (buffer.length === 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    warnings.push("File contains only a BOM with no content");
    return emptyResult("BOM only", warnings);
  }

  const { cleaned, encoding: detectedEncoding } = stripBom(buffer);
  let content: string;
  try {
    const enc = detectedEncoding === "utf-16le" || detectedEncoding === "utf-16be" ? detectedEncoding : "utf-8";
    content = new TextDecoder(enc as any, { fatal: true }).decode(cleaned);
  } catch {
    try {
      content = new TextDecoder("latin1" as any, { fatal: false }).decode(cleaned);
      warnings.push("UTF-8 decode failed, fell back to Latin-1");
    } catch {
      warnings.push("Cannot decode file — unsupported encoding");
      return emptyResult("decode failed", warnings);
    }
  }

  const encoding = detectedEncoding.startsWith("utf-16") ? detectedEncoding : (warnings.length > 0 ? "latin1" : "utf-8");

  const nonEmptyLines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (nonEmptyLines.length === 0) {
    warnings.push("File has no non-empty lines");
    return emptyResult("no data", warnings, encoding, content);
  }

  const firstLine = nonEmptyLines[0] ?? "";
  const delimiter = detectDelimiter(firstLine);

  let rawRecords: any[];
  try {
    rawRecords = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: false,
      delimiter,
    });
  } catch (err: any) {
    warnings.push(`CSV parse error: ${err.message}`);
    return emptyResult("parse failed", warnings, encoding, content);
  }

  if (rawRecords.length === 0) {
    warnings.push("CSV has headers but no data rows");
    return emptyResult("headers only", warnings, encoding, content);
  }

  const headers = deduplicateHeaders(Object.keys(rawRecords[0] ?? {}));
  if (headers.some((h, i) => h !== Object.keys(rawRecords[0] ?? {})[i])) {
    warnings.push("Duplicate column headers found — renamed with _1, _2 suffixes");
  }

  const allRows = rawRecords.map((r: any) => headers.map((h) => String(r[h] ?? "")));
  const emptyTrailingRows = countEmptyTrailingRows(allRows);
  const totalDataRows = allRows.length - emptyTrailingRows;

  return {
    delimiter,
    headers,
    headerRowIndex: 0,
    totalDataRows,
    emptyTrailingRows,
    encoding,
    allRows,
    rawContent: content,
    warnings,
  };
}

function emptyResult(reason: string, warnings: string[], encoding?: string, content?: string): FileInspectionResult {
  return {
    delimiter: ",",
    headers: [],
    headerRowIndex: 0,
    totalDataRows: 0,
    emptyTrailingRows: 0,
    encoding: encoding ?? "utf-8",
    allRows: [],
    rawContent: content,
    warnings: [...warnings, reason],
  };
}

export function inspectFile(filePath: string): FileInspectionResult {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
  if (ext === ".xlsx" || ext === ".xls") {
    return inspectXlsx(filePath);
  }
  return inspectCsv(filePath);
}
