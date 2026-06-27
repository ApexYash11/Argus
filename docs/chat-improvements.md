# Argus Chat Mode — Improvement Plan (Inspired by Dexter)

Based on analysis of [virattt/dexter](https://github.com/virattt/dexter), a state-of-the-art autonomous financial research agent with a polished interactive chat UI.

---

## Current State vs. Target

| Feature | Dexter | Argus (Current) | Priority |
|---------|--------|-----------------|----------|
| LLM streaming | Streams tokens in real-time | Blocking `await groqComplete()` | 🔴 High |
| Agent event types | `tool_start`, `tool_end`, `tool_progress`, `stream_progress`, `thinking`, `done` | Yields raw strings | 🔴 High |
| UI framework | Component tree (pi-tui: containers, text, spacers) | Bare `readline` + `console.log` | 🔴 High |
| Incremental rendering | Only new/changed events re-render, throttled 30fps | Full screen of `console.log` lines | 🔴 High |
| Working indicator | Spinner showing current state (thinking, running tool, idle) | None | 🔴 High |
| Input history | Up/down arrows navigate past queries | None | 🟡 Medium |
| Cancel/interrupt | Escape cancels mid-query | Only Ctrl+C kills process | 🟡 Medium |
| Message queue | Type follow-ups while agent processes; queued and drained | Blocks until complete | 🟡 Medium |
| Slash commands | `/model`, `/clear`, `/help`, `/history`, `/memory` | None | 🟢 Lower |
| Answer box | Final answer rendered with markdown, collapsible tool results | Raw text | 🟢 Lower |

---

## Phase 1: Streaming LLM + Rich UI

**Goal:** Replace raw `readline` with an Ink-based interactive chat that streams LLM responses and shows agent state.

### What to build

**1a. Streaming LLM client** (`src/llm/groq.ts`)

Add `groqStream()` that uses Groq's SSE streaming API to yield token chunks:

```typescript
export async function* groqStream(
  prompt: string,
  systemPrompt?: string
): AsyncGenerator<LLMChunk> {
  // Uses fetch with ReadableStream
  // Parses SSE data: {"choices":[{"delta":{"content":"..."}}]}
  // Yields { type: "token", text: "..." } for each chunk
  // Yields { type: "done", fullText: "...", latencyMs: N } when complete
}
```

**1b. Rich event types** (`src/model/types.ts`)

Add chat-specific event types:

```typescript
export type ChatEvent =
  | { type: "user_message"; text: string }
  | { type: "agent_thinking"; message: string }
  | { type: "tool_start"; tool: string; args: string; toolCallId: string }
  | { type: "tool_end"; tool: string; summary: string; durationMs: number; toolCallId: string }
  | { type: "tool_error"; tool: string; error: string; toolCallId: string }
  | { type: "llm_chunk"; text: string }
  | { type: "llm_done"; fullText: string }
  | { type: "done"; totalFindings?: number; durationMs: number }
  | { type: "error"; message: string };
```

**1c. Rewrite chat handler** (`src/cli/commands/chat.ts`)

Convert `handleChatMessage` to yield `ChatEvent` objects instead of strings. The routing stays the same (investigate, findings, explain, ingest, LLM) but each route emits structured events.

**1d. Ink-based chat UI** (`src/cli/components/ChatUI.tsx`)

New Ink component tree:

```
<ChatUI>
  <ChatLog>              ← scrollable message list
    <UserMessage />      ← "argus › what did you find"
    <AgentThinking />    ← "◆ Dispatching saas-waste agent"
    <ToolEvent />        ← "◇ Running duplicate-payments check..."
    <LLMStream />        ← streaming text that fills in token by token
    <AgentError />       ← "Error: ..."
  </ChatLog>
  <WorkingIndicator />   ← ink-spinner while processing
  <ChatInput />          ← ink-text-input at the bottom
</ChatUI>
```

State management via `useState` + `useEffect` — as `ChatEvent` objects arrive, they get appended to a `messages` array and rendered incrementally.

**1e. Update entry point** (`src/cli/index.tsx`)

Replace the readline-based `startChat(cwd)` with an Ink `render(<ChatUI cwd={cwd} />)` call.

### Files to create/modify

| File | Action |
|------|--------|
| `src/llm/groq.ts` | Add `groqStream()` function |
| `src/model/types.ts` | Add `ChatEvent` union type |
| `src/cli/commands/chat.ts` | Rewrite to yield `ChatEvent` objects |
| `src/cli/components/ChatUI.tsx` | **New** — main chat component |
| `src/cli/components/ChatLog.tsx` | **New** — scrolling message list |
| `src/cli/components/ChatInput.tsx` | **New** — input box with submit |
| `src/cli/components/WorkingIndicator.tsx` | **New** — spinner with status |
| `src/cli/index.tsx` | Update `startChat` call to Ink render |

### Dependencies

All already in `package.json`: `ink`, `ink-spinner`, `ink-text-input`, `react`.

---

## Phase 2: Input History + Interrupt + Queue

**Goal:** Make the chat feel responsive — navigate past queries, cancel mid-flight, queue follow-ups.

### 2a. Input History

- Store past queries in a `useRef<string[]>` array in `ChatUI`
- `useInput` hook captures up/down arrows
- Up arrow: replace current input with previous query
- Down arrow: cycle forward through history

### 2b. Cancel / Interrupt

- Maintain an `AbortController` ref in `ChatUI`
- Escape key calls `controller.abort()`
- Propagate `AbortSignal` through:
  - `handleChatMessage` → `runSupervisor` → each agent
  - `groqStream` → fetch `signal`
  - `ingestFile` → skip remaining records
- On abort: emit `{ type: "done" }` and stop processing

### 2c. Message Queue

- If user presses Enter while a previous query is still processing:
  - Add input to a `useRef<string[]>` queue
  - Agent checks queue mid-loop (after each tool completes)
  - If queued messages exist, processes the next one
  - Show `"(1 message queued)"` hint in the input bar

### Files to modify

| File | Change |
|------|--------|
| `src/cli/components/ChatUI.tsx` | Add history, AbortController, queue logic |
| `src/cli/components/ChatInput.tsx` | Up/down arrow navigation, queue indicator |
| `src/cli/commands/chat.ts` | Accept AbortSignal, check queue |

---

## Phase 3: Slash Commands + Polish

**Goal:** Power-user shortcuts and visual polish.

### 3a. Slash commands

Parsed in `handleChatMessage` before routing:

| Command | Action |
|---------|--------|
| `/findings` | List all findings |
| `/investigate` | Run investigation agents |
| `/status` | Show workspace status + record counts |
| `/help` | Show available commands and keybindings |
| `/clear` | Clear chat message history |
| `/models` | Switch LLM provider (future) |

### 3b. Visual polish

- Color-code event types (same as `InvestigationStream`):
  - Blue `◆` for step/thinking messages
  - Green `▶` for findings
  - Purple `→` for evidence
  - Yellow for confidence scores
- Show elapsed time next to completed tool calls
- Tool calls collapse/expand (show args on click? — keyboard-based)

### Files to modify

| File | Change |
|------|--------|
| `src/cli/commands/chat.ts` | Add slash command routing |
| `src/cli/components/ChatUI.tsx` | Color coding, timestamps, collapsed tools |

---

## Architecture Diagram (Target)

```
User types query
       │
       ▼
┌─────────────────────────────┐
│  ChatInput (ink-text-input) │
│  - submit on Enter          │
│  - up/down for history      │
│  - shows queue count        │
└─────────┬───────────────────┘
          │ query string
          ▼
┌─────────────────────────────┐
│  ChatUI (main component)    │
│  - manages AbortController  │
│  - manages message queue    │
│  - feeds events to ChatLog  │
└─────────┬───────────────────┘
          │ query + signal + queue
          ▼
┌─────────────────────────────┐
│  handleChatMessage()        │
│  - routes by intent         │
│  - yields ChatEvent[]       │
│  - checks AbortSignal       │
│  - drains queue mid-loop    │
└─────────┬───────────────────┘
          │ AsyncGenerator<ChatEvent>
          ▼
┌─────────────────────────────┐
│  ChatLog (message list)     │
│  - appends new events       │
│  - streams LLM tokens       │
│  - color-coded by type      │
│  - auto-scrolls to bottom   │
└─────────────────────────────┘
```

---

## How to Start

1. **Phase 1 first** — the Ink-based streaming UI is the highest-impact change. It makes the chat feel like a real interactive agent rather than a script.
2. **Then Phase 2** for responsiveness (interrupt + queue).
3. **Then Phase 3** for polish (slash commands, colors).

Each phase is self-contained and can be worked on independently.
