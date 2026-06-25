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

  updateFindingStatus(findingId, action === "escape" ? "open" : action, reason);

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
    upsertCalibration({
      workspaceId: "default",
      agentType: finding.agentType,
      vendorId: finding.vendorId,
      dismissCount: newCount,
      lastUpdated: new Date().toISOString(),
    });
    if (newCount >= 3) {
      return { message: "Finding dismissed. Calibration auto-tuned (3+ dismissals)." };
    }
  }

  return { message: `Finding ${findingId} ${action}d` };
}
