import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import {
  SubscriptionRowSchema,
  TransactionRowSchema,
  ExpenseReportRowSchema,
  CommittedExpenseRowSchema,
  UsageRowSchema,
} from "../model/schemas";

export interface ParseError {
  line: number;
  column?: string;
  value?: string;
  message: string;
  hint?: string;
}

export interface ParseResult<T> {
  records: T[];
  errors: ParseError[];
}

type CsvType = "subscriptions" | "transactions" | "expense-reports" | "committed-expenses" | "usage";

const SCHEMA_MAP: Record<CsvType, { schema: any; label: string }> = {
  subscriptions: { schema: SubscriptionRowSchema, label: "Subscriptions" },
  transactions: { schema: TransactionRowSchema, label: "Transactions" },
  "expense-reports": { schema: ExpenseReportRowSchema, label: "Expense Reports" },
  "committed-expenses": { schema: CommittedExpenseRowSchema, label: "Committed Expenses" },
  usage: { schema: UsageRowSchema, label: "Usage" },
};

export function inferCsvType(filename: string, headers: string[]): CsvType | null {
  const lower = filename.toLowerCase();
  const headerSet = new Set(headers.map((h) => h.toLowerCase().trim()));

  if (lower.includes("committed") || lower.includes("commitment") || headerSet.has("due_date")) return "committed-expenses";
  if (lower.includes("subscription") || (headerSet.has("vendor") && headerSet.has("monthly_amount"))) return "subscriptions";
  if (lower.includes("transaction") || headerSet.has("vendor_name") || (headerSet.has("date") && headerSet.has("cleared"))) return "transactions";
  if (lower.includes("expense") || (headerSet.has("employee") && headerSet.has("category"))) return "expense-reports";
  if (lower.includes("usage") || (headerSet.has("employee_email") && headerSet.has("tool"))) return "usage";

  return null;
}

export function parseCsvFile<T = any>(filePath: string, type?: string): ParseResult<T> {
  const result: ParseResult<T> = { records: [], errors: [] };
  let content: string;

  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    result.errors.push({ line: 0, message: `Cannot read file: ${err.message}` });
    return result;
  }

  if (!content.trim()) {
    result.errors.push({ line: 0, message: "File is empty" });
    return result;
  }

  let rawRecords: any[];
  try {
    rawRecords = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });
  } catch (err: any) {
    result.errors.push({ line: 0, message: `CSV parse error: ${err.message}`, hint: "Check for unclosed quotes or inconsistent columns" });
    return result;
  }

  if (rawRecords.length === 0) {
    result.errors.push({ line: 0, message: "CSV has headers but no data rows" });
    return result;
  }

  const headers = Object.keys(rawRecords[0] ?? {});
  const resolvedType = type ?? inferCsvType(path.basename(filePath), headers);
  if (!resolvedType || !(resolvedType in SCHEMA_MAP)) {
    const supported = Object.keys(SCHEMA_MAP).join(", ");
    result.errors.push({ line: 0, message: `Could not determine CSV type from filename or headers. Supported types: ${supported}`, hint: `Specify --type with one of: ${supported}` });
    return result;
  }

  const { schema } = SCHEMA_MAP[resolvedType as CsvType];

  for (let i = 0; i < rawRecords.length; i++) {
    const raw = rawRecords[i];
    const line = i + 2;

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        result.errors.push({
          line,
          column: field,
          value: String(raw[field] ?? ""),
          message: issue.message,
          hint: field ? `Expected type: ${issue.expected ?? "unknown"}, got: ${issue.received ?? "unknown"}` : undefined,
        });
      }
      continue;
    }

    result.records.push({ ...parsed.data, _raw: JSON.stringify(raw), _line: line, _type: resolvedType });
  }

  return result;
}
