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

export interface NormalizedUsage {
  employeeEmail: string;
  tool: string;
  lastLogin: string;
  vendorId: string;
}

function generateRecordId(): string {
  return `FR-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function safeAmount(raw: unknown): number {
  const n = Number(raw);
  if (isNaN(n) || !isFinite(n)) {
    throw new Error(`Invalid amount: "${raw}" — expected a number`);
  }
  return n;
}

function safeDate(value: string): string {
  if (!value || String(value).trim() === "") {
    return new Date().toISOString().split("T")[0];
  }
  const trimmed = String(value).trim();
  const iso = new Date(trimmed);
  if (!isNaN(iso.getTime())) return iso.toISOString().split("T")[0];
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const first = parseInt(slashMatch[1]!, 10);
    const second = parseInt(slashMatch[2]!, 10);
    if (first > 12 && second <= 31) {
      const d = new Date(`${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    if (second > 12 && first <= 12) {
      const d = new Date(`${slashMatch[3]}-${slashMatch[1]}-${slashMatch[2]}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
  }
  return new Date().toISOString().split("T")[0];
}

function inferPeriod(sub: Record<string, unknown>): { start?: string; end?: string } {
  const renewalDate = sub.renewal_date as string | undefined;
  if (renewalDate) {
    const parsed = safeDate(renewalDate);
    const d = new Date(parsed);
    if (isNaN(d.getTime())) return {};
    const start = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate());
    return { start: start.toISOString().slice(0, 10), end: d.toISOString().slice(0, 10) };
  }
  return {};
}

export function normalizeUsageRecord(raw: RawRecord): NormalizedUsage | null {
  if (raw._type !== "usage") return null;
  const email = String(raw.employee_email ?? "");
  const tool = String(raw.tool ?? "");
  const lastLogin = String(raw.last_login ?? "");
  if (!email || !tool || !lastLogin) return null;
  const resolved = resolveVendor(tool);
  return { employeeEmail: email, tool, lastLogin, vendorId: resolved.vendorId };
}

export function normalizeRecord(raw: RawRecord, currency: string = "INR"): NormalizedRecord {
  const type = raw._type;
  const vendorName = String(raw.vendor ?? raw.vendor_name ?? raw.vendorName ?? "");
  const resolved = resolveVendor(vendorName);

  const flags: string[] = [];

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
      amount = Math.abs(safeAmount(raw.monthly_amount ?? raw.amount ?? 0));
      if (amount === 0) flags.push("amount_zero");
      date = safeDate(String(raw.renewal_date ?? raw.date ?? ""));
      description = `${vendorName} subscription (${String(raw.seat_count ?? "?")} seats)`;
      const p = inferPeriod(raw);
      periodStart = p.start;
      periodEnd = p.end;
      break;
    }

    case "transactions": {
      const isCleared = raw.cleared === true || raw.cleared === "true" || raw.cleared === "yes" || raw.cleared === "1" || raw.cleared === 1;
      recordType = isCleared ? "payment" : "payment";
      amount = Math.abs(safeAmount(raw.amount ?? 0));
      if (amount === 0) flags.push("amount_zero");
      date = safeDate(String(raw.date ?? ""));
      status = isCleared ? "cleared" : "pending";
      description = String(raw.description ?? raw.reference ?? "");
      periodEnd = date;
      break;
    }

    case "expense-reports": {
      recordType = "expense";
      amount = Math.abs(safeAmount(raw.amount ?? 0));
      if (amount === 0) flags.push("amount_zero");
      date = safeDate(String(raw.date ?? ""));
      status = "cleared";
      description = `${raw.category ?? "expense"} — ${String(raw.employee ?? "")}`;
      break;
    }

    case "committed-expenses": {
      recordType = "commitment";
      amount = Math.abs(safeAmount(raw.amount ?? 0));
      if (amount === 0) flags.push("amount_zero");
      date = safeDate(String(raw.due_date ?? ""));
      status = "pending";
      description = String(raw.description ?? `${vendorName} commitment`);
      break;
    }

    case "invoices": {
      recordType = "invoice";
      amount = Math.abs(safeAmount(raw.amount ?? 0));
      if (amount === 0) flags.push("amount_zero");
      date = safeDate(String(raw.date ?? ""));
      status = raw.cleared === true || raw.cleared === "true" || raw.cleared === "yes" ? "cleared" : "pending";
      description = String(raw.description ?? `${vendorName} invoice`);
      break;
    }

    default: {
      recordType = "payment";
      amount = Math.abs(safeAmount(raw.amount ?? 0));
      if (amount === 0) flags.push("amount_zero");
      date = safeDate(String(raw.date ?? ""));
      description = String(raw.description ?? vendorName);
    }
  }

  if (resolved.method === "fuzzy") flags.push("vendor_fuzzy_matched");
  if (resolved.method === "new") flags.push("vendor_new_unverified");

  // Inject quality flags into the stored raw JSON
  let rawStr = raw._raw;
  try {
    const parsed = JSON.parse(raw._raw);
    if (Array.isArray(parsed)) {
      rawStr = JSON.stringify(parsed);
    } else {
      rawStr = JSON.stringify({ ...parsed, _quality: flags });
    }
  } catch {
    flags.push("raw_parse_failed");
    rawStr = raw._raw;
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
    raw: rawStr,
    ingestedAt: new Date().toISOString(),
  };

  if (periodStart) record.periodStart = periodStart;
  if (periodEnd) record.periodEnd = periodEnd;

  return { record, vendorResolution: resolved };
}
