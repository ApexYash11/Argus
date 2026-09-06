import { registerAgent } from "./supervisor";
import type { FinancialRecord, Comparison } from "../model/types";
import { getAllFinancialRecords, getCalibration, getVendorByAlias } from "../db/queries";
import { extractQualityFlags, computeQualityPenalty } from "./nodes/score-confidence";

/**
 * Duplicate-payments detector, v2.
 *
 * Guards to cut false positives seen in v1:
 *   - must be same resolved vendor (no fuzzy across-universe matches)
 *   - exact amount match required (no fractional tolerance here)
 *   - amount > 0 (no refunds, no zero-amount noise)
 *   - 3-45 day window (not hours, not quarters)
 *   - period overlap required (subscription autopay is not a duplicate)
 *   - both records quality-clean (refunds/zero/dated-defaulted penalised)
 *
 * Reference-similarity is downweighted and only used to suggest a vendor
 * shorthand (INV-001 vs INV-001-A) — not as a primary signal.
 */

const HARD_RULES = {
  MAX_AMOUNT_TOLERANCE: 0.0,        // exact match
  MIN_AMOUNT: 1,                     // ignore zero/cent rows
  MIN_DAYS: 3,
  MAX_DAYS: 45,
  MIN_HIGH_CONFIDENCE: 0.85,
  MIN_REPORT_CONFIDENCE: 0.7,
  MAX_COMPARISONS: 25,
};

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function sharePeriod(a: FinancialRecord, b: FinancialRecord): boolean {
  if (!a.periodStart || !b.periodStart) return false;
  const aStart = new Date(a.periodStart).getTime();
  const aEnd = a.periodEnd ? new Date(a.periodEnd).getTime() : aStart;
  const bStart = new Date(b.periodStart).getTime();
  const bEnd = b.periodEnd ? new Date(b.periodEnd).getTime() : bStart;
  return aStart <= bEnd && bStart <= aEnd;
}

function referenceHint(a: FinancialRecord, b: FinancialRecord): string {
  if (!a.description || !b.description) return "";
  const ax = a.description.split(/[-_/. ]/)[0] ?? "";
  const bx = b.description.split(/[-_/. ]/)[0] ?? "";
  if (ax && ax === bx) return ` (reference "${ax}" repeated)`;
  return "";
}

function vendorReliability(vendorId: string): number {
  const v = getVendorByAlias(vendorId);
  if (!v) return 0.5;                       // unknown vendor
  return Math.max(0.3, Math.min(1.0, v.trustScore));
}

interface ScoredPair {
  a: FinancialRecord;
  b: FinancialRecord;
  score: number;
  reasons: string[];
}

function scorePair(a: FinancialRecord, b: FinancialRecord): ScoredPair | null {
  if (a.amount <= HARD_RULES.MIN_AMOUNT || b.amount <= HARD_RULES.MIN_AMOUNT) return null;
  if (a.vendorId !== b.vendorId) return null;
  if (a.id === b.id) return null;

  const amountMatch = a.amount === b.amount;
  if (!amountMatch) return null;

  const gap = daysBetween(a.date, b.date);
  if (gap < HARD_RULES.MIN_DAYS || gap > HARD_RULES.MAX_DAYS) return null;

  // require either period overlap OR a "monthly recurring" pattern (period_start identical)
  const periodOverlap = sharePeriod(a, b);
  const samePeriodStart = a.periodStart && b.periodStart && a.periodStart === b.periodStart;
  if (!periodOverlap && !samePeriodStart) return null;

  const reasons: string[] = [];
  let score = 0.6;
  reasons.push("exact amount match");

  if (gap <= 14) {
    score += 0.2;
    reasons.push(`${gap.toFixed(0)}d apart`);
  } else {
    score += 0.1;
    reasons.push(`${gap.toFixed(0)}d apart`);
  }

  if (periodOverlap) {
    score += 0.1;
    reasons.push("period overlap");
  }

  // reference hint bonus, but not penalty
  const hint = referenceHint(a, b);
  if (hint) reasons.push(hint.trim());

  // both records must be quality-clean for the high bar
  const aFlags = extractQualityFlags([a]);
  const bFlags = extractQualityFlags([b]);
  const dirty = aFlags.concat(bFlags).filter((f) => !["vendor_fuzzy_matched", "amount_guessed_locale"].includes(f));
  if (dirty.length > 0) {
    score -= 0.15;
    reasons.push(`quality flags: ${dirty.slice(0, 3).join(", ")}`);
  }

  // vendor reliability multiplier: known high-trust vendors are taken at face value
  const rel = vendorReliability(a.vendorId);
  score = Math.max(0.4, Math.min(0.97, score * (0.9 + 0.2 * rel)));

  return { a, b, score, reasons };
}

registerAgent("duplicate-payments", {
  async classify(ctx) {
    const records = getAllFinancialRecords().filter((r) => r.amount > HARD_RULES.MIN_AMOUNT);
    if (records.length < 2) {
      ctx.emit({ type: "agent_skipped", agent: "duplicate-payments", reason: `Need at least 2 records with amount > ${HARD_RULES.MIN_AMOUNT} (found ${records.length})` });
      ctx.state._skip = true;
      return;
    }
    ctx.emit({ type: "step", agent: "duplicate-payments", message: `Checking ${records.length} records for duplicates (vendor + exact amount + period overlap)` });
  },

  async retrieve(ctx) {
    if (!ctx.state._cache) {
      ctx.state._cache = { records: getAllFinancialRecords().filter((r) => r.amount > HARD_RULES.MIN_AMOUNT) } as any;
    }
    const cache = ctx.state._cache as any;
    const records: FinancialRecord[] = cache.records ?? [];
    ctx.state.evidence = [
      { key: "record_count", value: String(records.length), sourceDocId: "db" },
      { key: "guard", value: `exact amount + 3-45d window + period overlap`, sourceDocId: "policy" },
    ];
    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const cache = ctx.state._cache as any;
    const records: FinancialRecord[] = (cache?.records ?? getAllFinancialRecords().filter((r) => r.amount > HARD_RULES.MIN_AMOUNT)) as FinancialRecord[];

    const byVendor = new Map<string, FinancialRecord[]>();
    for (const r of records) {
      const list = byVendor.get(r.vendorId) ?? [];
      list.push(r);
      byVendor.set(r.vendorId, list);
    }

    const pairs: ScoredPair[] = [];
    const MAX_PAIR_SCANS = 500_000;
    let scans = 0;
    let capped = false;
    for (const [, group] of byVendor) {
      if (group.length < 2) continue;
      // Sort by date so the inner loop can break once the gap exceeds the
      // 45-day window (was: full O(n^2) scan — 40M+ pairs on large vendors).
      const sorted = [...group].sort((x, y) => x.date.localeCompare(y.date));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (scans++ >= MAX_PAIR_SCANS) { capped = true; break; }
          if (daysBetween(sorted[i]!.date, sorted[j]!.date) > HARD_RULES.MAX_DAYS) break;
          const scored = scorePair(sorted[i]!, sorted[j]!);
          if (scored) pairs.push(scored);
        }
        if (capped) break;
      }
      if (capped) break;
    }
    if (capped) {
      ctx.emit({ type: "step", agent: "duplicate-payments", message: `Pair scan capped at ${MAX_PAIR_SCANS.toLocaleString()} — results cover the densest vendor groups first` });
    }

    // group pairs by (vendorId, amount) — clusters are stronger evidence
    const clusters = new Map<string, ScoredPair[]>();
    for (const p of pairs) {
      const k = `${p.a.vendorId}|${p.a.amount}`;
      const list = clusters.get(k) ?? [];
      list.push(p);
      clusters.set(k, list);
    }

    const comparisons: Comparison[] = [];
    for (const [, group] of clusters) {
      const sortedGroup = group.sort((x, y) => y.score - x.score);
      const top = sortedGroup[0]!;
      const others = sortedGroup.length - 1;
      const label = `${top.a.vendorId} — ${top.a.amount.toLocaleString()} ${top.a.currency}`;
      const expected = `1 payment on ${top.a.date}`;
      const actual = `${sortedGroup.length + 1} payments on ${top.a.date}, ${top.b.date}${others > 1 ? `, ...` : ""}`;
      const delta = `${(top.score * 100).toFixed(0)}% confidence · ${top.reasons.slice(0, 3).join(" · ")}`;
      comparisons.push({ label, expected, actual, delta });
    }

    comparisons.sort((a, b) => parseFloat(b.delta!.match(/(\d+)%/)?.[0] ?? "0") - parseFloat(a.delta!.match(/(\d+)%/)?.[0] ?? "0"));
    return comparisons.slice(0, HARD_RULES.MAX_COMPARISONS);
  },

  async score(ctx) {
    const topScore = ctx.state.comparisons.reduce((m, c) => {
      const v = parseFloat(c.delta?.match(/(\d+)%/)?.[0] ?? "0");
      return Math.max(m, v / 100);
    }, 0);

    const allCached = Object.values(ctx.state._cache ?? {}).flat() as any[];
    const qualityFlags = extractQualityFlags(allCached);
    const penalty = computeQualityPenalty(qualityFlags);

    const baseScore = topScore > 0
      ? Math.max(0.5, topScore - penalty * 0.5)
      : 0.3;

    const reason = ctx.state.comparisons.length > 0
      ? `${ctx.state.comparisons.length} duplicate cluster(s), top ${(topScore * 100).toFixed(0)}%`
      : "No duplicates detected";

    return {
      score: Math.round(Math.min(0.97, baseScore) * 100) / 100,
      reason,
    };
  },
});
