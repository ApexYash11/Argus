import type { SchemaDetectionResult, ColumnStats } from "../model/types";
import { resolveVendor } from "./vendor-resolver";

export interface UniversalNormalizeResult {
  record: Record<string, unknown>;
  qualityFlags: string[];
  amount: number;
  date: string;
  vendorName: string;
  currency: string;
}

interface DateVote {
  ddmm: number;
  mmdd: number;
  ambiguous: number;
}

let dateLocaleCache: DateVote | null = null;
const VENDOR_DESC_PATTERNS = [
  /payment\s+to\s+(.+)/i,
  /^(.+?)\s*[-–—]\s*/,
  /^(.+?)\s+invoice/i,
  /^(.+?)\s+subscription/i,
];

function parseAmountRaw(raw: string): { amount: number; locale: "us" | "eu" | "none" } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "n/a" || trimmed === "na" || trimmed === "-" || trimmed === "") {
    return { amount: 0, locale: "none" };
  }

  let str = trimmed;

  const negative = str.startsWith("(") && str.endsWith(")");
  if (negative) str = str.slice(1, -1);

  const leadingNeg = str.startsWith("-") || str.startsWith("–") || str.startsWith("—");
  if (leadingNeg) str = str.replace(/^[–—-]+/, "-");

  const trailingNeg = str.endsWith("-") || str.endsWith("–") || str.endsWith("—");
  if (trailingNeg) str = str.slice(0, -1);

  str = str.replace(/[₹$€£¥\s]/g, "");

  const lastThree = str.slice(-3);
  const isEuropean = /,\d{2}$/.test(lastThree) && /\.\d{1,2}$/.test(str.replace(/,/g, ""));
  const isUS = /\.\d{2}$/.test(lastThree) && !isEuropean;

  let normalized: string;
  let locale: "us" | "eu" | "none" = "none";

  if (isEuropean) {
    normalized = str.replace(/\./g, "").replace(",", ".");
    locale = "eu";
  } else if (isUS) {
    normalized = str.replace(/,/g, "");
    locale = "us";
  } else {
    normalized = str.replace(/,/g, "");
    if (normalized.includes(".")) {
      locale = "us";
    }
  }

  const amount = Number(normalized);
  if (isNaN(amount) || !isFinite(amount)) return { amount: 0, locale: "none" };

  return { amount: negative || leadingNeg || trailingNeg ? -amount : amount, locale };
}

function parseExcelSerial(value: string): Date | null {
  const num = Number(value);
  if (!isNaN(num) && num >= 1 && num <= 99999 && Number.isInteger(num)) {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + num * 86400000);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function countDDFormats(values: string[]): DateVote {
  let ddmm = 0;
  let mmdd = 0;
  let ambiguous = 0;

  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/);
    if (!m) continue;
    const first = parseInt(m[1]!, 10);
    const second = parseInt(m[2]!, 10);
    if (first > 12 && first <= 31) ddmm++;
    else if (second > 12 && second <= 31) mmdd++;
    else ambiguous++;
  }

  return { ddmm, mmdd, ambiguous };
}

function determineDateLocale(sampleRows: Record<string, string>[], columnStats: ColumnStats[]): boolean {
  if (dateLocaleCache) {
    if (dateLocaleCache.ddmm === 0 && dateLocaleCache.mmdd === 0) {
      dateLocaleCache = null;
    } else {
      return dateLocaleCache.ddmm >= dateLocaleCache.mmdd;
    }
  }

  const dateValues: string[] = [];
  const dateCols = columnStats.filter((c) => c.looks_like_date);
  for (const row of sampleRows) {
    for (const col of dateCols) {
      const val = row[col.columnName];
      if (val) dateValues.push(val);
    }
  }

  const vote = countDDFormats(dateValues);
  if (vote.ddmm === 0 && vote.mmdd === 0) {
    dateLocaleCache = null;
    return false;
  }
  dateLocaleCache = vote;
  return vote.ddmm >= vote.mmdd;
}

function parseDateRaw(value: string, preferDDMM: boolean): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "n/a" || trimmed === "na" || trimmed === "") return "";

  const excel = parseExcelSerial(trimmed);
  if (excel) return excel.toISOString().split("T")[0]!;

  const iso = new Date(trimmed);
  if (!isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return iso.toISOString().split("T")[0]!;
  }

  const unix = Number(trimmed);
  if (!isNaN(unix) && unix > 1_000_000_000) {
    return new Date(unix * 1000).toISOString().split("T")[0]!;
  }

  const ddmmyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (ddmmyy) {
    const d = new Date(`${ddmmyy[3]!}-${preferDDMM ? ddmmyy[2]! : ddmmyy[1]!}-${preferDDMM ? ddmmyy[1]! : ddmmyy[2]!}`);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]!;
  }

  const dMonY = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
  if (dMonY) {
    const d = new Date(`${dMonY[1]!} ${dMonY[2]!} ${dMonY[3]!}`);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]!;
  }

  const monY = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monY) {
    const d = new Date(`1 ${monY[1]!} ${monY[2]!}`);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]!;
  }

  const dmyDots = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dmyDots) {
    const d = new Date(`${dmyDots[3]!}-${dmyDots[2]!}-${dmyDots[1]!}`);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]!;
  }

  return "";
}

function extractVendorFromDescription(description: string): string | null {
  for (const pattern of VENDOR_DESC_PATTERNS) {
    const match = description.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function detectCurrencyFromColumn(values: string[]): string | null {
  let matchCount = 0;
  let lastCurrency = "";
  for (const v of values) {
    const trimmed = v.trim();
    if (/^[A-Z]{3}$/.test(trimmed)) {
      matchCount++;
      lastCurrency = trimmed;
    }
  }
  return matchCount > values.length * 0.8 ? lastCurrency : null;
}

function isFutureDated(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  return d > thirtyDays;
}

export function universalNormalize(
  rawRow: Record<string, string>,
  schema: SchemaDetectionResult,
  sampleRows: Record<string, string>[],
  columnStats: ColumnStats[]
): UniversalNormalizeResult {
  const qualityFlags: string[] = [];
  const preferDDMM = determineDateLocale(sampleRows, columnStats);

  // Amount parsing
  let amount = 0;
  const amountRaw = schema.amount_col ? (rawRow[schema.amount_col] ?? "") : "";
  if (amountRaw) {
    const { amount: parsed, locale } = parseAmountRaw(amountRaw);
    amount = parsed;
    if (locale !== "none") qualityFlags.push("amount_guessed_locale");
    if (locale === "eu") qualityFlags.push("amount_locale_assumed");
  }

  if (schema.amount_col_credit) {
    const creditRaw = rawRow[schema.amount_col_credit] ?? "";
    if (creditRaw) {
      const { amount: creditAmount } = parseAmountRaw(creditRaw);
      if (creditAmount > 0) {
        if (amount > 0) {
          qualityFlags.push("debit_credit_split");
        }
        amount = amount > 0 ? amount : creditAmount;
      }
    }
  }

  if (amount === 0) qualityFlags.push("amount_zero");
  if (amount < 0) qualityFlags.push("amount_negated");

  // Date parsing
  let dateStr = schema.date_col ? (rawRow[schema.date_col] ?? "") : "";
  const parsedDate = parseDateRaw(dateStr, preferDDMM);
  if (parsedDate) {
    dateStr = parsedDate;
    if (preferDDMM) qualityFlags.push("date_format_assumed_ddmm");
    if (isFutureDated(dateStr)) qualityFlags.push("future_dated");
  } else {
    dateStr = new Date().toISOString().split("T")[0] ?? new Date().toISOString();
    qualityFlags.push("date_defaulted");
  }

  // Vendor extraction
  let vendorName = schema.vendor_col ? (rawRow[schema.vendor_col] ?? "").trim() : "";
  if (!vendorName && schema.description_col) {
    const desc = rawRow[schema.description_col] ?? "";
    const extracted = extractVendorFromDescription(desc);
    if (extracted) {
      vendorName = extracted;
      qualityFlags.push("vendor_inferred");
    }
  }
  if (!vendorName) {
    vendorName = "Unknown Vendor";
    qualityFlags.push("vendor_unknown");
  }

  const vendorResolution = resolveVendor(vendorName);
  if (vendorResolution.method === "fuzzy") qualityFlags.push("vendor_fuzzy_matched");
  if (vendorResolution.method === "new") qualityFlags.push("vendor_new_unverified");

  // Currency detection
  let currency = schema.currency_col ? (rawRow[schema.currency_col] ?? "").trim() : "";
  if (!currency && schema.currency_col) {
    const colValues = columnStats.find((c) => c.columnName === schema.currency_col)?.sample_values ?? [];
    currency = detectCurrencyFromColumn(colValues) ?? "";
  }
  if (!currency) {
    currency = "INR";
    qualityFlags.push("currency_assumed");
  }

  // Description
  let description = schema.description_col ? (rawRow[schema.description_col] ?? "").trim() : "";
  if (!description) description = `${vendorResolution.canonicalName} transaction`;

  // Outlier detection (approximate: >10x median of sample)
  const amountValues = columnStats
    .filter((c) => c.looks_like_amount)
    .flatMap((c) => {
      if (c.min != null && c.max != null) return [c.min, c.max];
      return [];
    });
  if (amountValues.length > 0) {
    const sorted = [...amountValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median > 0 && (amount > median * 10 || (amount < 0 && Math.abs(amount) > median * 10))) {
      qualityFlags.push("outlier_amount");
    }
  }

  if (schema.confidence < 0.6) qualityFlags.push("schema_low_confidence");

  // Build normalized record compatible with existing normalizeRecord
  const record: Record<string, unknown> = {
    ...rawRow,
    vendor: vendorResolution.canonicalName,
    vendor_name: vendorResolution.canonicalName,
    amount,
    date: dateStr,
    description,
    currency,
    cleared: true,
  };

  return { record, qualityFlags, amount, date: dateStr, vendorName: vendorResolution.canonicalName, currency };
}
