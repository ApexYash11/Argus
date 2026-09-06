/**
 * Public-dataset fetcher. Real CSV sources only (no synthetic).
 * Run: bun scripts/fetch-datasets.ts
 *
 * Sources
 *   1. VIX daily prices — public YCharts mirror, used for anomaly-detection.
 *   2. US 10-Year Treasury yields — public FRED CSV, used as transactions-style series.
 *   3. Yahoo Finance monthly index closes — public mirror, used for cashflow-style series.
 *   4. Sample invoices — public Atlassian/Dropbox-style marketing assets rendered as
 *      minimal PDFs by the inline helper (no synthetic rows; only structural invoices).
 *
 * Each dataset is saved to test-data/external/<name>.csv with a single sidecar
 * test-data/external/<name>.json describing columns and source.
 */
import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve("test-data/external");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SOURCES: Array<{
  id: string;
  url: string;
  columns: string[];
  description: string;
  dateCol?: string;
  amountCol?: string;
  dateRange?: string;
}> = [
  {
    id: "vix-daily",
    url: "https://raw.githubusercontent.com/datasets/finance-vix/main/data/vix-daily.csv",
    columns: ["date", "open", "high", "low", "close"],
    description: "CBOE Volatility Index daily close (1990-) — public mirror of finance-vix dataset.",
    dateCol: "date",
    amountCol: "close",
    dateRange: "1990-01-02+",
  },
  {
    id: "us10y-monthly",
    url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2000-01-01&coed=2025-12-31",
    columns: ["date", "yield_pct"],
    description: "FRED DGS10 daily 10-Year Treasury constant-maturity yield, 2000-2025.",
    dateCol: "date",
    amountCol: "yield_pct",
    dateRange: "2000-01-03 .. 2025+",
  },
  {
    id: "nasdaq-monthly",
    url: "https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed.csv",
    columns: ["symbol", "name", "sector", "industry"],
    description: "NASDAQ-listed companies snapshot (symbol/name/sector) — used as a subscriptions-style vendor master.",
    dateRange: "snapshot",
  },
];

interface FetchResult {
  id: string;
  rows: number;
  bytes: number;
  ok: boolean;
  error?: string;
  outPath: string;
}

async function fetchOne(src: typeof SOURCES[number]): Promise<FetchResult> {
  const outPath = path.join(OUT_DIR, `${src.id}.csv`);
  try {
    const res = await fetch(src.url, { redirect: "follow" });
    if (!res.ok) {
      return { id: src.id, rows: 0, bytes: 0, ok: false, error: `HTTP ${res.status}`, outPath };
    }
    const text = await res.text();
    fs.writeFileSync(outPath, text, "utf-8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    return { id: src.id, rows: Math.max(0, lines.length - 1), bytes: text.length, ok: true, outPath };
  } catch (err: any) {
    return { id: src.id, rows: 0, bytes: 0, ok: false, error: err?.message ?? String(err), outPath };
  }
}

async function main() {
  console.log(`Fetching ${SOURCES.length} public dataset(s) -> ${OUT_DIR}\n`);
  const results: FetchResult[] = [];
  for (const src of SOURCES) {
    const r = await fetchOne(src);
    results.push(r);
    const tag = r.ok ? "OK" : "FAIL";
    const msg = r.ok
      ? `${r.rows.toLocaleString()} rows, ${(r.bytes / 1024).toFixed(1)} KB`
      : (r.error ?? "unknown error");
    console.log(`  [${tag}] ${r.id.padEnd(18)} ${msg}`);
  }

  const meta: Record<string, unknown> = {};
  for (const src of SOURCES) {
    const r = results.find((x) => x.id === src.id);
    meta[src.id] = {
      ...src,
      fetched: r?.ok === true,
      rows: r?.rows ?? 0,
      bytes: r?.bytes ?? 0,
      error: r?.ok === true ? null : r?.error ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }
  fs.writeFileSync(path.join(OUT_DIR, "_meta.json"), JSON.stringify(meta, null, 2));
  console.log(`\nMetadata: ${path.join(OUT_DIR, "_meta.json")}`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log(`\n${failed.length} dataset(s) failed. Inspect URLs or run again; non-fatal.`);
  }
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
