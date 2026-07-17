import type { Finding } from "../../model/types";
import type { AgentContext } from "../state-machine";
import { generateFingerprint, generateFindingId, assignSeverity } from "../../engine/finding-builder";
import { insertFinding, findExistingFingerprint, updateVendorTrustScore, updateFindingRecommendation, getDominantCurrency } from "../../db/queries";
import { writeScratchpadEntry } from "../../engine/scratchpad";
import { getYearMonth } from "../../ingest/date-utils";

let activeRecommendations = 0;
const MAX_CONCURRENT_RECS = 3;

async function generateRecommendation(finding: Finding, emit: (event: any) => void): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) return;
  if (activeRecommendations >= MAX_CONCURRENT_RECS) return;

  activeRecommendations++;
  try {
    const { openrouterStream } = await import("../../llm/openrouter");
    const prompt = JSON.stringify({
      type: finding.agentType,
      vendor: finding.vendorId,
      evidence: finding.evidenceChain,
      impact: finding.impactAmount,
      confidence: finding.confidence,
    });
    const systemPrompt = "You are Argus, an autonomous financial investigator. Write a specific, actionable recommendation for this finding. Name the vendor, the exact amount, the precise next action. Maximum 3 bullet points. No generic advice. No preamble.";

    let fullText = "";
    for await (const chunk of openrouterStream(prompt, systemPrompt)) {
      if (chunk.type === "token") {
        fullText += chunk.text;
      } else {
        fullText = chunk.text;
      }
    }

    if (fullText) {
      updateFindingRecommendation(finding.id, fullText);
      emit({ type: "step", agent: finding.agentType, message: `Recommendation ready for ${finding.id}` });
    }
  } catch {
    // recommendation failed silently — finding is still persisted
  } finally {
    activeRecommendations--;
  }
}

export async function generateFinding(ctx: AgentContext): Promise<Finding | null> {
  const { agentType, trigger, comparisons, evidence, confidence } = ctx.state;

  const vendorId = trigger.vendorId ?? "unknown";
  const amount = trigger.amount ?? 0;
  const periodStart = getYearMonth(trigger.timestamp);

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
  const impactCurrency = getDominantCurrency();

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
    investigationEvents: JSON.stringify(ctx.state.events),
    dismissedCount: 0,
    createdAt: new Date().toISOString(),
  };

  insertFinding(finding);
  generateRecommendation(finding, ctx.emit).catch(() => {});

  const trustDelta = severity === "critical" ? -0.15 : severity === "high" ? -0.10 : -0.05;
  if (vendorId !== "unknown") updateVendorTrustScore(vendorId, trustDelta);

  ctx.state.finding = finding;
  ctx.emit({ type: "finding", finding });

  return finding;
}
