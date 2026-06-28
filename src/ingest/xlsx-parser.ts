import path from "path";
import type { ParseResult, ParseError } from "./csv-parser";

function excelSerialToDate(serial: number): string {
  const epoch = new Date(1899, 11, 30);
  const d = new Date(epoch.getTime() + serial * 86400000);
  return d.toISOString().split("T")[0];
}

export function parseXlsxFile(filePath: string): ParseResult<Record<string, unknown>> {
  const result: ParseResult<Record<string, unknown>> = { records: [], errors: [] };

  let XLSX: any;
  try {
    XLSX = require("xlsx");
  } catch {
    result.errors.push({ line: 0, message: "xlsx library not available. Install with: bun add xlsx" });
    return result;
  }

  let wb: any;
  try {
    wb = XLSX.readFile(filePath);
  } catch (err: any) {
    result.errors.push({ line: 0, message: `Cannot read xlsx file: ${err.message}` });
    return result;
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    result.errors.push({ line: 0, message: "xlsx file has no sheets" });
    return result;
  }

  const ws = wb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

  if (rows.length === 0) {
    result.errors.push({ line: 0, message: "xlsx sheet is empty" });
    return result;
  }

  const headers = Object.keys(rows[0]);
  const filename = path.basename(filePath).toLowerCase();

  // Determine record type from filename or columns
  let resolvedType = "transactions";
  if (filename.includes("subscription")) resolvedType = "subscriptions";
  else if (filename.includes("expense")) resolvedType = "expense-reports";
  else if (filename.includes("committed") || filename.includes("commitment")) resolvedType = "committed-expenses";
  else if (filename.includes("invoice")) resolvedType = "invoices";
  else if (headers.some((h) => h.toLowerCase().includes("employee"))) resolvedType = "expense-reports";

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 2;

    // Convert Excel serial date to ISO string if needed
    let dateStr = String(raw.TxnDate ?? raw.Date ?? raw.date ?? "");
    if (typeof raw.TxnDate === "number" && raw.TxnDate > 40000) {
      dateStr = excelSerialToDate(raw.TxnDate);
    } else if (typeof raw.Date === "number" && raw.Date > 40000) {
      dateStr = excelSerialToDate(raw.Date);
    } else if (typeof raw.date === "number" && raw.date > 40000) {
      dateStr = excelSerialToDate(raw.date);
    }

    // Map debit/credit to amount
    const debit = Number(raw.Debit ?? raw.Debit ?? 0);
    const credit = Number(raw.Credit ?? raw.Credit ?? 0);
    const amount = debit > credit ? debit : credit;

    // Build record normalized for normalizer.ts
    const record: Record<string, unknown> = {
      vendor: raw.AccountName ?? raw.Vendor ?? raw.vendor ?? raw.vendor_name ?? "",
      vendor_name: raw.AccountName ?? raw.Vendor ?? raw.vendor ?? raw.vendor_name ?? "",
      date: dateStr,
      amount,
      description: raw.Description ?? raw.description ?? "",
      cleared: debit > 0 ? "true" : "true",
      reference: raw.GLID ?? raw.Reference ?? raw.reference ?? "",
    };

    result.records.push({
      ...record,
      _raw: JSON.stringify(raw),
      _line: line,
      _type: resolvedType,
    });
  }

  return result;
}