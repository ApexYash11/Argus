import { registerAgent } from "./supervisor";
import type { Comparison } from "../model/types";
import { getFinancialRecordsByType, getAllUsageRecords } from "../db/queries";

interface ToolUsage {
  tool: string;
  vendorId: string;
  activeEmails: Set<string>;
  lastLogin: string;
}

function parseSeatCount(description: string | undefined): number {
  if (!description) return 0;
  const match = description.match(/\((\d+)\s*seats?\)/);
  return match ? parseInt(match[1] ?? "0", 10) : 0;
}

function daysSince(dateStr: string, referenceDate: string): number {
  const d = new Date(dateStr);
  const ref = new Date(referenceDate);
  return (ref.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
}

registerAgent("saas-waste", {
  async classify(ctx) {
    ctx.emit({ type: "step", agent: "saas-waste", message: "Analyzing subscription usage vs. actual activity..." });
  },

  async retrieve(ctx) {
    const subs = getFinancialRecordsByType("subscription");
    const usage = getAllUsageRecords();

    ctx.state.evidence = [
      { key: "subscription_count", value: String(subs.length), sourceDocId: "db" },
      { key: "usage_records_count", value: String(usage.length), sourceDocId: "db" },
    ];

    for (const e of ctx.state.evidence) {
      ctx.emit({ type: "evidence_found", key: e.key, value: e.value, sourceDocId: e.sourceDocId });
    }
  },

  async compare(ctx) {
    const comparisons: Comparison[] = [];
    const subs = getFinancialRecordsByType("subscription");
    const usage = getAllUsageRecords();

    const usageByVendor = new Map<string, ToolUsage>();
    for (const u of usage) {
      const key = (u.vendorId ?? u.tool).toLowerCase();
      const existing = usageByVendor.get(key) ?? {
        tool: u.tool,
        vendorId: u.vendorId ?? u.tool.toLowerCase(),
        activeEmails: new Set<string>(),
        lastLogin: "1970-01-01",
      };
      existing.activeEmails.add(u.employeeEmail);
      if (u.lastLogin > existing.lastLogin) existing.lastLogin = u.lastLogin;
      usageByVendor.set(key, existing);
    }

    const dates = subs.map((s) => s.date).filter(Boolean);
    const referenceDate = dates.length > 0 ? dates[0]! : new Date().toISOString().slice(0, 10);

    for (const sub of subs) {
      const seatCount = parseSeatCount(sub.description);
      const usageInfo = usageByVendor.get(sub.vendorId.toLowerCase());

      if (!usageInfo) {
        comparisons.push({
          label: sub.vendorId,
          expected: `${seatCount} active seats`,
          actual: "0 users — no usage data found",
          delta: "Unused tool — consider cancelling",
        });
        continue;
      }

      const activeUsers = usageInfo.activeEmails.size;

      if (activeUsers < seatCount) {
        const wastedSeats = seatCount - activeUsers;
        const wastedAmount = (sub.amount / seatCount) * wastedSeats;
        comparisons.push({
          label: sub.vendorId,
          expected: `${seatCount} seats (${sub.amount}/mo)`,
          actual: `${activeUsers} active users`,
          delta: `${wastedSeats} unused seat(s) — ~${wastedAmount.toFixed(0)}/mo wasted`,
        });
      }

      const lastLoginDays = daysSince(usageInfo.lastLogin, referenceDate);
      if (lastLoginDays > 60) {
        comparisons.push({
          label: `${sub.vendorId} (zombie)`,
          expected: "active usage within 60 days",
          actual: `last login ${Math.round(lastLoginDays)} days ago`,
          delta: "Zombie tool — no recent activity",
        });
      }
    }

    return comparisons;
  },

  async score(ctx) {
    const cmpCount = ctx.state.comparisons.length;
    const unusedCount = ctx.state.comparisons.filter((c) => c.delta?.includes("Unused")).length;
    const zombieCount = ctx.state.comparisons.filter((c) => c.delta?.includes("Zombie")).length;
    const seatWasteCount = ctx.state.comparisons.filter((c) => c.delta?.includes("unused seat")).length;

    let score = 0.5;
    const reasons: string[] = [];

    if (unusedCount > 0) { score += 0.25; reasons.push(`${unusedCount} unused tool(s)`); }
    if (zombieCount > 0) { score += 0.15; reasons.push(`${zombieCount} zombie tool(s)`); }
    if (seatWasteCount > 0) { score += Math.min(seatWasteCount * 0.08, 0.15); reasons.push(`${seatWasteCount} seat waste signal(s)`); }
    if (cmpCount === 0) { score = 0; reasons.push("no comparisons found"); }

    return {
      score: Math.round(Math.min(score, 0.95) * 100) / 100,
      reason: reasons.join("; ") || "Default confidence floor",
    };
  },
});
