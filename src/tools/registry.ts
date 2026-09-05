import { getFindings, getFindingById } from "../db/queries";
import { getStatus } from "../cli/commands/status";
import { runSupervisor } from "../agents/supervisor";
import "../agents/index";
import type { FinancialEvent } from "../model/types";

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export const FINANCE_TOOLS: ToolDef[] = [
  {
    name: "list_findings",
    description: "List investigation findings. Optional filters: status (open/resolved/dismissed), severity.",
    parameters: "{ status?: string, severity?: string }",
    async execute(args) {
      const findings = getFindings({ status: str(args.status), severity: str(args.severity) });
      if (findings.length === 0) return "No findings match.";
      return findings.slice(0, 20).map((f) =>
        `${f.id} | ${f.title} | [${f.severity}] ${Math.round(f.confidence * 100)}% — ${f.status}`
      ).join("\n");
    },
  },
  {
    name: "get_finding",
    description: "Get one finding with summary. Required: id (e.g. FINDING-XXX).",
    parameters: "{ id: string }",
    async execute(args) {
      const id = str(args.id);
      if (!id) return "ERROR: missing id.";
      const f = getFindingById(id.toUpperCase());
      if (!f) return `ERROR: finding ${id.toUpperCase()} not found.`;
      return `${f.id}\nTitle: ${f.title}\nSeverity: ${f.severity}\nConfidence: ${Math.round(f.confidence * 100)}%\nStatus: ${f.status}\nSummary: ${f.summary}`;
    },
  },
  {
    name: "get_status",
    description: "Workspace health: record/vendor counts, agent readiness, burn overview.",
    parameters: "{}",
    async execute() {
      const s = (await getStatus()) as {
        recordCount: number; vendorCount: number;
        agents: Array<{ ready: boolean }>;
        spend?: { ok: boolean; avgMonthlyBurn?: number; currency?: string };
      };
      const spend = s.spend;
      return `Records: ${s.recordCount}, Vendors: ${s.vendorCount}, ` +
        `Agents ready: ${s.agents.filter((a) => a.ready).length}/${s.agents.length}` +
        (spend?.ok ? `, Avg burn: ${(spend.avgMonthlyBurn ?? 0).toLocaleString()} ${spend.currency ?? ""}/mo` : "");
    },
  },
  {
    name: "run_investigation",
    description: "Run the detection agents now. Optional: agent (one of saas-waste, duplicate-payments, vendor-overbilling, policy-violations, reconciliation, anomaly-detection, cashflow-risk).",
    parameters: "{ agent?: string }",
    async execute(args, ctx) {
      const trigger: FinancialEvent = { type: "daily_tick", timestamp: new Date().toISOString() };
      const stream = await runSupervisor(ctx.cwd, trigger, str(args.agent) as never, undefined, ctx.signal);
      const found: string[] = [];
      let skipped = 0;
      for await (const ev of stream) {
        if (ctx.signal?.aborted) return "Cancelled.";
        if (ev.type === "finding") {
          found.push(`${ev.finding.id} | ${ev.finding.title} | [${ev.finding.severity}]`);
        } else if (ev.type === "agent_skipped") {
          skipped++;
        }
      }
      if (found.length === 0) return `Investigation complete: no new findings (${skipped} agents skipped).`;
      return `Investigation complete: ${found.length} finding(s):\n${found.join("\n")}`;
    },
  },
];

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  constructor(defs: ToolDef[] = FINANCE_TOOLS) {
    for (const d of defs) this.tools.set(d.name, d);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  catalog(): string {
    return [...this.tools.values()]
      .map((t) => `- ${t.name} ${t.parameters}: ${t.description}`)
      .join("\n");
  }
}
