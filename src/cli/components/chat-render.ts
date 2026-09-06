import type { Finding } from "../../model/types";
import { C } from "../theme";

/** Human-first chat rendering (Codex/Claude conventions): two roles, collapsed
 *  tools, markdown-lite assistant text, finding cards. No raw JSON, ever. */

export interface Segment {
  text: string;
  color?: string;
  bold?: boolean;
}

export interface RenderedLine {
  segments: Segment[];
}

/** Markdown-lite: **bold**, `code`, ## headers, - bullets, 1. items. */
export function renderMarkdown(text: string): RenderedLine[] {
  return text.split("\n").map((raw) => {
    const line = raw.trimEnd();
    const header = line.match(/^#{1,3}\s+(.*)$/);
    if (header) {
      return { segments: [{ text: header[1] ?? line, color: C.hi, bold: true }] };
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
    const body = bullet ? `  • ${(bullet[1] ?? "").trim()}` : line;
    return { segments: inlineSegments(body, bullet ? C.base : undefined) };
  });
}

function inlineSegments(text: string, baseColor?: string): Segment[] {
  const out: Segment[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), color: baseColor });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ text: tok.slice(2, -2), color: baseColor, bold: true });
    else out.push({ text: tok.slice(1, -1), color: C.cyan });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), color: baseColor });
  return out.filter((s) => s.text.length > 0);
}

const SEV_COLOR: Record<string, string> = {
  critical: C.red,
  high: C.orange,
  warning: C.yellow,
  info: C.green,
};

export function humanImpact(amount: number | undefined, currency?: string): string {
  if (amount === undefined || amount === null) return "unknown impact";
  return `${Number(amount).toLocaleString()} ${currency ?? ""}`.trim();
}

export interface FindingCard {
  headline: Segment[];
  detail: string;
  hint: string;
}

/** "● HIGH — Duplicate payments · Acme · $4,200 (90%)" + one-line summary. */
export function renderFindingCard(f: Finding): FindingCard {
  const sevColor = SEV_COLOR[f.severity] ?? C.base;
  const title = humanTitle(f.agentType);
  const headline: Segment[] = [
    { text: "● ", color: sevColor },
    { text: `${f.severity.toUpperCase()} — ${title}`, color: sevColor, bold: true },
    { text: ` · ${f.vendorId ?? "unknown vendor"} · ${humanImpact(f.impactAmount, f.impactCurrency)} (${Math.round(f.confidence * 100)}%)`, color: C.base },
  ];
  const detail = f.summary.replace(/\s+/g, " ").trim().slice(0, 220);
  return { headline, detail, hint: `explain ${f.id} for the full trail` };
}

function humanTitle(agentType: string): string {
  return agentType
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const TOOL_VERBS: Record<string, [string, string]> = {
  list_findings: ["Searching findings", "Searched findings"],
  get_finding: ["Opening finding", "Opened finding"],
  get_status: ["Checking workspace health", "Checked workspace health"],
  run_investigation: ["Investigating", "Investigated"],
};

/** Single-line activity: never args JSON, never scores. */
export function renderToolLine(tool: string, phase: "start" | "done", summary?: string): string {
  const verbs = TOOL_VERBS[tool] ?? [tool, tool];
  if (phase === "start") return `${verbs[0]}…`;
  const short = (summary ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  return short ? `${verbs[1]} — ${short}` : verbs[1];
}
