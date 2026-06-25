import crypto from "crypto";
import type { FinancialRecord, FinancialRecordType, FinancialRecordStatus } from "../model/types";
import { resolveVendor } from "./vendor-resolver";

interface RawRecord {
  _raw: string;
  _line: number;
  _type: string;
  [key: string]: unknown;
}

export interface NormalizedRecord {
  record: FinancialRecord;
  vendorResolution: { vendorId: string; canonicalName: string; confidence: number; method: string };
}

function generateRecordId(): string {
  return `FR-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function parseDate(value: string): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  value = String(value).trim();
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const parts = value.split(/[/\-.]/);
  if (parts.length !== 3) return value;
  let [a, b, c] = parts.map((p) => p.padStart(2, "0"));
  if (a.length === 4) return `${a}-${b}-${c}`;
  if (c.length === 4) {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (numA > 12 && numB <= 12) return `${c}-${b}-${a}`;
    if (numA > 12) return `${c}-${b}-${a}`;
    if (numB > 12) return `${c}-${a}-${b}`;
    return `${c}-${a}-${b}`;
  }
  return `${c}-${a}-${b}`;
}

function inferPeriod(sub: Record<string, unknown>): { start?: string; end?: string } {
  const renewalDate = sub.renewal_date as string | undefined;
  if (renewalDate) {
    const parsed = parseDate(renewalDate);
    const d = new Date(parsed);
    if (isNaN(d.getTime())) return {};
    const start = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate());
    return { start: start.toISOString().slice(0, 10), end: d.toISOString().slice(0, 10) };
  }
  return {};
}

export function normalizeRecord(raw: RawRecord, currency: string = "INR"): NormalizedRecord {
  const type = raw._type;
  const vendorName = String(raw.vendor ?? raw.vendor_name ?? raw.vendorName ?? "");
  const resolved = resolveVendor(vendorName);

  let recordType: FinancialRecordType = "payment";
  let amount = 0;
  let date = new Date().toISOString().slice(0, 10);
  let description = "";
  let status: FinancialRecordStatus = "cleared";
  let periodStart: string | undefined;
  let periodEnd: string | undefined;

  switch (type) {
    case "subscriptions": {
      recordType = "subscription";
      amount = Math.abs(Number(raw.monthly_amount ?? raw.amount ?? 0));
      date = parseDate(String(raw.renewal_date ?? raw.date ?? ""));
      description = `${vendorName} subscription (${String(raw.seat_count ?? "?")} seats)`;
      const p = inferPeriod(raw);
      periodStart = p.start;
      periodEnd = p.end;
      break;
    }

    case "transactions": {
      const isCleared = raw.cleared === true || raw.cleared === "true" || raw.cleared === "yes" || raw.cleared === "1" || raw.cleared === 1;
      recordType = isCleared ? "payment" : "payment";
      amount = Math.abs(Number(raw.amount ?? 0));
      date = parseDate(String(raw.date ?? ""));
      status = isCleared ? "cleared" : "pending";
      description = String(raw.description ?? raw.reference ?? "");
      periodEnd = date;
      break;
    }

    case "expense-reports": {
      recordType = "expense";
      amount = Math.abs(Number(raw.amount ?? 0));
      date = parseDate(String(raw.date ?? ""));
      status = "cleared";
      description = `${raw.category ?? "expense"} — ${String(raw.employee ?? "")}`;
      break;
    }

    case "committed-expenses": {
      recordType = "commitment";
      amount = Math.abs(Number(raw.amount ?? 0));
      date = parseDate(String(raw.due_date ?? ""));
      status = "pending";
      description = String(raw.description ?? `${vendorName} commitment`);
      break;
    }

    case "invoices": {
      recordType = "invoice";
      amount = Math.abs(Number(raw.amount ?? 0));
      date = parseDate(String(raw.date ?? ""));
      status = raw.cleared === true || raw.cleared === "true" || raw.cleared === "yes" ? "cleared" : "pending";
      description = String(raw.description ?? `${vendorName} invoice`);
      break;
    }

    default: {
      recordType = "payment";
      amount = Math.abs(Number(raw.amount ?? 0));
      date = parseDate(String(raw.date ?? ""));
      description = String(raw.description ?? vendorName);
    }
  }

  const record: FinancialRecord = {
    id: generateRecordId(),
    type: recordType,
    vendorId: resolved.vendorId,
    amount,
    currency,
    date,
    description,
    status,
    raw: raw._raw,
    ingestedAt: new Date().toISOString(),
  };

  if (periodStart) record.periodStart = periodStart;
  if (periodEnd) record.periodEnd = periodEnd;

  return { record, vendorResolution: resolved };
}
