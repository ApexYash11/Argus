import crypto from "crypto";
import { getFindingById, updateFindingStatus, incrementDismissCount, insertFeedback, getCalibration, upsertCalibration } from "../../db/queries";

export async function submitFeedback(
  findingId: string,
  action: "resolve" | "dismiss" | "escalate",
  reason?: string
) {
  const finding = getFindingById(findingId);
  if (!finding) {
    return { error: `Finding ${findingId} not found` };
  }

  const status = action === "escalate" ? "open" : action === "dismiss" ? "dismissed" : action;
  updateFindingStatus(findingId, status, reason);

  insertFeedback({
    id: `FB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    findingId,
    action,
    reason,
    createdAt: new Date().toISOString(),
  });

  if (action === "dismiss") {
    incrementDismissCount(findingId);
    const cal = getCalibration(finding.agentType, finding.vendorId);
    const newCount = (cal?.dismissCount ?? 0) + 1;
    if (newCount >= 3) {
      const thresholdOverride = Math.min(0.95, 0.7 + newCount * 0.05);
      upsertCalibration({
        workspaceId: "default",
        agentType: finding.agentType,
        vendorId: finding.vendorId,
        thresholdOverride,
        dismissCount: newCount,
        lastUpdated: new Date().toISOString(),
      });
      return { message: `Finding dismissed. Calibration auto-tuned (threshold raised to ${(thresholdOverride * 100).toFixed(0)}%, ${newCount} dismissals).` };
    }
    upsertCalibration({
      workspaceId: "default",
      agentType: finding.agentType,
      vendorId: finding.vendorId,
      dismissCount: newCount,
      lastUpdated: new Date().toISOString(),
    });
  }

  const verb = action === "dismiss" ? "dismissed" : `${action}d`;
  return { message: `Finding ${findingId} ${verb}` };
}
