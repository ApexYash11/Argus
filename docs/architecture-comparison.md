# Argus Architecture Comparison — Dexter-Inspired Roadmap

Based on analysis of the Dexter AI financial research agent architecture vs. the current Argus codebase. This document maps every layer of the reference architecture to what exists today, identifies gaps, and prioritizes additions.

## Reference Architecture (Dexter)

```
┌─────────────────────────────────────────────────────┐
│  Terminal UI (cli.ts + Ink/pi-tui components)       │
│  ChatLog, WorkingIndicator, HintBar, Editor, etc.    │
├─────────────────────────────────────────────────────┤
│  Controllers (agent-runner.ts, model-selection.ts)  │
│  Bridges UI events → Agent, manages HistoryItems    │
├─────────────────────────────────────────────────────┤
│  Agent Loop (agent/agent.ts)                        │
│  Iterative: LLM → tool calls → LLM → ... → Done    │
├─────────────────────────────────────────────────────┤
│  LLM Layer (model/llm.ts)                           │
│  Multi-provider abstraction (OpenAI/Anthropic/...)  │
├─────────────────────────────────────────────────────┤
│  Tool Executor (agent/tool-executor.ts)             │
│  Concurrent-safe batching, approval gating          │
├─────────────────────────────────────────────────────┤
│  Tool Registry (tools/registry.ts)                  │
│  Finance / Web / Browser / Filesystem / Memory etc. │
├─────────────────────────────────────────────────────┤
│  Scratchpad (agent/scratchpad.ts)                   │
│  JSONL-persisted source of truth for tool results   │
├─────────────────────────────────────────────────────┤
│  Context Management (compact.ts, microcompact.ts)   │
│  Per-turn trimming + LLM summarization compaction   │
├─────────────────────────────────────────────────────┤
│  Memory (memory/) + Skills (skills/)                │
│  Persistent user memory + SKILL.md workflows        │
└─────────────────────────────────────────────────────┘
```

## Current Argus Codebase Map

```
argus/
├── src/
│   ├── cli/                         # Terminal UI (Ink + React)
│   │   ├── index.tsx                # Entry point — meow CLI router, 10 commands
│   │   ├── App.tsx                  # Root React component, command dispatcher
│   │   ├── theme.ts                 # Colors, symbols, banner, version
│   │   ├── commands/
│   │   │   ├── chat.tsx             # Chat handler — slash commands + LLM routing
│   │   │   ├── init.ts              # Workspace init
│   │   │   ├── ingest.ts            # File ingestion
│   │   │   ├── investigate.ts       # Investigation runner w/ watch mode
│   │   │   ├── findings.ts          # List findings
│   │   │   ├── explain.ts           # Deep-dive finding
│   │   │   ├── feedback.ts          # Human feedback + calibration
│   │   │   ├── status.ts            # System health
│   │   │   └── report.ts            # Text report generation
│   │   └── components/
│   │       ├── ChatUI.tsx           # Monolithic chat component (297 lines)
│   │       ├── WelcomeFlow.tsx      # Onboarding wizard
│   │       ├── InvestigationStream.tsx  # Live event stream
│   │       ├── FindingCard.tsx      # Single finding card
│   │       ├── FindingsTable.tsx    # Tabular findings
│   │       ├── EvidenceChain.tsx    # Deep-dive evidence view
│   │       ├── StatusBar.tsx        # System status panel
│   │       └── ParseErrorPreview.tsx # CSV parse errors
│   │
│   ├── agents/                      # Investigation agents (LangGraph-like)
│   │   ├── index.ts                 # Agent registration imports
│   │   ├── supervisor.ts            # Orchestrator — routing, dispatch
│   │   ├── state-machine.ts         # Custom 6-node loop (not LangGraph)
│   │   ├── saas-waste.ts
│   │   ├── duplicate-payments.ts
│   │   ├── vendor-overbilling.ts
│   │   ├── policy-violations.ts
│   │   ├── reconciliation.ts
│   │   ├── anomaly-detection.ts
│   │   ├── cashflow-risk.ts
│   │   └── nodes/                   # Shared state machine nodes
│   │       ├── classify.ts          # Stub
│   │       ├── retrieve-evidence.ts
│   │       ├── run-comparison.ts    # Stub (returns [])
│   │       ├── score-confidence.ts
│   │       └── generate-finding.ts
│   │
│   ├── engine/                      # Core engine
│   │   ├── events.ts                # AuditEvent async generator buffer
│   │   ├── scratchpad.ts            # JSONL audit trail + retention pruning
│   │   ├── risk-scorer.ts           # 3-factor risk scoring (unused)
│   │   ├── finding-builder.ts       # Fingerprinting, ID gen, severity
│   │   └── activation.ts            # Data-driven agent unlock
│   │
│   ├── ingest/                      # Dual ingestion pipeline
│   │   ├── csv-parser.ts            # CSV + Zod validation
│   │   ├── xlsx-parser.ts           # xlsx parsing (dynamic require)
│   │   ├── pdf-extractor.ts         # PDF text extraction
│   │   ├── contract-parser.ts       # Contract terms from PDF
│   │   ├── normalizer.ts            # Canonical schema mapping (old)
│   │   ├── universal-normalizer.ts  # Schema-aware normalization (new)
│   │   ├── schema-detector.ts       # LLM + deterministic detection
│   │   ├── column-matcher.ts        # Column keyword matching
│   │   ├── file-inspector.ts        # File format detection
│   │   ├── smart-sampler.ts         # Smart row sampling
│   │   └── vendor-resolver.ts       # Fuzzy vendor matching
│   │
│   ├── llm/                         # LLM providers (no unified abstraction)
│   │   ├── groq.ts                  # Groq client — streaming + non-streaming
│   │   └── openrouter.ts            # OpenRouter client — streaming + non-streaming
│   │
│   ├── model/                       # Types and schemas
│   │   ├── types.ts                 # All core types + ChatEvent union
│   │   └── schemas.ts               # Zod validation schemas
│   │
│   └── db/                          # SQLite (bun:sqlite)
│       ├── index.ts                 # Connection + init
│       ├── schema.ts                # 8 table definitions
│       └── queries.ts               # Typed CRUD functions
│
├── .audit/                          # Workspace data (gitignored)
│   ├── scratchpad/*.jsonl           # Investigation audit trails
│   └── spend-auditor.db             # SQLite database
├── docs/
│   ├── chat-improvements.md         # Dexter-inspired improvement plan (Phase 1-3 already done)
│   └── chat-mode.md                 # Chat mode walkthrough
├── test-data/                       # CSVs, PDFs, xlsx
├── .env.example                     # GROQ_API_KEY, OPENROUTER_API_KEY
├── package.json                     # ink, ink-spinner, ink-text-input, langgraph, zod, csv-parse, pdf-parse
└── tsconfig.json
```

## Layer-by-Layer Comparison

### 1. Terminal UI

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| UI framework | Component tree (pi-tui) | Ink + React | Equivalent |
| ChatLog | Separate component | Inline in `ChatUI.tsx` | Not extracted |
| WorkingIndicator | Separate component with mode states | Inline spinner + statusText | Not extracted |
| HintBar | Separate component | Inline in ChatUI (STATUS_BAR constant) | Not extracted |
| Editor (CustomEditor) | Separate component | `ink-text-input` via TextInput | Comparable |
| DebugPanel | Separate component | Not present | Missing |
| Tool progress rows | Live per-tool rows with spinner → done/error | Basic tool_start/tool_end rendering | Partial |
| Approval prompts | Modal overlay for write/edit | Not present | Missing |
| Inline question widget | Multi-choice prompt replaces editor | Not present | Missing |
| Real-time streaming | Per-chunk StreamProgressEvent | LLM streaming works | Equivalent |

**What exists:** ChatUI has streaming, input history (up/down arrows), interrupt (Escape key), message queue, queue count display, color-coded messages, scrollable view.

### 2. Controllers

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| AgentRunnerController | Bridges UI events → Agent | None — `handleChatMessage()` does both routing + execution | Missing |
| ModelSelectionController | Manages model switching | None — model hardcoded per provider file | Missing |
| HistoryItems | Display event mapping | None — ChatUI renders directly from ChatEvent stream | Missing |
| runQuery() | Entry point for query execution | `onSubmit()` → `doProcess()` inline in ChatUI | Partial |

**What exists:** `handleChatMessage()` in `chat.tsx` routes slash commands and LLM queries, yields `ChatEvent` async generator. `ChatUI.onSubmit()` drives the event loop.

### 3. Agent Loop

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| Agent class | `agent.ts` — iterative LLM → tool calls → LLM | `state-machine.ts` — custom classify→retrieve→compare→score→loop | Different paradigm |
| Messages array | [System, history..., HumanMessage(query)] | Single prompt string to groqStream | Not structured |
| Tool call requests | LLM responds with tool calls or final answer | Routing is hardcoded in chat.tsx (regex match → function) | Not LLM-driven |
| Max iterations | 10 | 5 (in state-machine.ts) | Different |

**What exists:** The state machine loops with iteration guard, emits typed AuditEvent objects. Each agent implements classify/retrieve/compare/score methods. Supervisor dispatches agents sequentially.

### 4. LLM Layer

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| Unified abstraction | `model/llm.ts` — common interface | None — each provider is standalone | Missing |
| Model selection | `model/model-selection.ts` | None — model hardcoded (llama-3.3-70b / laguna-xs.2) | Missing |
| Streaming | Generic streamLlmWithMessages() | `groqStream()` + `openrouterStream()` | Per-provider, not unified |
| Providers | OpenAI / Anthropic / etc. | Groq / OpenRouter | Comparable set |
| Prompt caching | Anthropic cache_control support | Not present | Missing |

**What exists:** Both providers have streaming + non-streaming. `LLMChunk` type (`token` | `done`). AbortSignal support. Timeout handling.

### 5. Tool Executor

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| executeAll() | Concurrent-safe batching | None — tools called directly | Missing |
| Concurrency | Read-only tools in parallel (up to 10) | Sequential agent dispatch | Missing |
| Approval gating | write_file/edit_file need approval | Not implemented | Missing |
| Event yields | tool_start → progress → tool_end/error | ChatUI yields tool_start/tool_end | Basic events exist |

**What exists:** `ChatEvent` includes `tool_start`, `tool_end`, `tool_error`. ChatUI renders them with toolCallId mapping.

### 6. Tool Registry

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| Registry | `tools/registry.ts` — all tools defined centrally | None — logic in chat.tsx routing | Missing |
| Finance tools | query_db, analyze, etc. | Agents implement their own logic | Different |
| Web tools | fetch, search, etc. | Not present | Missing |
| Browser tools | Puppeteer-based | Not present | Missing |
| Filesystem tools | read_file, write_file, edit_file | Not as agent-callable tools | Missing |
| Memory tools | read_memory, write_memory | Not present | Missing |

**What exists:** The `argus` CLI commands (ingest, investigate, findings, explain) are the closest analogue — they're functions, not tool definitions. Chat routing uses regex matching in `handleChatMessage()`.

### 7. Scratchpad

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| Persistence | JSONL file per run | JSONL file per investigation run | Equivalent |
| In-memory | Mirrored for performance | Not doubly-stored | Minor |
| Large result handling | Disk persistence for oversized results | Not implemented | Missing |
| Result budget | enforceResultBudget() | Not implemented | Missing |

**What exists:** `src/engine/scratchpad.ts` — `initScratchpad()`, `writeScratchpadEntry()`, `pruneScratchpad()`, `readScratchpadEvents()`. Persists to `.audit/scratchpad/*.jsonl`. 30-file retention.

### 8. Context Management

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| Microcompact | Per-turn lightweight trimming | Not present | Missing |
| Compact | LLM summarization compaction | Not present | Missing |
| Token threshold detection | Approaching limit → flush → summarize → truncate | Not present | Missing |
| Memory flush | Before compaction | Not present | Missing |

**What exists:** Nothing. This entire layer is absent.

### 9. Memory & Skills

| Feature | Dexter | Argus | Gap |
|---|---|---|---|
| Memory directory | `memory/` — persistent user memory | Not present | Missing |
| Skills directory | `skills/` — SKILL.md workflows | Not present | Missing |
| Identity file | SOUL.md | Not present | Missing |
| Rules file | RULES.md | Not present | Missing |

**What exists:** Nothing. These systems don't exist.

## Already Implemented (from Prior Dexter-Inspired Plan)

These features from `docs/chat-improvements.md` Phases 1-3 are already built:

- **Streaming LLM**: `groqStream()` + `openrouterStream()` yield per-token chunks
- **Rich event types**: Complete `ChatEvent` union (user_message, agent_thinking, tool_start, tool_end, tool_error, llm_chunk, llm_done, done, error, clear, help)
- **Ink-based chat UI**: `ChatUI.tsx` renders to terminal via Ink
- **Input history**: `useRef<string[]>` + up/down arrow navigation
- **Cancel/interrupt**: `AbortController` + Escape key + AbortSignal propagation
- **Message queue**: `queueRef` + `processNext()` drains mid-loop
- **Slash commands**: `/findings`, `/investigate`, `/status`, `/clear`, `/help`
- **Color-coded events**: Blue for user, cyan for thinking, green for success, red for error

## Proposed Addition Phases

### Phase A — Foundations (Highest Impact)

#### A1. Unified LLM Abstraction (`src/model/llm.ts`)

Create a common interface that all providers implement:

```typescript
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LLMProvider {
  complete(messages: LLMMessage[], tools?: ToolDef[]): Promise<LLMResponse>;
  stream(messages: LLMMessage[], tools?: ToolDef[]): AsyncGenerator<LLMChunk>;
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
  latencyMs: number;
  model: string;
}
```

**Rationale:** A single interface lets the agent loop generically call any provider. Currently Groq and OpenRouter have parallel but separate implementations. Adding `AnthropicProvider` or `OpenAIProvider` requires no agent changes.

**Files to create:**
- `src/model/llm.ts` — interfaces (LLMMessage, ToolCall, LLMProvider, LLMResponse, LLMChunk)

**Files to modify:**
- `src/llm/groq.ts` — implement `GroqProvider implements LLMProvider`
- `src/llm/openrouter.ts` — implement `OpenRouterProvider implements LLMProvider`

---

#### A2. Model Selection (`src/model/model-selection.ts`)

```typescript
export interface ModelConfig {
  provider: "groq" | "openrouter" | "anthropic" | "openai";
  modelId: string;
  label: string;
}

const PRESETS: Record<string, ModelConfig> = {
  fast:    { provider: "groq", modelId: "llama-3.3-70b-versatile", label: "Groq Llama 70B" },
  cheap:   { provider: "openrouter", modelId: "poolside/laguna-xs.2:free", label: "OpenRouter Laguna" },
  quality: { provider: "openrouter", modelId: "anthropic/claude-sonnet", label: "Claude Sonnet" },
};
```

**Rationale:** `/model` slash command switches provider at runtime. Each model preset chooses speed vs cost vs quality.

**Files to create:**
- `src/model/model-selection.ts` — ModelConfig, provider factory, switch command handler

---

#### A3. Tool Registry (`src/tools/registry.ts`)

Define tools as first-class objects:

```typescript
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  concurrencySafe: boolean;
  needsApproval: boolean;
  execute(args: unknown, ctx: ToolContext): AsyncGenerator<ToolEvent>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef): void;
  get(name: string): ToolDef | undefined;
  getAll(): ToolDef[];
  getSystemPrompt(): string;  // Auto-generates tool descriptions for system message
}
```

**Rationale:** The central registry is the LLM's API surface. Every tool the agent can call is defined here with name, description, JSON Schema parameters, and execution function. The registry auto-generates the tool definitions block in the system prompt.

**Default tool set:**
| Tool | Description | concurrencySafe | needsApproval |
|---|---|---|---|
| `query_financial_data` | SQL query against ingested records | ✅ | ❌ |
| `list_findings` | Search/results findings | ✅ | ❌ |
| `get_finding` | Get single finding with evidence | ✅ | ❌ |
| `get_status` | Workspace + ingestion stats | ✅ | ❌ |
| `run_investigation` | Trigger investigation agents | ❌ | ❌ |
| `ask_user_question` | Ask user a multi-choice question | ✅ | ❌ |
| `read_file` | Read file contents | ✅ | ❌ |
| `write_file` | Write content to file | ❌ | ✅ |
| `edit_file` | Edit existing file | ❌ | ✅ |
| `web_search` | Search the web | ✅ | ❌ |
| `memory_read` | Read persistent memory | ✅ | ❌ |
| `memory_write` | Write to persistent memory | ❌ | ❌ |

**Files to create:**
- `src/tools/registry.ts` — ToolDef, ToolEvent, ToolRegistry
- `src/tools/finance.ts` — query_financial_data, list_findings, get_finding
- `src/tools/workspace.ts` — get_status, run_investigation
- `src/tools/filesystem.ts` — read_file, write_file, edit_file
- `src/tools/memory.ts` — memory_read, memory_write
- `src/tools/web.ts` — web_search
- `src/tools/ask-user.ts` — ask_user_question

---

#### A4. Agent Loop (`src/agent/agent.ts`)

The core iterative loop:

```
Messages = [SystemMessage, conversation_history..., HumanMessage(query)]

for iteration < MAX_ITERATIONS:
    response = LLM.stream(Messages, tools=tools)
    if response has tool_calls:
        for each tool_call:
            execute tool → ToolMessage
            append ToolMessage to Messages
            append to Scratchpad
    else:
        # Final answer
        yield final answer
        break
```

```typescript
export class Agent {
  static async create(config: AgentConfig): Promise<Agent>;

  async *run(query: string): AsyncGenerator<AgentEvent> {
    // 1. Build messages array
    // 2. Stream LLM call
    // 3. Handle tool calls (via ToolExecutor)
    // 4. Post-tool processing (result budget, compaction, queue drain)
    // 5. Loop until final answer
    // 6. Final answer generation (no tools)
  }
}
```

**Rationale:** This replaces the hardcoded `handleChatMessage()` routing with a truly LLM-driven agent. The LLM decides which tool to call based on the tool registry's descriptions. This is the biggest paradigm shift — from "routed commands" to "autonomous agent."

**Files to create:**
- `src/agent/agent.ts` — Agent class, AgentConfig, AgentEvent types
- `src/agent/agent-runner.ts` — Bridges UI events, manages HistoryItems
- `src/agent/types.ts` — AgentEvent union (stream_progress, tool_start, tool_end, tool_error, thinking, done)

**Files to modify:**
- `src/cli/commands/chat.tsx` — Replace handleChatMessage routing with Agent.run()
- `src/model/types.ts` — Add AgentEvent types

---

#### A5. Tool Executor (`src/agent/tool-executor.ts`)

```typescript
export class AgentToolExecutor {
  constructor(private registry: ToolRegistry, private approvalGate?: ApprovalGate) {}

  async *executeAll(toolCalls: ToolCall[]): AsyncGenerator<ToolEvent> {
    // 1. Partition: concurrencySafe read-only tools vs serial write tools
    // 2. Execute concurrent batch (up to 10-wide) via Promise.all
    // 3. Execute serial tools one at a time
    // 4. For needsApproval: yield approval request, wait for user decision
    // 5. Each tool yields: tool_start → progress (optional) → tool_end/tool_error
  }
}
```

**Rationale:** Proper batching avoids sequential tool execution when tools are independent (e.g., querying multiple data sources in parallel). Approval gating prevents the agent from writing/editing files without user consent.

**Files to create:**
- `src/agent/tool-executor.ts` — AgentToolExecutor, ExecutionBatch, ToolEvent

---

### Phase B — Context & Memory (Medium Impact)

#### B6. Context Management (`src/agent/compact.ts`, `src/agent/microcompact.ts`)

**Microcompact** — lightweight per-turn trimming:
```
Before each LLM call:
  for each ToolMessage in messages:
    if message.content > MICROCOMPACT_THRESHOLD (e.g. 2000 chars):
      create preview (first 500 chars + "... [truncated N chars]")
  This is in-memory only — scratchpad JSONL is untouched
```

**Compact** — LLM summarization when approaching token limit:
```
When total tokens > COMPACT_THRESHOLD (e.g. 80% of context window):
  1. Flush current messages to memory_write
  2. Call LLM: "Summarize the conversation so far"
  3. Replace old conversation with summary message
  4. If still over limit: truncate oldest non-system messages
```

**Result budget** — prevent a single tool result from bloating context:
```
enforceResultBudget(message, budget=10000):
  if message.content.length > budget:
    save full content to scratchpad file
    replace with preview + reference to scratchpad file
```

**Files to create:**
- `src/agent/compact.ts` — compactMessages(), summarizeConversation()
- `src/agent/microcompact.ts` — microcompactMessages()
- `src/agent/result-budget.ts` — enforceResultBudget()

---

#### B7. Memory System (`memory/`)

```
memory/
├── index.ts          # MemoryManager class
└── memory.jsonl      # Persistent key-value store
```

```typescript
export class MemoryManager {
  async read(key: string): Promise<string | null>;
  async write(key: string, value: string): Promise<void>;
  async getAll(): Promise<Record<string, string>>;
  getSystemPromptBlock(): string;  // Injects relevant memories into system prompt
}
```

Memory stores persistent facts across sessions (user preferences, previous findings context, workspace details). Loaded into system prompt on agent creation.

**Files to create:**
- `src/memory/index.ts` — MemoryManager, memory tools

---

#### B8. Skills System (`skills/`)

```
skills/
├── index.ts            # SkillsManager
├── investigate.md      # Investigation workflow
└── analyze.md          # Data analysis workflow
```

Each SKILL.md defines a reusable prompt fragment with step-by-step instructions for the LLM.

**Files to create:**
- `src/skills/index.ts` — SkillsManager, loadSkill(), getSystemPromptBlock()

---

#### B9. Identity & Rules Files

- `SOUL.md` — Agent identity/persona ("You are Argus, an autonomous financial investigator...")
- `RULES.md` — Behavioral rules ("Never commit secrets", "Always cite evidence sources", etc.)

Loaded into system prompt on Agent.create().

---

### Phase C — UI Polish & Quality of Life (Lower Impact)

#### C10. Modular UI Components

Extract from monolithic `ChatUI.tsx` (currently 297 lines):

| Component | Responsibility | Lines saved |
|---|---|---|
| `ChatLog.tsx` | Scrolling message list, auto-scroll, color rendering | ~60 |
| `WorkingIndicator.tsx` | Spinner + status text + queue count | ~30 |
| `HintBar.tsx` | Status bar with mode/shortcut hints | ~20 |
| `DebugPanel.tsx` | Expandable debug/state panel | ~40 |
| `ApprovalModal.tsx` | Approval prompt overlay | ~40 |

**Files to create:**
- `src/cli/components/ChatLog.tsx`
- `src/cli/components/WorkingIndicator.tsx`
- `src/cli/components/HintBar.tsx`
- `src/cli/components/DebugPanel.tsx`
- `src/cli/components/ApprovalModal.tsx`

**Files to modify:**
- `src/cli/components/ChatUI.tsx` — Use extracted components

---

#### C11. Additional Slash Commands

| Command | Action | Implementation |
|---|---|---|
| `/model <name>` | Switch LLM model | ModelSelectionController |
| `/search <query>` | Web search via tool | web_search tool |
| `/memory` | Show/edit persistent memory | MemoryManager |
| `/heartbeat` | Test agent loop is alive | Agent.heartbeat() |
| `/history` | Show conversation history count | InMemoryChatHistory |
| `/rules` | Show current RULES.md | Read from filesystem |

---

#### C12. Agent Identity Files (`SOUL.md`, `RULES.md`)

```
.audit/
├── SOUL.md     # Loaded on Agent.create()
└── RULES.md    # Loaded on Agent.create()
```

These are user-editable files in the workspace that define the agent's behavior.

---

#### C13. Approval Gate

```typescript
export interface ApprovalGate {
  requestApproval(tool: string, args: unknown): Promise<"allow-once" | "allow-session" | "deny">;
}
```

ChatUI implementation renders an Ink overlay with three buttons. "allow-session" skips future prompts for that tool type.

---

#### C14. ChannelProfile (Multi-Channel Prep)

```typescript
export interface ChannelProfile {
  name: string;              // "cli" | "whatsapp"
  responseFormat: "markdown" | "plain" | "whatsapp-md";
  maxResponseLength: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
}
```

**Rationale:** Decouples agent logic from presentation. WhatsApp gateway can reuse Agent class with a different ChannelProfile.

---

## Current Architecture Flow (Argus)

```
User types in ChatUI
       │
       ▼
ChatUI.onSubmit()
  → AbortController
  → handleChatMessage(query, cwd, signal)
       │
       ▼
handleChatMessage() ── routing:
  ├── "/findings"       → getFindings() → yield events
  ├── "/investigate"    → runSupervisor() → yield AuditEvent[] as ChatEvent[]
  ├── "/status"         → getStatus() → yield events
  ├── "/clear"          → yield { type: "clear" }
  ├── "/help"           → yield { type: "help", commands }
  ├── "findings/routes" → regex match → direct function call
  ├── "investigate/run" → regex match → runSupervisor()
  ├── "explain <id>"    → getFindingById() → yield events
  ├── "ingest <path>"   → ingestFile() → yield events
  └── else              → groqStream(prompt) → yield llm_chunk events
       │
       ▼
ChatUI consumer loop:
  for await (event of gen):
    agent_thinking → addMessage()
    tool_start     → addMessage() + track toolCallId
    tool_end       → updateByToolCallId()
    llm_chunk      → appendToLast() streaming token
    done           → setStatusText("Ready.")
    error          → addMessage("Error: ...")
```

## Target Architecture Flow (Dexter-Inspired)

```
User types in ChatUI
       │
       ▼
ChatUI.onSubmit()
  → AgentRunnerController.runQuery(query)
       │
       ▼
AgentRunnerController:
  1. Creates Agent via Agent.create()
     → loads SOUL.md, RULES.md, memory context
     → builds ToolRegistry with all tools
     → constructs system prompt
  2. Calls agent.run(query)
       │
       ▼
Agent.run(query):
  Messages = [System, history..., HumanMessage(query)]
  
  loop (max 10):
    ├── microcompact(Messages)  ← trim oversized ToolMessages
    ├── response = LLM.stream(Messages, tools)
    │     yield StreamProgressEvent(chunk) for each token
    │
    ├── if response has tool_calls:
    │     for each batch in ToolExecutor.executeAll(tool_calls):
    │         yield tool_start / tool_progress / tool_end events
    │         append ToolMessage to Messages
    │         write to Scratchpad
    │     enforceResultBudget()
    │     drain message queue (mid-loop)
    │     if tokens > threshold → flush memory → compact → truncate
    │
    └── else:
          yield final answer (streaming)
          break
```

## Migration Strategy

### Phase A (Weeks 1-2)
1. `src/model/llm.ts` — LLM interfaces
2. Refactor `groq.ts` → `GroqProvider`, `openrouter.ts` → `OpenRouterProvider`
3. `src/model/model-selection.ts` — provider factory + /model command
4. `src/tools/registry.ts` + individual tool files
5. `src/agent/agent.ts` — iterative agent loop
6. `src/agent/tool-executor.ts` — concurrent batching + approval
7. `src/agent/agent-runner.ts` — bridge UI events
8. Rewrite `chat.tsx` to use Agent instead of hardcoded routing

### Phase B (Week 3)
9. `src/agent/microcompact.ts` + `src/agent/compact.ts` + `src/agent/result-budget.ts`
10. `src/memory/` — MemoryManager
11. `src/skills/` — SkillsManager
12. `SOUL.md` + `RULES.md` — identity/rule files

### Phase C (Week 4)
13. Extract modular UI components (ChatLog, WorkingIndicator, HintBar, DebugPanel, ApprovalModal)
14. Add remaining slash commands
15. Approval gate UI
16. ChannelProfile for multi-channel 
