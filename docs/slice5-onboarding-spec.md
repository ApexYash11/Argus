# Slice 5 Spec — 60-Second Onboarding Polish

## Goal
`audit.ts` already skips unknown files, aggregates quality flags, and reports
elapsed + cache stats (prior hardening landed). Remaining friction is
orientation: numbered progress during long runs, next-step hints, demo scripts
that end at plain `report`, and a README that teaches per-file `ingest` first.

## Changes
- `src/cli/commands/audit.ts` only:
  - Numbered progress: `[2/6] Classifying x.csv...`, `[3/5] Ingesting y.csv...`.
  - Summary footer: `Next: report --share / digest / status` hint lines.
  - No behavior change: same skip-unknown, same quality/elapsed/cache lines.
- `demo.ps1` / `demo.sh`: append `report --share` + `digest` steps (prove the
  forwardable outputs in the golden path).
- `README.md` quickstart: folder-drop `audit ./exports/` as the recommended
  path; per-file `ingest` moves to an "advanced" note.

## Acceptance
- [ ] `audit --dry-run` on temp copy of `test-data/`: numbered lines, summary, exit 0.
- [ ] Repo `.audit/` untouched by tests (temp workspace only).
- [ ] No new dependencies. No detector/agent/DB logic touched.

## Out of scope
Watch-mode daemonization, installer/packaging, web UI.
