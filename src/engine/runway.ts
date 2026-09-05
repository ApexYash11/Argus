import type { FinancialRecord } from "../model/types";

export interface BurnOverview {
  ok: boolean;
  reason?: string;
  currency?: string;
  avgMonthlyBurn?: number;
  monthCount?: number;
  lastMonthTotal?: number;
  lastMonthLabel?: string;
  trendPct?: number;
  committedTotal?: number;
}

function monthKey(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return m;
}

function isMonthComplete(month: string, asOf: Date): boolean {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const endOfMonth = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  return asOf.getTime() > endOfMonth.getTime();
}

export function computeBurn(
  records: FinancialRecord[],
  commitments: FinancialRecord[],
  asOf: Date = new Date()
): BurnOverview {
  const asOfUtc = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const byMonth = new Map<string, number>();
  for (const r of records) {
    if (r.amount <= 0) continue;
    if (r.type !== "payment" && r.type !== "expense") continue;
    const key = monthKey(r.date);
    if (!key) continue;
    byMonth.set(key, (byMonth.get(key) ?? 0) + r.amount);
  }

  const complete = [...byMonth.entries()]
    .filter(([m]) => isMonthComplete(m, asOfUtc))
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (complete.length < 2) {
    return { ok: false, reason: `need 2+ complete months of spend (have ${complete.length})` };
  }

  const totals = complete.map(([, t]) => t);
  const avg = totals.reduce((s, v) => s + v, 0) / totals.length;
  const [lastLabel, lastTotal] = complete[complete.length - 1]!;
  const trendPct = avg === 0 ? 0 : ((lastTotal! - avg) / avg) * 100;

  let committedTotal = 0;
  for (const c of commitments) {
    if (c.type !== "commitment") continue;
    const d = new Date(c.date);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getTime() >= asOfUtc.getTime() && c.amount > 0) committedTotal += c.amount;
  }

  return {
    ok: true,
    avgMonthlyBurn: Math.round(avg),
    monthCount: complete.length,
    lastMonthTotal: lastTotal,
    lastMonthLabel: lastLabel,
    trendPct: Math.round(trendPct * 10) / 10,
    committedTotal: Math.round(committedTotal),
  };
}

export function yearlySavings(cutMonthly: number): number {
  return Math.max(0, cutMonthly) * 12;
}
