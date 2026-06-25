import type { Finding } from "../../model/types";
import type { AgentContext } from "../state-machine";
import { generateFingerprint, generateFindingId, assignSeverity } from "../../engine/finding-builder";
import { insertFinding, findExistingFingerprint } from "../../db/queries";
import { writeScratchpadEntry } from "../../engine/scratchpad";

export async function generateFinding(ctx: AgentContext): Promise<Finding | null> {
  const { agentType, trigger, comparisons, evidence, confidence } = ctx.state;

  const vendorId = trigger.vendorId ?? "unknown";
  const amount = trigger.amount ?? 0;
  const periodStart = trigger.timestamp.slice(0, 7);

  const fingerprint = generateFingerprint(agentType, vendorId, amount, periodStart);
  const existing = findExistingFingerprint(fingerprint);
  if (existing) {
    if (existing.status === "open") {
      ctx.emit({ type: "step", agent: agentType, message: `Duplicate finding skipped (${existing.id} already open)` });
    } else {
      ctx.emit({ type: "step", agent: agentType, message: `Finding ${existing.id} previously ${existing.status}, skipping` });
    }
    return null;
  }

  const findingId = generateFindingId();
  const severity = assignSeverity(confidence, amount);
  const impactCurrency = "INR";

  const evidenceSummary = evidence.map((e) => `${e.key}: ${e.value}`).join("; ");
  const comparisonSummary = comparisons.map((c) => `${c.label}: expected ${c.expected}, got ${c.actual}${c.delta ? ` (${c.delta})` : ""}`).join("; ");

  const scratchpadRunId = `run-${Date.now()}`;
  writeScratchpadEntry({ type: "finding", findingId, message: `${agentType} | confidence ${confidence} | ${comparisonSummary}` });

  const finding: Finding = {
    id: findingId,
    fingerprint,
    agentType,
    vendorId,
    title: `${agentType.replace(/-/g, " ")} — Anomaly Detected`,
    summary: `Investigation found ${comparisons.length} signal(s). ${comparisonSummary}`,
    evidenceChain: JSON.stringify({ evidence, comparisons }),
    impactAmount: amount,
    impactCurrency,
    confidence,
    severity,
    status: "open",
    scratchpadRunId,
    investigationEvents: JSON.stringify(ctx.state.events.map((e) => ({
      ...e,
      timestamp: new Date().toISOString(),
    }))),
    dismissedCount: 0,
    createdAt: new Date().toISOString(),
  };

  insertFinding(finding);

  ctx.state.finding = finding;
  ctx.emit({ type: "finding", finding });

  return finding;
}
