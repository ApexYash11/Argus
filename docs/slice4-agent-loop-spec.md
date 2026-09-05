# Slice 4 Spec — Thin Agentic Chat Loop (detectors untouched)

## Goal
Free-form chat stops being one-shot `groqStream()` and becomes a real
LLM→tool→LLM loop (max 5 iterations). Slash commands (`/findings`,
`/investigate`, …) and keyword fast-paths stay exactly as-is — only the
final free-form fallback goes through the agent.

## Design (provider-agnostic ReAct, no new deps)
LLM replies either `FINAL: <answer>` or a fenced ` ```tool {"name":…, "args":…} `
block. Works with Groq today, any provider tomorrow, and a scripted stub in tests.
No function-calling API dependency.

## Files
- NEW `src/model/llm.ts`: `LLMMessage`, `LLMProvider { complete(messages): Promise<string> }`,
  `GroqProvider` (wraps `groqComplete`), `LocalProvider` (wraps `localComplete`),
  `pickProvider()` (Groq if `GROQ_API_KEY`, else local).
- NEW `src/tools/registry.ts`: `ToolDef { name, description, parameters, execute }`,
  `ToolRegistry`, plus 4 tools wrapping existing code:
  `list_findings` (getFindings), `get_finding` (getFindingById),
  `get_status` (getStatus), `run_investigation` (runSupervisor, findings summary only).
- NEW `src/agent/agent.ts`: `runAgent(query, ctx, provider?)` → `AgentEvent[]`
  (`thinking | tool_start | tool_end | final | done`). Unknown tool → error result,
  loop continues. System prompt embeds tool catalog + JSON contract.
- EDIT `src/cli/commands/chat.tsx`: only the last free-form branch changes —
  slash commands + regex fast-paths untouched. Agent events map to `ChatEvent`
  (`thinking→agent_thinking`, `final→llm_done`).
- EDIT `src/db/queries.ts`: ADD `queryReadOnly(sql)` — SELECT-only guard
  (`/^select\b/i`, rejects `;`, `--`, insert/update/delete/drop), row limit 50.
  Used by no tool in v1 (findings/status cover it) — ships as the safe primitive
  for the future `query_financial_data` tool, tested now.
- TEST `src/__tests__/agent.ts`: scripted stub provider — tool call executes and
  feeds final answer; unknown tool degrades gracefully; max-iterations guard;
  `queryReadOnly` rejects writes.

## Acceptance
- [ ] `/findings`, `/investigate`, `explain`, `ingest`, keyword paths: byte-identical behavior.
- [ ] Free-form with no API key: still answers (LocalProvider), no crash.
- [ ] `bun src/__tests__/agent.ts` passes; runway/report-share/alerts tests unaffected.
- [ ] No new dependencies. No detector/agent logic touched.

## Out of scope
Streaming tokens mid-loop, approval gates, memory/skills, model switching UI.
