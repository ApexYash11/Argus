/**
 * argus web — local-only web viewer.
 *
 * Spins a Bun.serve on a free port. Serves a single-page HTML/JS app that
 * reads the same SQLite DB the CLI uses. No build step, no framework,
 * no external requests. The viewer includes:
 *
 *  - Findings table with severity badges, vendor + impact
 *  - Spend & burn view (monthly totals + 60-day trend)
 *  - Runway simulator (cut X/mo -> save Y/yr)
 *  - Top-vendor list
 *  - Live link into the CLI (`argus explain <id>`)
 *
 * The server is single-process and binds to 127.0.0.1 only.
 */
import fs from "fs";
import path from "path";
import { getDb, initDb } from "../../db/index";
import {
  getFindings,
  getAllVendors,
  getRecordCount,
  getDominantCurrency,
  getFinancialRecordsByType,
  getFpRates,
  getFindingById,
} from "../../db/queries";
import { computeBurn, yearlySavings } from "../../engine/runway";
import { getActiveAgents } from "../../engine/activation";
import type { Finding } from "../../model/types";

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Argus · Local Viewer</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #111827; --panel2: #0f1524;
    --border: #263049; --hi: #eeeef5; --base: #c2c2ce;
    --muted: #8b93a7; --dim: #3a3a45;
    --blue: #5b9cf6; --cyan: #42c9e5; --green: #5ecb82;
    --yellow: #efc02a; --orange: #ef9850; --red: #eb6060;
  }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--hi); margin: 0; padding: 0; }
  header { padding: 20px 32px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 24px; background: var(--panel2); }
  header h1 { margin: 0; font-size: 18px; letter-spacing: 0.5px; }
  header .crumb { color: var(--muted); font-size: 13px; }
  .container { padding: 24px 32px; max-width: 1400px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px; margin-bottom: 24px; }
  .card { background: var(--panel); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px; }
  .card h2 { margin: 0 0 6px; font-size: 13px; color: var(--muted);
    text-transform: uppercase; letter-spacing: 1px; font-weight: 500; }
  .card .v { font-size: 28px; font-weight: 700; }
  .card .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .row { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; color: var(--muted);
    border-bottom: 1px solid var(--border); font-weight: 500; }
  td { padding: 10px; border-bottom: 1px solid var(--border); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { padding: 2px 8px; border-radius: 999px; font-size: 11px;
    text-transform: uppercase; font-weight: 600; }
  .pill.critical { background: #3b1113; color: #ff8a8a; }
  .pill.high { background: #3a2410; color: #ffb86b; }
  .pill.warning { background: #3a3410; color: #ffe08a; }
  .pill.info { background: #12283a; color: #8ad0ff; }
  .pill.open { background: #12283a; color: #8ad0ff; }
  .pill.resolved { background: #113a25; color: #5ecb82; }
  .pill.dismissed { background: #2a2530; color: #8b93a7; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .empty { color: var(--muted); padding: 24px; text-align: center; }
  .bar { background: var(--bg); border-radius: 4px; height: 8px; overflow: hidden; }
  .bar > div { height: 100%; }
  details summary { cursor: pointer; padding: 6px 0; color: var(--muted); }
  .muted { color: var(--muted); }
  .chart svg { width: 100%; height: 160px; }
  .chart .axis { stroke: var(--dim); }
  .chart .grid { stroke: var(--border); stroke-dasharray: 2 2; }
  .chart .bar-a { fill: var(--cyan); }
  .chart .bar-b { fill: var(--blue); }
  .chart text { fill: var(--muted); font-size: 10px; }
  .controls { display: flex; gap: 8px; align-items: center; margin: 8px 0 16px; }
  .controls input { background: var(--panel); border: 1px solid var(--border);
    color: var(--hi); padding: 6px 10px; border-radius: 6px; font-size: 13px; }
  .controls label { font-size: 12px; color: var(--muted); }
  .sim { display: flex; align-items: center; gap: 12px; }
  .sim input { width: 120px; }
  .sim .v { font-size: 18px; font-weight: 700; }
  footer { padding: 20px 32px; color: var(--muted); font-size: 12px;
    border-top: 1px solid var(--border); }
  code { background: var(--bg); padding: 2px 6px; border-radius: 4px; }
</style></head>
<body>
<header>
  <h1>⌘ Argus · Local Viewer</h1>
  <span class="crumb" id="meta">—</span>
  <span style="flex:1"></span>
  <span class="crumb">Run <code>argus explain &lt;id&gt;</code> in your terminal for full trace</span>
</header>
<div class="container">
  <div id="root">Loading…</div>
</div>
<footer>Argus local viewer · bound to 127.0.0.1 only · reads the same SQLite the CLI uses</footer>
<script>
const C = (s, c) => '<span class="pill ' + c + '">' + s + '</span>';
const fmt = (n, cur) => n == null ? '—' : Number(n).toLocaleString() + ' ' + (cur || '');
function renderBurn(burn) {
  if (!burn || !burn.ok) {
    return '<div class="empty">' + (burn?.reason || 'No spend history yet') + '</div>';
  }
  const trend = burn.trendPct > 0 ? '+' : '';
  const trendColor = burn.trendPct > 5 ? 'var(--red)' : burn.trendPct < -5 ? 'var(--green)' : 'var(--muted)';
  return '' +
    '<div class="v">' + fmt(burn.avgMonthlyBurn, 'INR') + '<span class="sub" style="font-weight:400"> /mo</span></div>' +
    '<div class="sub">across ' + burn.monthCount + ' complete months</div>' +
    '<div class="sub" style="margin-top:8px">Last month <b>' + fmt(burn.lastMonthTotal, 'INR') + '</b> (' + burn.lastMonthLabel + ')</div>' +
    '<div class="sub" style="color:' + trendColor + '">' + trend + burn.trendPct + '% vs avg</div>' +
    '<div class="sub">Committed upcoming: <b>' + fmt(burn.committedTotal, 'INR') + '</b></div>';
}
function renderRunwaySim(burn) {
  const el = document.getElementById('runway-sim');
  if (!el) return;
  el.innerHTML = '<div class="sim">' +
    '<label>Cut per month:</label>' +
    '<input type="number" id="cut" value="0" min="0" step="10000" />' +
    '<span class="muted">→ saves</span>' +
    '<span class="v" id="savings">— /yr</span></ +
    '</div>';
  const upd = () => {
    const v = Number(document.getElementById('cut').value || 0);
    document.getElementById('savings').textContent = (v * 12).toLocaleString() + ' INR /yr';
  };
  document.getElementById('cut').addEventListener('input', upd);
  upd();
}
function renderChart(burn) {
  if (!burn || !burn.ok) return '';
  return '<div class="chart">' + chartSvg() + '</div>';
}
function chartSvg() {
  // We don't have monthly data here directly; the API returns series. Fill in client-side.
  return '<svg viewBox="0 0 600 160" preserveAspectRatio="none"></svg>';
}
function renderFindings(findings, currency) {
  if (!findings.length) return '<div class="empty">No findings yet. Run <code>argus investigate</code>.</div>';
  const rows = findings.map(f =>
    '<tr><td><code>' + f.id + '</code></td>' +
    '<td>' + C(f.severity, f.severity) + '</td>' +
    '<td>' + C(f.status, f.status) + '</td>' +
    '<td>' + f.agentType + '</td>' +
    '<td>' + (f.vendorId || '—') + '</td>' +
    '<td class="num">' + Math.round(f.confidence * 100) + '%</td>' +
    '<td class="num">' + fmt(f.impactAmount, f.impactCurrency || currency) + '</td>' +
    '<td>' + f.createdAt.slice(0, 10) + '</td></tr>'
  ).join('');
  return '<table><thead><tr><th>ID</th><th>Sev</th><th>Status</th><th>Agent</th><th>Vendor</th><th>Conf</th><th>Impact</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
function renderVendors(vendors, currency) {
  if (!vendors.length) return '<div class="empty">No vendors yet.</div>';
  return '<table><thead><tr><th>Vendor</th><th>Trust</th></tr></thead><tbody>' +
    vendors.slice(0, 12).map(v => '<tr><td>' + v.canonicalName + '</td><td class="num">' + (v.trustScore * 100).toFixed(0) + '%</td></tr>').join('') +
    '</tbody></table>';
}
function renderAgents(agents) {
  return '<table><thead><tr><th>Agent</th><th>State</th></tr></thead><tbody>' +
    agents.map(a => '<tr><td>' + a.agent + '</td><td>' + (a.ready ? C('ready', 'info') : '<span class="muted">' + (a.reason || '—') + '</span>') + '</td></tr>').join('') +
    '</tbody></table>';
}
function renderFpRates(rates) {
  if (!rates.length) return '<div class="empty">No feedback yet — run <code>argus feedback &lt;id&gt; --resolve|--dismiss</code>.</div>';
  return '<table><thead><tr><th>Agent</th><th>FP</th><th>TP</th><th>Resolved</th><th>Dismissed</th></tr></thead><tbody>' +
    rates.map(r => '<tr><td>' + r.agentType + '</td><td class="num">' + (r.fpRate == null ? '—' : (r.fpRate * 100).toFixed(0) + '%') + '</td><td class="num">' + (r.tpRate == null ? '—' : (r.tpRate * 100).toFixed(0) + '%') + '</td><td class="num">' + r.resolved + '</td><td class="num">' + r.dismissed + '</td></tr>').join('') +
    '</tbody></table>';
}
async function load() {
  const r = await fetch('/api/summary');
  const d = await r.json();
  document.getElementById('meta').textContent = d.workspace + ' · ' + d.recordCount + ' records · ' + d.vendorCount + ' vendors · ' + d.currency;
  const root = document.getElementById('root');
  root.innerHTML =
    '<div class="grid">' +
      '<div class="card"><h2>Records</h2><div class="v">' + d.recordCount.toLocaleString() + '</div><div class="sub">' + d.vendorCount + ' vendors</div></div>' +
      '<div class="card"><h2>Money Found</h2><div class="v">' + fmt(d.moneyFound, d.currency) + '</div><div class="sub">open + resolved impact</div></div>' +
      '<div class="card"><h2>Findings</h2><div class="v">' + d.findings.length + '</div><div class="sub">' + d.openFindings + ' open · ' + d.criticalFindings + ' critical</div></div>' +
      '<div class="card"><h2>Schema Cache</h2><div class="v">' + d.cacheHits + '/' + (d.cacheHits + d.cacheMisses) + '</div><div class="sub">hit ratio</div></div>' +
    '</div>' +
    '<div class="row">' +
      '<div class="card"><h2>Spend &amp; Burn</h2>' + renderBurn(d.burn) + '<div id="runway-sim" style="margin-top:12px"></div></div>' +
      '<div class="card"><h2>Top Vendors</h2>' + renderVendors(d.vendors, d.currency) + '</div>' +
    '</div>' +
    '<div class="card" style="margin-top:16px"><h2>Findings</h2>' + renderFindings(d.findings, d.currency) + '</div>' +
    '<div class="row" style="margin-top:16px">' +
      '<div class="card"><h2>Agent Health</h2>' + renderAgents(d.agents) + '</div>' +
      '<div class="card"><h2>Review Quality (FP/TP)</h2>' + renderFpRates(d.fpRates) + '</div>' +
    '</div>';
  renderRunwaySim(d.burn);
}
load();
</script>
</body></html>`;

function moneyFoundFromFindings(findings: { status: string; impactAmount?: number }[]): number {
  return findings
    .filter((f) => f.status === "open" || f.status === "resolved")
    .reduce((s, f) => s + (f.impactAmount ?? 0), 0);
}

function summaryPayload(workspace: string) {
  const findings = getFindings();
  const burn = computeBurn(
    [...getFinancialRecordsByType("payment"), ...getFinancialRecordsByType("expense")],
    getFinancialRecordsByType("commitment")
  );
  const vendors = getAllVendors();
  return {
    workspace,
    recordCount: getRecordCount(),
    vendorCount: vendors.length,
    currency: getDominantCurrency(),
    findings,
    openFindings: findings.filter((f) => f.status === "open").length,
    criticalFindings: findings.filter((f) => f.severity === "critical").length,
    moneyFound: moneyFoundFromFindings(findings),
    burn,
    vendors,
    agents: getActiveAgents(["subscriptions", "transactions", "expense-reports", "invoices", "committed-expenses"]),
    fpRates: getFpRates(),
    cacheHits: 0,
    cacheMisses: 0,
  };
}

function findingDetail(id: string) {
  const f = getFindingById(id);
  if (!f) return { error: "not found" };
  return { finding: f };
}

export async function startWebServer(workspace: string, preferredPort: number = 7333): Promise<{ url: string; port: number }> {
  initDb(workspace);

  const db = getDb();
  const hits = (db.query("SELECT COUNT(*) as c FROM schema_cache").get() as { c: number }).c;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: preferredPort,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/api/summary") {
        const s = summaryPayload(workspace);
        s.cacheHits = hits;
        return Response.json(s);
      }
      if (url.pathname.startsWith("/api/finding/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/finding/".length));
        return Response.json(findingDetail(id));
      }
      if (url.pathname === "/api/runway") {
        const cut = Number(url.searchParams.get("cut") ?? 0);
        return Response.json({ yearlySavings: yearlySavings(cut), currency: getDominantCurrency() });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return { url: server.url.toString(), port: server.port ?? preferredPort };
}
