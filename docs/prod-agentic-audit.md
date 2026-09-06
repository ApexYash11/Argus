# Argus Prod Audit — Rules vs Agentic + Production Readiness (2026-09-05)

**Verdict: you are right. Today Argus is a deterministic rules engine with an agentic shell, not an agentic system.**

No LangGraph dependency in `package.json`, no LLM tool-call loop, no unified `LLMProvider` / `ToolRegistry` / `Agent.run()` loop. LLM is used at exactly 2 peripheral points. Everything that decides findings is SQL + arithmetic + thresholds.

Existing related docs: `docs/production-readiness-analysis.md` (bug-fix log), `docs/architecture-comparison.md` (Dexter gap map, Phase A/B/C not implemented). This file is the short prod verdict.

## 1. Rules-based proof (file:line)

| Claim in README/plan | Reality in code |
|---|---|
| "7 LangGraph-based investigation agents" (`README.md:3`) | No `langgraph` in `package.json:27-39`. Real loop is `src/agents/state-machine.ts:27-34` — fixed `classify → retrieve → compare → score → loop → generate`, sequential, no LLM planner. |
| "Per-Agent LangGraph State Machine (classify → retrieve → compare → score → loop → generate)" (`README.md:98`) | Implemented as plain TS `AgentDefinition` interface (`state-machine.ts:20-25`). Each agent hand-codes the 4 methods. `nodes/classify.ts` and `nodes/run-comparison.ts` are stubs, real logic lives inside each `agents/*.ts`. |
| "LLM fallback: works without API keys using deterministic logic" (`README.md:130`) | Accurate but inverted: deterministic is the *primary*. `groqComplete` throws if `GROQ_API_KEY` missing (`src/llm/groq.ts:19-21`), `openrouterComplete` same (`src/llm/openrouter.ts:14-16`). `localComplete` (`src/llm/local-fallback.ts:17-46`) is never imported by agents — grep finds zero callers. Only LLM call sites: `schema-detector.ts:168` (schema map, with deterministic fallback) and `nodes/generate-finding.ts:11-45` (optional recommendation enrichment, fire-and-forget, skipped if no key). |
| "Supervisor Agent, trigger routing" | `src/agents/supervisor.ts:13-101` is a `for` loop over `agentImpls`, sequential dispatch + 120s `setTimeout` abort. No routing decision, no parallelism, no re-planning. |
| "Autonomous financial investigation engine" | `src/cli/commands/chat.tsx:119-215` routes by regex (`/^(investigate|check|run)\b/`, `/^(findings|show|list)/`, `/^explain\b/`, `/^ingest\b/`). Free-form path is single `groqStream()` call (`chat.tsx:230`) with no tools. `docs/architecture-comparison.md:622-633` already documents this as "hardcoded routing, not LLM-driven". |

Agent internals (all deterministic):

- `duplicate-payments.ts:101-114` — weighted sum `0.30/0.20/0.25/0.15/0.10`, threshold `>= 0.6`, cap 20.
- `anomaly-detection.ts:89-95` — rolling mean/stddev, `|z| > 2.0`.
- `score-confidence.ts:4-39` — hand `PENALTY_MAP`, `score = 0.5 + signals - penalties`, cap 0.95.
- `finding-builder.ts:4-26` — SHA-256 fingerprint, `assignSeverity()` is pure `confidence + amount` thresholds.
- `engine/activation.ts:23-160` — SQL COUNTs + `historyDays < 60` gates, staleness `>90d` gate.

This is good for auditability, bad for the "agentic" label.

## 2. Does it follow the core idea?

Core idea from `README.md:3` + `DEVELOPMENT_PLAN.md:3-11`: local-first CLI, ingest CSV/PDF → SQLite → 7 agents → findings + evidence + calibration → binary.

| Pillar | Status |
|---|---|
| Local-first SQLite (`bun:sqlite`, WAL, `src/db/index.ts:14-24`) | ✅ Done. Schema in `src/db/schema.ts` matches plan (findings/fingerprint, feedback, calibration, scratchpad_runs + extras `contract_terms`, `usage_records`, `schema_cache`). |
| Ingest CSV/PDF, vendor resolve, normalize | ✅ Mostly done, incl. extras beyond plan: `xlsx-parser.ts`, `universal-normalizer.ts`, `schema-detector.ts` (LLM-assisted), `column-matcher.ts`, `smart-sampler.ts`. |
| 7 agents, same 6-node pattern | ✅ All 7 registered in `src/agents/index.ts`, all implement the interface. Pattern is custom, not LangGraph — plan doc is stale. |
| Fingerprint dedup, 0.7 floor, history-gating 60d, retention 30 | ✅ `generate-finding.ts:54-63`, `state-machine.ts:38`, `activation.ts:114-121`, `supervisor.ts:96`. |
| Findings/explain/feedback/status/report CLI | ✅ All 8 commands + extra `chat.tsx`, `audit.ts`. |
| Calibration persistence | ✅ `calibration` table + `getCalibration()` floor override (`state-machine.ts:37-38`). |
| Binary via `bun build --compile` | ⚠️ Scripts exist (`compile`, `compile:win`, `compile:mac`) but default `compile` targets `bun-linux-x64` only; Windows devs must know `compile:win`. No signed release, no auto-update. |
| LLM strategy (Groq fast + OpenRouter reasoning) | ❌ Not wired. Agents never call either. Docs already propose fix (`architecture-comparison.md:257-310`). |

So: **data plane follows the plan; intelligence plane does not.** It delivers the demo (`demo.ps1/.sh`, `test-data/` seeded anomalies) but not the advertised autonomy.

## 3. Production blockers (ordered)

**P0 — do not call it prod until fixed:**
1. **No auth / multi-tenancy.** Single `.audit/spend-auditor.db`, no user concept, `workspace_id='default'`. Any local user can read all financials. Fine for single-user CLI, not for hosted prod.
2. **Secrets posture.** `.env` exists locally (untracked? verify `.gitignore`), `.env.example` ships empty keys. No secret manager, no key rotation. LLM keys, if added, sit in plaintext.
3. **Watch mode is not a daemon.** `investigate.ts:48-58` is `while(!stopped) + sleep(30s)` in-process. No systemd/launchd unit, no crash restart, `watcher.json` is best-effort. Kill the terminal = kill monitoring.
4. **SQLite concurrency.** Single `bun:sqlite` file + WAL. Parallel `investigate` + `ingest` can hit `SQLITE_BUSY`; no retry/backoff, no queue. `getDb()` throws if uninit (`db/index.ts:7-12`).
5. **Unbounded growth.** No batching for 100k+ row ingest (OOM risk noted in `production-readiness-analysis.md:428-430` as still open), evidence JSON unbounded, `schema_cache` no TTL, scratchpad pruning only by count (30).

**P1 — reliability:**
6. Stale-plan docs ship as truth (`README`, `DEVELOPMENT_PLAN` still say LangGraph). Rename to "deterministic state machine" or re-add LangGraph.
7. Chat regex router (`chat.tsx`) will misroute real questions; no eval for precision/recall beyond `getFpRates()` + `report --json`.
8. Finding titles are generic (`${agentType} — Anomaly Detected`, `generate-finding.ts:81`); only enrichment path needs OpenRouter key.
9. Error paths emit `step: Error: ...` and continue (`supervisor.ts:88-91`); no alerting, no structured log export.
10. No CI gate seen (`e2e-pipeline.ts`, `fix-verification.ts` are manual `bun` scripts, not GitHub Actions).

## 4. Minimal path to honest "agentic" (aligns with `architecture-comparison.md` Phase A)

Do not rewrite 7 agents. Keep deterministic detectors as **tools**, put one LLM loop in front:

1. `src/model/llm.ts` — `LLMProvider` interface; adapt `groq.ts` / `openrouter.ts` to it.
2. `src/tools/registry.ts` — expose existing functions as tools: `query_financial_data`, `list_findings`, `run_investigation(agent)`, `get_status`. No new detection logic.
3. `src/agent/agent.ts` — 10-iteration `LLM → tool_calls → ToolMessage → LLM` loop; replace `handleChatMessage()` regex with it.
4. Keep rules as ground truth; let LLM plan, explain, and chain (e.g. "duplicate found → check reconciliation → draft vendor email").
5. Then update `README`/`DEVELOPMENT_PLAN`: "deterministic detectors + agentic orchestrator".

That preserves auditability (every finding still has SQL evidence + fingerprint) while making "agent" true.

## 5. Recommended immediate actions

- [ ] Fix docs: s/LangGraph/custom state machine/ (or add dep + real graph).
- [ ] Decide distribution: document `compile:win` / `compile:mac`, sign binaries, or drop "standalone binary" claim.
- [ ] Harden single-user prod: file perms on `.audit/`, backup command, `cache --clear/--stats` already exists per prior doc — surface in `status`.
- [ ] Add `report --json` to CI with `expected-findings.json` regression gate (scaffold already in prior doc §Priority 4).
- [ ] If hosted multi-user is the goal: add auth + per-workspace DBs before any customer data.

---
*Generated by local code audit: `package.json`, `src/agents/*`, `src/llm/*`, `src/engine/*`, `src/cli/commands/chat.tsx|investigate.ts`, `src/db/*`, `docs/*.md`. No data modified.*
