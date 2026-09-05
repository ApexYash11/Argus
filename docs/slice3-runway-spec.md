# Slice 3 Spec — Spend & Burn CFO View (`status`)

## Goal
`argus status` answers "are we ok?" in 3 numbers. No invented data: we have no
cash-balance input, so we show burn + trend + committed upcoming — never fake
runway months.

## UX
```
System Status
Records: 212  Vendors: 34  Agents: 5/7 ready

Spend & Burn (INR, 4 complete months)
  Avg burn:      1,240,000 /mo
  Last month:    1,510,000 (2026-08, +22% vs avg)
  Committed:     380,000 upcoming
  Cut 100,000/mo saves 1,200,000 /yr
```

## Computation (`src/engine/runway.ts`, pure — no DB inside)
- Input: `FinancialRecord[]` (types `payment` + `expense`, `amount > 0`), as-of date.
- Group by complete calendar months only (current partial month excluded).
- `avgMonthlyBurn` = mean of complete-month totals; `monthCount` = # complete months.
- `lastMonth` = most recent complete month total + label; `trendPct` vs avg.
- `committedTotal` = sum of `commitment` records with date >= as-of (passed in separately).
- `yearlySavings(cutMonthly) = cutMonthly * 12`.
- < 2 complete months → `{ ok: false, reason }`, UI shows "need 2+ complete months".

## Files
- NEW `src/engine/runway.ts`: `computeBurn(records, commitments, asOf)` + `yearlySavings()`.
- EDIT `src/cli/commands/status.ts`: add `spend` overview via existing queries
  (`getFinancialRecordsByType`, `getDominantCurrency`); needs a
  `getCommitments()` reader — add `getFinancialRecordsByType("commitment")` reuse (exists).
- EDIT `src/cli/components/StatusBar.tsx`: "Spend & Burn" section (plain text, no new deps).
- TEST `src/__tests__/runway.ts`: synthetic records — avg, partial-month exclusion,
  trend math, <2 months graceful, commitment cutoff.

## Acceptance
- [ ] Empty workspace: status renders, burn section says "not enough history".
- [ ] `bun src/__tests__/runway.ts` passes; alerts + report-share tests still pass.
- [ ] No new dependencies. No agent logic touched.

## Out of scope
Cash-balance input, runway-months projection, charts, Slack wiring (slice 2 covers delivery).
