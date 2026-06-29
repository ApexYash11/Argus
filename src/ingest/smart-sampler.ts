import type { ColumnStats } from "../model/types";

export interface SampleResult {
  sampledRows: Record<string, string>[];
  columnStats: ColumnStats[];
  totalRows: number;
  sampleSize: number;
}

function isNumeric(val: string): boolean {
  const trimmed = val.trim();
  if (trimmed === "") return false;
  const num = Number(trimmed.replace(/[,$%\s]/g, ""));
  return !isNaN(num) && isFinite(num);
}

function looksLikeDate(val: string): boolean {
  const trimmed = val.trim().toLowerCase();
  if (!trimmed || trimmed === "n/a" || trimmed === "na") return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) return true;
  if (/^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}$/i.test(trimmed)) return true;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}$/i.test(trimmed)) return true;
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n >= 40000 && n <= 99999) return true;
  }
  return false;
}

function looksLikeAmount(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed || trimmed === "n/a" || trimmed === "na" || trimmed === "-") return false;
  if (/^[\d,.$\-–—()€£¥₹]+$/.test(trimmed)) return true;
  if (/^\([\d,.]+\)$/.test(trimmed)) return true;
  if (/^-?\d+$/.test(trimmed)) return true;
  return false;
}

function computeCommonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0] ?? "";
  for (let i = 1; i < Math.min(values.length, 100); i++) {
    const v = values[i] ?? "";
    let j = 0;
    while (j < prefix.length && j < v.length && prefix[j] === v[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix === "") break;
  }
  return prefix.length > 20 ? prefix.slice(0, 20) + "..." : prefix;
}

export function computeColumnStats(columnName: string, values: string[]): ColumnStats {
  let numericCount = 0;
  let dateCount = 0;
  let amountCount = 0;
  let nullCount = 0;
  let emptyCount = 0;
  let numMin = Infinity;
  let numMax = -Infinity;
  const distinct = new Set<string>();
  const numericValues: number[] = [];

  for (const raw of values) {
    const trimmed = raw.trim();
    distinct.add(trimmed);

    if (trimmed === "" || trimmed === "n/a" || trimmed === "na") {
      nullCount++;
      if (trimmed === "") emptyCount++;
      continue;
    }

    if (looksLikeDate(trimmed)) dateCount++;
    if (looksLikeAmount(trimmed)) {
      amountCount++;
      const num = Number(trimmed.replace(/[^\-0-9.]/g, ""));
      if (!isNaN(num) && isFinite(num)) {
        numericValues.push(num);
        if (num < numMin) numMin = num;
        if (num > numMax) numMax = num;
      }
    }
    if (isNumeric(trimmed)) numericCount++;
  }

  const total = values.length || 1;
  const sortedDistinct = [...distinct].filter((v) => v !== "").sort();
  const sampleValues = sortedDistinct.slice(0, 5);

  return {
    columnName,
    numeric_ratio: numericCount / total,
    looks_like_date: dateCount > total * 0.3,
    looks_like_amount: amountCount > total * 0.3,
    null_count: nullCount,
    distinct_count: distinct.size,
    empty_ratio: emptyCount / total,
    min: numericValues.length > 0 ? numMin : null,
    max: numericValues.length > 0 ? numMax : null,
    common_prefix: computeCommonPrefix(values),
    sample_values: sampleValues.map((v) => v.length > 500 ? v.slice(0, 500) + "..." : v),
  };
}

export function sampleRows(headers: string[], allRows: string[][], totalDataRows: number): SampleResult {
  if (totalDataRows <= 0) {
    return { sampledRows: [], columnStats: headers.map((h) => computeColumnStats(h, [])), totalRows: 0, sampleSize: 0 };
  }

  let indices: number[];

  if (totalDataRows < 30) {
    indices = Array.from({ length: totalDataRows }, (_, i) => i);
  } else if (totalDataRows <= 100) {
    const headCount = Math.ceil(totalDataRows * 0.4);
    const midCount = Math.ceil(totalDataRows * 0.3);
    const tailCount = totalDataRows - headCount - midCount;
    const head = Array.from({ length: headCount }, (_, i) => i);
    const midStart = Math.floor((totalDataRows - midCount) / 2);
    const mid = Array.from({ length: midCount }, (_, i) => midStart + i);
    const tailStart = totalDataRows - tailCount;
    const tail = Array.from({ length: tailCount }, (_, i) => tailStart + i);
    indices = [...new Set([...head, ...mid, ...tail])].sort((a, b) => a - b);
  } else {
    const head = Array.from({ length: 10 }, (_, i) => i);
    const midStart = Math.floor(totalDataRows / 2) - 5;
    const mid = Array.from({ length: 10 }, (_, i) => Math.max(0, midStart + i));
    const tailStart = totalDataRows - 10;
    const tail = Array.from({ length: 10 }, (_, i) => Math.max(0, tailStart + i));
    indices = [...new Set([...head, ...mid, ...tail])].filter((i) => i < totalDataRows).sort((a, b) => a - b);
  }

  if (indices.length === 0) {
    return { sampledRows: [], columnStats: headers.map((h) => computeColumnStats(h, [])), totalRows: totalDataRows, sampleSize: 0 };
  }

  const sampledRows = indices.map((idx) => {
    const row = allRows[idx] ?? [];
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]!] = (row[i] ?? "").length > 10000 ? (row[i] ?? "").slice(0, 10000) + "..." : (row[i] ?? "");
    }
    return obj;
  });

  const columnStats = headers.map((h) => {
    const values = allRows.slice(0, Math.min(2000, allRows.length)).map((r) => r[headers.indexOf(h)] ?? "");
    return computeColumnStats(h, values);
  });

  return { sampledRows, columnStats, totalRows: totalDataRows, sampleSize: sampledRows.length };
}
