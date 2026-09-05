import fs from "fs";
import path from "path";
import type { ReportOutput } from "./report";

export interface ShareOptions {
  out?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMoney(n: number | undefined, currency: string): string {
  if (n === undefined || n === null) return "—";
  return `${Number(n).toLocaleString()} ${escapeHtml(currency)}`;
}

export function buildShareHtml(report: ReportOutput): string {
  const s = report.summary;
  const top5 = [...report.findings]
    .filter((f) => f.status === "open")
    .sort((a, b) => (b.impactAmount ?? 0) - (a.impactAmount ?? 0))
    .slice(0, 5);

  const sevCounts: Record<string, number> = { critical: 0, high: 0, warning: 0, info: 0 };
  for (const f of report.findings) {
    sevCounts[f.severity] = (sevCounts[f.severity] ?? 0) + 1;
  }

  const rows = report.findings
    .map(
      (f) => `<tr><td>${escapeHtml(f.id)}</td><td>${escapeHtml(f.agentType)}</td><td>${escapeHtml(f.vendorId ?? "—")}</td>` +
        `<td><span class="pill ${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</span></td>` +
        `<td>${escapeHtml(f.status)}</td><td>${Math.round(f.confidence * 100)}%</td>` +
        `<td class="num">${fmtMoney(f.impactAmount, f.impactCurrency ?? s.currency)}</td></tr>`
    )
    .join("\n");

  const topRows = top5.length > 0
    ? top5.map((f, i) =>
      `<tr><td>${i + 1}</td><td>${escapeHtml(f.id)}</td><td>${escapeHtml(f.agentType)}</td>` +
      `<td>${escapeHtml(f.vendorId ?? "—")}</td><td>${fmtMoney(f.impactAmount, f.impactCurrency ?? s.currency)}</td></tr>`
    ).join("\n")
    : `<tr><td colspan="5" class="muted">No open findings with impact — all clear.</td></tr>`;

  const rateRows = report.agentRates.length > 0
    ? report.agentRates.map((r) =>
      `<tr><td>${escapeHtml(r.agentType)}</td><td>${r.resolved}</td><td>${r.dismissed}</td>` +
      `<td>${r.escalated}</td><td>${r.fpRate === null ? "N/A" : r.fpRate.toFixed(2)}</td>` +
      `<td>${r.tpRate === null ? "N/A" : r.tpRate.toFixed(2)}</td></tr>`
    ).join("\n")
    : `<tr><td colspan="6" class="muted">No human feedback yet — submit via <code>argus feedback</code>.</td></tr>`;

  const range = s.dateRange ? `${escapeHtml(s.dateRange.min)} → ${escapeHtml(s.dateRange.max)}` : "no data";
  const chartData = [sevCounts.critical, sevCounts.high, sevCounts.warning, sevCounts.info];

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Argus Report — ${escapeHtml(report.period)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0e14;color:#e6e9f0;margin:0;padding:32px}
.wrap{max-width:960px;margin:0 auto}.hero{background:linear-gradient(135deg,#131a2a,#1b2540);border:1px solid #2a3a5f;border-radius:16px;padding:28px;margin-bottom:20px}
.hero h1{margin:0 0 4px;font-size:22px}.hero .money{font-size:44px;font-weight:800;margin:8px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px}
.stat{background:#111827;border:1px solid #263049;border-radius:12px;padding:12px}.stat b{font-size:20px;display:block}
.muted{color:#8b93a7}.card{background:#0f1524;border:1px solid #263049;border-radius:12px;padding:18px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #223}.num{text-align:right}
.pill{padding:2px 8px;border-radius:999px;font-size:11px;text-transform:uppercase}.critical{background:#3b1113;color:#ff8a8a}.high{background:#3a2410;color:#ffb86b}.warning{background:#3a3410;color:#ffe08a}.info{background:#12283a;color:#8ad0ff}
code{background:#1a2338;padding:2px 6px;border-radius:6px}footer{color:#8b93a7;font-size:12px;margin-top:8px}
canvas{background:#0b1220;border-radius:8px;width:100%;height:120px}
</style></head><body><div class="wrap">
<div class="hero"><h1>Argus Spend Report — ${escapeHtml(report.period)}</h1>
<div class="muted">Generated ${escapeHtml(report.generatedAt)} · ${s.recordCount} records · ${s.vendorCount} vendors · ${range}</div>
<div class="money">${fmtMoney(s.moneyFound, s.currency)} <span style="font-size:16px;font-weight:400" class="muted">recoverable (open + resolved)</span></div>
<div class="grid">
<div class="stat"><span class="muted">Findings</span><b>${s.total}</b></div>
<div class="stat"><span class="muted">Open</span><b>${s.open}</b></div>
<div class="stat"><span class="muted">Critical</span><b>${s.critical}</b></div>
<div class="stat"><span class="muted">Resolved</span><b>${s.resolved}</b></div>
<div class="stat"><span class="muted">Dismissed</span><b>${s.dismissed}</b></div>
<div class="stat"><span class="muted">Cache h/m</span><b>${report.schemaCache.hits}/${report.schemaCache.misses}</b></div>
</div></div>
<div class="card"><h2>Findings by severity</h2><canvas id="sev" width="900" height="120"></canvas></div>
<div class="card"><h2>Top 5 open leaks</h2><table><thead><tr><th>#</th><th>ID</th><th>Agent</th><th>Vendor</th><th style="text-align:right">Impact</th></tr></thead><tbody>${topRows}</tbody></table></div>
<div class="card"><h2>All findings (${report.findings.length})</h2><table><thead><tr><th>ID</th><th>Agent</th><th>Vendor</th><th>Severity</th><th>Status</th><th>Conf</th><th style="text-align:right">Impact</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="card"><h2>Review quality (FP/TP by agent)</h2><table><thead><tr><th>Agent</th><th>Resolved</th><th>Dismissed</th><th>Escalated</th><th>FP</th><th>TP</th></tr></thead><tbody>${rateRows}</tbody></table></div>
<footer>Methodology: deterministic detectors + SHA-256 fingerprint dedup + 70% confidence floor. Self-contained file — no external requests.</footer>
</div><script>
(function(){var d=${JSON.stringify(chartData)};var c=document.getElementById('sev');if(!c||!c.getContext)return;var x=c.getContext('2d');var labels=['critical','high','warning','info'];var colors=['#ff8a8a','#ffb86b','#ffe08a','#8ad0ff'];var max=Math.max(1,...d);var W=c.width,H=c.height;x.clearRect(0,0,W,H);d.forEach(function(v,i){var bw=W/4-24;var bx=i*(W/4)+12;var bh=(H-40)*(v/max);var by=H-24-bh;x.fillStyle=colors[i];x.fillRect(bx,by,bw,bh);x.fillStyle='#8b93a7';x.font='12px system-ui';x.fillText(labels[i]+' ('+v+')',bx,H-8);});})();
</script></body></html>`;
}

export async function writeShareReport(
  cwd: string,
  report: ReportOutput,
  opts?: ShareOptions
): Promise<string> {
  const outPath = opts?.out
    ? path.resolve(cwd, opts.out)
    : path.join(cwd, ".audit", "report.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buildShareHtml(report), "utf-8");
  return outPath;
}
