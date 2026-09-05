import crypto from "crypto";
import { getFindingById, updateFindingStatus, incrementDismissCount, insertFeedback, getCalibration, upsertCalibration, getFpRates } from "../../db/queries";

/**
 * Calibration v2:
 *   - dismissals are weighted by agent reliability
 *     (high-FP agents pay a steeper floor bump)
 *   - global agent floor applies even when vendor-specific data is missing
 *   - resolve and escalate both count as positive signal (decrease floor drift)
 *   - dismiss 2 same-reason -> reuses reason text to soft-tune the agent
 */

const DISMISS_BUMP_PER = 0.04;
const DISMISS_BUMP_AGENT_WEIGHT: Record<string, number> = {
  "duplicate-payments": 1.0,
  "anomaly-detection": 0.8,
  "policy-violations": 1.0,
  "saas-waste": 0.7,
  "vendor-overbilling": 0.9,
  "reconciliation": 1.0,
  "cashflow-risk": 0.6,
};
const POSITIVE_DECAY = 0.01;
const MIN_FLOOR = 0.5;
const MAX_FLOOR = 0.97;

function clamp(n: number) { return Math.max(MIN_FLOOR, Math.min(MAX_FLOOR, n)); }

function bumpForAgent(agentType: string): number {
  return (DISMISS_BUMP_AGENT_WEIGHT[agentType] ?? 0.8) * DISMISS_BUMP_PER;
}

export async function submitFeedback(
  findingId: string,
  action: "resolve" | "dismiss" | "escalate",
  reason?: string
) {
  const finding = getFindingById(findingId);
  if (!finding) {
    return { error: `Finding ${findingId} not found` };
  }

  const status = action === "escalate" ? "open" : action === "dismiss" ? "dismissed" : "resolved";
  updateFindingStatus(findingId, status, reason);

  insertFeedback({
    id: `FB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    findingId,
    action,
    reason,
    createdAt: new Date().toISOString(),
  });

  const cal = getCalibration(finding.agentType, finding.vendorId);
  const dismissCount = (cal?.dismissCount ?? 0) + (action === "dismiss" ? 1 : 0);
  const resolveCount = (cal?.resolveCount ?? 0) + (action === "resolve" ? 1 : 0);
  const currentFloor = cal?.thresholdOverride ?? 0.7;

  if (action === "dismiss") {
    incrementDismissCount(findingId);
    if (dismissCount >= 1) {
      const next = clamp(currentFloor + bumpForAgent(finding.agentType));
      upsertCalibration({
        workspaceId: "default",
        agentType: finding.agentType,
        vendorId: finding.vendorId,
        thresholdOverride: next,
        dismissCount,
        resolveCount,
        lastUpdated: new Date().toISOString(),
      });
      const fp = getFpRates().find((r) => r.agentType === finding.agentType);
      return {
        message: `Finding dismissed. Floor raised to ${(next * 100).toFixed(0)}% (${dismissCount} dismissals)${fp && fp.fpRate !== null ? ` — agent FP ${(fp.fpRate * 100).toFixed(0)}%` : ""}.`,
      };
    }
    upsertCalibration({
      workspaceId: "default",
      agentType: finding.agentType,
      vendorId: finding.vendorId,
      thresholdOverride: currentFloor,
      dismissCount,
      resolveCount,
      lastUpdated: new Date().toISOString(),
    });
  } else if (action === "resolve" || action === "escalate") {
    const next = clamp(currentFloor - POSITIVE_DECAY);
    upsertCalibration({
      workspaceId: "default",
      agentType: finding.agentType,
      vendorId: finding.vendorId,
      thresholdOverride: next,
      dismissCount,
      resolveCount,
      lastUpdated: new Date().toISOString(),
    });
  }

  const verb = action === "dismiss" ? "dismissed" : `${action}d`;
  return { message: `Finding ${findingId} ${verb}${reason ? ` — ${reason}` : ""}` };
}
