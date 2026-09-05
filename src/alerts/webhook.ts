import type { Finding, Severity } from "../model/types";

export const SEVERITIES: Severity[] = ["critical", "high", "warning", "info"];

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
};

export function shouldAlert(findingSeverity: Severity, minSeverity: Severity): boolean {
  return SEVERITY_RANK[findingSeverity] <= SEVERITY_RANK[minSeverity];
}

export function resolveWebhook(flagUrl?: string): string | null {
  const url = (flagUrl ?? process.env.ARGUS_WEBHOOK_URL ?? "").trim();
  return url.length > 0 ? url : null;
}

export interface SlackPayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export function formatSlack(finding: Finding, currency: string): SlackPayload {
  const impact = finding.impactAmount !== undefined
    ? `${finding.impactAmount.toLocaleString()} ${finding.impactCurrency ?? currency}`
    : "unknown impact";
  const text = `[${finding.severity}] ${finding.agentType} — ${finding.vendorId ?? "unknown vendor"} — ${impact} (${Math.round(finding.confidence * 100)}%)`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${finding.severity.toUpperCase()}* · ${finding.title}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Impact:*\n${impact}` },
          { type: "mrkdwn", text: `*Confidence:*\n${Math.round(finding.confidence * 100)}%` },
          { type: "mrkdwn", text: `*Vendor:*\n${finding.vendorId ?? "—"}` },
          { type: "mrkdwn", text: `*Finding:*\n${finding.id}` },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: finding.summary.slice(0, 280) }],
      },
    ],
  };
}

const WEBHOOK_TIMEOUT_MS = 10_000;

export async function postWebhook(url: string, payload: SlackPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`webhook responded ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget safe: resolves never-rejecting; returns error message or null. */
export async function notifyFinding(
  url: string,
  finding: Finding,
  currency: string
): Promise<string | null> {
  try {
    await postWebhook(url, formatSlack(finding, currency));
    return null;
  } catch (err: any) {
    return err?.message ?? "webhook failed";
  }
}
