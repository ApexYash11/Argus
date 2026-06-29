import crypto from "crypto";
import type { SchemaDetectionResult, DetectedDataType, ColumnStats } from "../model/types";
import { groqComplete } from "../llm/groq";
import { inferCsvType } from "./csv-parser";
import { diceCoefficient } from "./vendor-resolver";
import { matchColumn } from "./column-matcher";
import { getCachedSchema, setCachedSchema } from "../db/queries";

const SCHEMA_TIMEOUT = 10_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1_000, 2_000];
const COLUMN_MATCH_THRESHOLD = 0.6;

const KEYWORD_MAP: { [key: string]: string[] } = {
  vendor_col: ["vendor", "party", "name", "supplier", "payee", "merchant", "department", "dept", "counterparty", "account_name", "costcenter", "costcentre", "cc", "businessunit", "business_unit"],
  amount_col: ["amount", "debit", "total", "sum", "value", "charge", "fee", "out_amount", "outamount", "payment", "paid"],
  amount_col_credit: ["credit", "inflow", "deposit", "in_amount", "inamount", "received", "receipt"],
  date_col: ["date", "txn_date", "transaction_date", "posting_date", "period", "value_date", "invoice_date"],
  reference_col: ["ref", "reference", "id", "number", "invoice", "glid", "check", "transaction_id", "txn_id"],
  description_col: ["desc", "description", "memo", "narrative", "details", "notes", "particulars", "remarks"],
  currency_col: ["currency", "curr", "ccy", "cur"],
};

function computeFingerprint(headers: string[]): string {
  const sorted = [...headers].sort().join(",").toLowerCase();
  return crypto.createHash("sha256").update(sorted).digest("hex");
}

function fuzzyMatchColumn(headers: string[], columnName: string): string | null {
  const lower = columnName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let bestScore = 0;
  let best: string | null = null;
  for (const h of headers) {
    const hLower = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    const score = diceCoefficient(lower, hLower);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return bestScore >= COLUMN_MATCH_THRESHOLD ? best : null;
}

function deterministicFallback(
  headers: string[],
  filePath: string,
  columnStats: ColumnStats[]
): SchemaDetectionResult {
  const warnings: string[] = [];

  const amount_col = matchColumn(headers, KEYWORD_MAP.amount_col ?? []);
  const amount_col_credit = matchColumn(headers, KEYWORD_MAP.amount_col_credit ?? []);
  const date_col = matchColumn(headers, KEYWORD_MAP.date_col ?? []);
  const reference_col = matchColumn(headers, KEYWORD_MAP.reference_col ?? []);
  const description_col = matchColumn(headers, KEYWORD_MAP.description_col ?? []);
  const currency_col = matchColumn(headers, KEYWORD_MAP.currency_col ?? []);

  const dataType = inferCsvType(filePath, headers) ?? "transactions";

  const hasDebitCredit = !!(amount_col && amount_col_credit);

  const vendor_col = matchColumn(headers, KEYWORD_MAP.vendor_col ?? []);

  const expenseRowsOnly = hasDebitCredit || String(dataType) === "general-ledger";

  if (!vendor_col) warnings.push("No vendor column detected");
  if (!date_col) warnings.push("No date column detected");

  const criticalColumns = [vendor_col, amount_col, date_col].filter(Boolean).length;
  const computedConfidence = 0.3 + (criticalColumns / 3) * 0.4 + (hasDebitCredit ? 0.1 : 0);
  const confidence = Math.round(Math.min(computedConfidence, 0.85) * 10) / 10;

  return {
    vendor_col,
    amount_col,
    amount_col_credit,
    date_col,
    reference_col,
    description_col,
    currency_col,
    data_type: dataType as DetectedDataType,
    expense_rows_only: expenseRowsOnly,
    confidence,
    reasoning: "Deterministic keyword fallback",
    warnings,
  };
}

function validateColumnNames(
  result: SchemaDetectionResult,
  headers: string[]
): SchemaDetectionResult {
  const validHeaders = new Set(headers);
  const warnings = [...result.warnings];

  for (const key of ["vendor_col", "amount_col", "amount_col_credit", "date_col", "reference_col", "description_col", "currency_col"] as const) {
    const val = result[key];
    if (val === null) continue;
    if (!validHeaders.has(val)) {
      const match = fuzzyMatchColumn(headers, val);
      if (match) {
        (result as any)[key] = match;
        warnings.push(`Schema column "${val}" fuzzy-matched to "${match}"`);
      } else {
        (result as any)[key] = null;
        warnings.push(`Schema column "${val}" not found in headers — set to null`);
      }
    }
  }

  return { ...result, warnings };
}

function parseLLMResponse(
  raw: string,
  headers: string[],
  columnStats: ColumnStats[]
): SchemaDetectionResult | null {
  try {
    const parsed = JSON.parse(raw);

    const dataType: DetectedDataType =
      ["transactions", "subscriptions", "expense-reports", "invoices", "general-ledger", "committed-expenses", "bank-statement", "credit-card-statement", "payroll", "unknown"]
        .includes(parsed.data_type) ? parsed.data_type : "unknown";

    const expenseRowsOnly = !!(parsed.expense_rows_only ?? (dataType === "general-ledger"));

    const result: SchemaDetectionResult = {
      vendor_col: parsed.vendor_col ?? null,
      amount_col: parsed.amount_col ?? null,
      amount_col_credit: parsed.amount_col_credit ?? null,
      date_col: parsed.date_col ?? null,
      reference_col: parsed.reference_col ?? null,
      description_col: parsed.description_col ?? null,
      currency_col: parsed.currency_col ?? null,
      data_type: dataType,
      expense_rows_only: expenseRowsOnly,
      confidence: Math.min(Math.max(parsed.confidence ?? 0.5, 0), 1),
      reasoning: parsed.reasoning ?? "LLM schema detection",
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };

    return validateColumnNames(result, headers);
  } catch {
    return null;
  }
}

async function retryableGroqComplete(
  prompt: string,
  systemPrompt: string,
  timeoutMs: number
): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] ?? 2000;
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const resp = await groqComplete(prompt, systemPrompt, timeoutMs);
      return resp.content;
    } catch (err: any) {
      const isRetryable =
        err.message?.includes("429") ||
        err.message?.includes("503") ||
        err.message?.includes("rate limit") ||
        err.message?.includes("service unavailable");
      if (!isRetryable || attempt === MAX_RETRIES) return null;
    }
  }
  return null;
}

export async function detectSchema(
  headers: string[],
  sampleRows: Record<string, string>[],
  columnStats: ColumnStats[],
  filePath: string,
  forceRefresh: boolean = false
): Promise<SchemaDetectionResult> {
  const fingerprint = computeFingerprint(headers);

  if (!forceRefresh) {
    const cached = getCachedSchema(fingerprint);
    if (cached) {
      try {
        const parsed = JSON.parse(cached.detectedSchema) as SchemaDetectionResult;
        return { ...parsed, warnings: [...(parsed.warnings ?? []), "Using cached schema"] };
      } catch {
        // cache corrupted, re-detect
      }
    }
  }

  const result = await tryLLMDetection(headers, sampleRows, columnStats, filePath);
  const validated = validateColumnNames(result, headers);

  try {
    setCachedSchema(fingerprint, JSON.stringify(validated), validated.data_type, validated.confidence);
  } catch {
    // cache write failure is non-fatal
  }

  return validated;
}

async function tryLLMDetection(
  headers: string[],
  sampleRows: Record<string, string>[],
  columnStats: ColumnStats[],
  filePath: string
): Promise<SchemaDetectionResult> {
  const sampleForLLM = sampleRows.slice(0, 10);
  const statsSummary = columnStats.map((s) => ({
    name: s.columnName,
    numeric_ratio: Math.round(s.numeric_ratio * 100) / 100,
    looks_like_date: s.looks_like_date,
    looks_like_amount: s.looks_like_amount,
    null_count: s.null_count,
    sample_values: s.sample_values.slice(0, 3),
  }));

  const userMessage = JSON.stringify({
    headers,
    sample_rows: sampleForLLM,
    column_stats: statsSummary,
  });

  const systemPrompt =
    "You are a financial data schema expert. Given headers, sample rows, and column statistics from a financial file, map each header to its role. " +
    "Return a JSON object with: vendor_col, amount_col, amount_col_credit, date_col, reference_col, description_col, currency_col, " +
    "data_type (one of: transactions, subscriptions, expense-reports, invoices, general-ledger, committed-expenses, bank-statement, credit-card-statement, payroll, unknown), " +
    "expense_rows_only (boolean, true if debit/credit split or general-ledger), " +
    "confidence (0-1), reasoning (short explanation), warnings (array of strings). " +
    "Use null for any unmapped column. Only use column names that exist in the headers array.";

  const llmResponse = await retryableGroqComplete(userMessage, systemPrompt, SCHEMA_TIMEOUT);

  if (llmResponse) {
    const parsed = parseLLMResponse(llmResponse, headers, columnStats);
    if (parsed) return parsed;
  }

  return deterministicFallback(headers, filePath, columnStats);
}
