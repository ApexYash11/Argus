import crypto from "crypto";
import type { Finding, AgentType, Severity } from "../model/types";

export function generateFingerprint(
  agentType: AgentType,
  vendorId: string,
  amount: number,
  periodStart: string
): string {
  const hash = crypto.createHash("sha256");
  hash.update(`${agentType}|${vendorId}|${amount}|${periodStart}`);
  return hash.digest("hex").slice(0, 16);
}

export function generateFindingId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `FINDING-${timestamp}${random}`;
}

export function assignSeverity(confidence: number, impactAmount?: number): Severity {
  if (confidence >= 0.9 && (impactAmount ?? 0) > 0) return "critical";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.7) return "warning";
  return "info";
}
