# Slice 1 Spec — `report --share` + Money-Found Hero

## Goal
One command produces a single-file, forwardable HTML report a founder sends to Slack/board.
No new deps. No detector changes. Text `report` output stays default.

## UX
```bash
bun run src/cli/index.tsx report --share [--period Q1-2026] [--open] [--out .audit/report.html]
# output:
#   Report — all-time
#   Total findings: N ... Total recoverable: $X
#   Shared: D:\Argus\.audit\report.html
```
- `--share`: write self-contained HTML (inline CSS + canvas chart, no CDN).
- `--open`: open in default browser after write (best-effort, never fail the run).
- `--out`: override path. Default: `<workspace>/.audit/report.html`.
- `--period`: reuse existing `generateReport(period)` filter.

## Report content (v1)
1. Hero: Money-found = sum `impactAmount` for `status IN (open,resolved)`, shown with dominant currency. Plus counts: total / open / critical / resolved / dismissed.
2. Burn section: record count, vendor count, date range (from existing queries).
3. Top 5 leaks table: open findings sorted by `impactAmount DESC` → id, agent, vendor, severity, confidence, impact.
4. All findings table (compact): id, agent, vendor, severity, status, confidence, impact, created.
5. Agent FP/TP rates (existing `getFpRates()`).
6. Footer: generatedAt, period, methodology note ("deterministic detectors + fingerprint dedup").

## Data changes
- Extend `ReportOutput` in `src/cli/commands/report.ts`: add `moneyFound`, `currency`, `vendors`, `dateRange`.
  ```ts
  summary: { ..., moneyFound: number; currency: string }
  ```
- New query helper in `src/db/queries.ts`: `getMoneyFound()` (or compute inline in `generateReport` — prefer inline to keep diff small).
- Escape all user/vendor strings in HTML (`escapeHtml`).

## Files
- NEW `src/cli/commands/share.ts`: `buildShareHtml(report: ReportOutput): string`, `writeShareReport(cwd, opts): Promise<string>`.
- EDIT `src/cli/commands/report.ts`: extend output, no behavior break.
- EDIT `src/cli/index.tsx`: add flags `share, open, out`; route `report --share` to writer, keep text path.
- TEST `src/__tests__/report-share.ts` (manual script like `e2e-pipeline.ts`): generate report on fixture DB, assert HTML contains hero + top-5 + tables.

## Acceptance
- [ ] `report` without flags: output byte-identical to today (plus one `moneyFound` line — allowed).
- [ ] `report --share`: writes valid HTML, opens with zero external requests.
- [ ] Empty workspace: writes valid HTML with zeros, no crash.
- [ ] Existing scripts (`e2e-pipeline.ts`) still pass.
- [ ] No new dependencies in `package.json`.

## Out of scope (later slices)
Slack webhook, digest, runway simulator, agentic chat, benchmarks, QuickBooks sync, auth.
