import { generateReport } from "./report";

export async function generateDigest(period?: string): Promise<string> {
  const report = await generateReport(period);
  const s = report.summary;
  const lines: string[] = [];

  lines.push(`# Argus Weekly Digest — ${report.period}`);
  lines.push(`_${report.generatedAt} · ${s.recordCount} records · ${s.vendorCount} vendors_`);
  lines.push("");
  lines.push(`## ${s.moneyFound.toLocaleString()} ${s.currency} recoverable (${s.open} open)`);
  lines.push("");
  lines.push(`| Total | Open | Critical | Resolved | Dismissed |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(`| ${s.total} | ${s.open} | ${s.critical} | ${s.resolved} | ${s.dismissed} |`);
  lines.push("");

  const top5 = [...report.findings]
    .filter((f) => f.status === "open")
    .sort((a, b) => (b.impactAmount ?? 0) - (a.impactAmount ?? 0))
    .slice(0, 5);

  lines.push(`## Top 5 open leaks`);
  if (top5.length === 0) {
    lines.push(`All clear — no open findings with impact.`);
  } else {
    for (let i = 0; i < top5.length; i++) {
      const f = top5[i]!;
      const impact = f.impactAmount !== undefined
        ? `${f.impactAmount.toLocaleString()} ${f.impactCurrency ?? s.currency}`
        : "unknown impact";
      lines.push(`${i + 1}. **${f.id}** [${f.severity}] ${f.agentType} — ${f.vendorId ?? "unknown vendor"} — ${impact} (${Math.round(f.confidence * 100)}%)`);
    }
  }
  lines.push("");

  if (report.agentRates.length > 0) {
    lines.push(`## Review quality`);
    for (const r of report.agentRates) {
      lines.push(`- ${r.agentType}: FP ${r.fpRate === null ? "N/A" : r.fpRate.toFixed(2)} / TP ${r.tpRate === null ? "N/A" : r.tpRate.toFixed(2)}`);
    }
    lines.push("");
  } else {
    lines.push(`_No human feedback yet — run \`argus feedback <id> --resolve|--dismiss\` to calibrate._`);
    lines.push("");
  }

  lines.push(`Run \`argus report --share\` for the full forwardable report.`);
  return lines.join("\n");
}
