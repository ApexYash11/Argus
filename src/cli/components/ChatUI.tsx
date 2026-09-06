import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import type { ChatEvent } from "../../model/types";
import { handleChatMessage } from "../commands/chat";
import type { ChatContext } from "../commands/chat";
import { BANNER, C, SYM, VERSION } from "../theme";
import path from "path";

const SLASH_COMMANDS = [
  { name: "/findings", description: "List all findings" },
  { name: "/investigate", description: "Run investigation agents" },
  { name: "/status", description: "Show workspace status" },
  { name: "/digest", description: "Weekly markdown summary" },
  { name: "/clear", description: "Clear chat history" },
  { name: "/help", description: "Show all commands" },
];

const SUGGESTIONS = [
  "analyze my subscriptions for waste",
  "run anomaly detection on my spending",
  "show me open high-severity findings",
];

const TOOL_LABELS: Record<string, string> = {
  list_findings: "Searching findings",
  get_finding: "Opening finding",
  get_status: "Checking workspace health",
  run_investigation: "Running investigation",
};

function describeToolArgs(rawArgs: string): string {
  try {
    const args = JSON.parse(rawArgs) as Record<string, unknown>;
    const bits = Object.entries(args)
      .filter(([, v]) => typeof v === "string" && v.length > 0)
      .map(([k, v]) => `${k}: ${v}`);
    return bits.length > 0 ? ` (${bits.join(", ")})` : "";
  } catch {
    return "";
  }
}

function shortSummary(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const STATUS_BAR = "\u2578ARGUS\u257A  chat mode  \u00B7  type \"exit\" to quit  \u00B7  Esc to cancel";
const RESERVED_LINES = 6;

interface Message {
  id: number;
  type: ChatEvent["type"];
  text: string;
  isUser: boolean;
  accent?: boolean;
}

export default function ChatUI({ cwd, chatCtx }: { cwd: string; chatCtx: ChatContext }) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [, forceRender] = useState(0);

  const messagesRef = useRef<Message[]>([]);
  const msgId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputHistory = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const inputRef = useRef("");
  const setInputRef = useRef<(s: string) => void>(() => {});
  const toolMsgMap = useRef<Map<string, number>>(new Map());
  const streamMsgId = useRef<number | null>(null);
  const toolsUsedRef = useRef<string[]>([]);

  const removeMessage = useCallback((id: number) => {
    messagesRef.current = messagesRef.current.filter((m) => m.id !== id);
    forceRender((n) => n + 1);
  }, []);

  useEffect(() => {
    setInputRef.current = setInput;
    const base = path.basename(cwd);
    const prov = (process.env.OPENROUTER_API_KEY ? "openrouter" : process.env.GROQ_API_KEY ? "groq" : "local") as "openrouter" | "groq" | "local";
    const model = process.env.OPENROUTER_MODEL ?? (prov === "openrouter" ? "openrouter/free" : prov);
    const lines: Message[] = [
      ...BANNER.map((line) => ({ id: msgId.current++, type: "agent_thinking" as const, text: line, isUser: false, accent: true })),
      { id: msgId.current++, type: "agent_thinking" as const, text: `ARGUS ${VERSION} ${SYM.dot} ${base}`, isUser: false },
    ];
    if (prov === "local") {
      lines.push({ id: msgId.current++, type: "agent_thinking" as const, text: `${SYM.warn} LLM: local fallback (deterministic, no chat reasoning). Set OPENROUTER_API_KEY in .env to unlock agent chat.`, isUser: false });
    } else {
      lines.push({ id: msgId.current++, type: "agent_thinking" as const, text: `${SYM.ok} LLM: ${prov} (${model})`, isUser: false });
    }
    lines.push({ id: msgId.current++, type: "agent_thinking" as const, text: "Ask me to investigate — try one of these:", isUser: false });
    for (const s of SUGGESTIONS) {
      lines.push({ id: msgId.current++, type: "agent_thinking" as const, text: `  ${SYM.input} ${s}`, isUser: false });
    }
    lines.push({ id: msgId.current++, type: "agent_thinking" as const, text: "Commands: /findings /investigate /status /digest /clear /help — or just ask.", isUser: false });
    messagesRef.current = lines;
    forceRender((n) => n + 1);
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      if (abortRef.current) {
        abortRef.current.abort();
        setStatusText("Cancelling...");
      }
    }
    if (key.ctrl && key.shift && key.return) {
      exit();
    }
    if (key.upArrow) {
      const hist = inputHistory.current;
      if (hist.length === 0) return;
      const newIdx = historyIndex.current === -1 ? hist.length - 1 : Math.max(0, historyIndex.current - 1);
      historyIndex.current = newIdx;
      const val = hist[newIdx];
      if (val !== undefined) setInputRef.current(val);
    }
    if (key.downArrow) {
      const hist = inputHistory.current;
      if (historyIndex.current === -1) return;
      const newIdx = historyIndex.current + 1;
      if (newIdx >= hist.length) {
        historyIndex.current = -1;
        setInputRef.current("");
      } else {
        historyIndex.current = newIdx;
        const val2 = hist[newIdx];
        if (val2 !== undefined) setInputRef.current(val2);
      }
    }
  });

  const addMessage = useCallback((type: Message["type"], text: string, isUser: boolean): number => {
    const id = msgId.current++;
    messagesRef.current = [
      ...messagesRef.current,
      { id, type, text, isUser },
    ];
    forceRender((n) => n + 1);
    return id;
  }, []);

  const appendToLast = useCallback((text: string) => {
    const msgs = messagesRef.current;
    const last = msgs[msgs.length - 1];
    if (last && !last.isUser) {
      messagesRef.current = [
        ...msgs.slice(0, -1),
        { ...last, text: last.text + text },
      ];
      forceRender((n) => n + 1);
    }
  }, []);

  const updateByToolCallId = useCallback((toolCallId: string, text: string) => {
    const id = toolMsgMap.current.get(toolCallId);
    if (id === undefined) return;
    const msgs = messagesRef.current;
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const updated = [...msgs];
    updated[idx] = { ...updated[idx], text } as Message;
    messagesRef.current = updated;
    forceRender((n) => n + 1);
  }, []);

  function fmtDur(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  const doProcess = useCallback(async (query: string) => {
    processingRef.current = true;
    setProcessing(true);

    toolMsgMap.current.clear();
    streamMsgId.current = null;
    toolsUsedRef.current = [];
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = handleChatMessage(query, chatCtx, controller.signal);
    let llmActive = false;

    try {
      for await (const event of gen) {
        switch (event.type) {
          case "agent_thinking":
            addMessage("agent_thinking", event.message, false);
            setStatusText(event.message.slice(0, 60));
            break;
          case "tool_start": {
            // Drop any half-streamed raw tool JSON — replace with a clean card.
            if (streamMsgId.current !== null) {
              removeMessage(streamMsgId.current);
              streamMsgId.current = null;
              llmActive = false;
            }
            const label = TOOL_LABELS[event.tool] ?? event.tool;
            const detail = describeToolArgs(event.args);
            const mid = addMessage("tool_start", `${SYM.agent} ${label}${detail}…`, false);
            toolMsgMap.current.set(event.toolCallId, mid);
            if (!toolsUsedRef.current.includes(event.tool)) toolsUsedRef.current.push(event.tool);
            setStatusText(`${label}...`);
            break;
          }
          case "tool_end":
            updateByToolCallId(event.toolCallId, `${SYM.ok} ${shortSummary(event.summary)} (${fmtDur(event.durationMs)})`);
            setStatusText("Thinking...");
            break;
          case "tool_error":
            updateByToolCallId(event.toolCallId, `${SYM.warn} ${event.error}`);
            break;
          case "llm_chunk":
            if (!llmActive) {
              llmActive = true;
              streamMsgId.current = addMessage("llm_chunk", event.text, false);
              setStatusText("Responding…");
            } else {
              appendToLast(event.text);
            }
            break;
          case "llm_done":
            if (llmActive) {
              const msgs = messagesRef.current;
              const last = msgs[msgs.length - 1];
              if (last && !last.isUser) {
                const updated = [...msgs.slice(0, -1), { ...last, text: event.fullText } as Message];
                messagesRef.current = updated;
                forceRender((n) => n + 1);
              }
            } else {
              addMessage("llm_chunk", event.fullText, false);
            }
            streamMsgId.current = null;
            if (toolsUsedRef.current.length > 0) {
              addMessage("agent_thinking", `${SYM.dot} via ${toolsUsedRef.current.join(", ")}`, false);
              toolsUsedRef.current = [];
            }
            setStatusText("Ready.");
            break;
          case "done":
            setStatusText(
              event.totalFindings !== undefined
                ? `${event.totalFindings} finding(s) in ${fmtDur(event.durationMs)}`
                : "Ready."
            );
            break;
          case "error":
            addMessage("error", `Error: ${event.message}`, false);
            setStatusText("Error.");
            break;
          case "clear":
            messagesRef.current = [];
            toolMsgMap.current.clear();
            forceRender((n) => n + 1);
            break;
          case "help":
            for (const c of event.commands) {
              addMessage("agent_thinking", `  ${c.name.padEnd(20)} ${c.description}`, false);
            }
            break;
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        addMessage("error", `Error: ${err.message}`, false);
      }
    } finally {
      processingRef.current = false;
      setProcessing(false);
      abortRef.current = null;
      if (!llmActive) setStatusText("Ready.");
    }
  }, [cwd, addMessage, appendToLast, updateByToolCallId, removeMessage]);

  const processNext = useCallback(async () => {
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      setQueueCount(queueRef.current.length);
      await doProcess(next);
    }
  }, [doProcess]);

  const onSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setInput("");

    if (trimmed === "exit" || trimmed === "quit") {
      exit();
      return;
    }

    inputHistory.current.push(trimmed);
    historyIndex.current = -1;
    addMessage("user_message", trimmed, true);

    if (processingRef.current) {
      queueRef.current.push(trimmed);
      setQueueCount(queueRef.current.length);
      return;
    }

    await doProcess(trimmed);
    processNext();
  }, [addMessage, doProcess, processNext, exit]);

  const scrollMsgs = messagesRef.current;

  function msgColor(msg: Message): string | undefined {
    if (msg.isUser) return C.blue;
    if (msg.accent) return C.cyan;
    switch (msg.type) {
      case "error": return C.red;
      case "llm_chunk": return C.base;
      case "agent_thinking": return C.muted;
      case "tool_start": return C.muted;
      case "tool_end": return C.green;
      case "tool_error": return C.red;
      default: return C.muted;
    }
  }

  const slashMatches = input.startsWith("/")
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(input.toLowerCase())).slice(0, 6)
    : [];

  return (
    <Box flexDirection="column" height="100%" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={C.muted}>{STATUS_BAR}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {scrollMsgs.map((msg) => (
          <Box key={msg.id} marginBottom={1}>
            {msg.isUser ? (
              <Box>
                <Text color={C.blue}>{SYM.input} </Text>
                <Text bold>{msg.text}</Text>
              </Box>
            ) : msg.type === "agent_thinking" ? (
              <Box paddingLeft={2}>
                <Text color={msgColor(msg)}>{msg.text}</Text>
              </Box>
            ) : (
              <Text color={msgColor(msg)}>{msg.text}</Text>
            )}
          </Box>
        ))}
      </Box>

      {processing && (
        <Box marginY={1}>
          <Text color="green"><Spinner type="dots" /></Text>
          <Text color={C.muted}> {statusText}</Text>
          {queueCount > 0 && (
            <Text color={C.yellow}> ({queueCount} queued)</Text>
          )}
        </Box>
      )}

      {slashMatches.length > 0 && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          {slashMatches.map((c) => (
            <Text key={c.name} color={C.muted}>
              <Text color={C.cyan}>{c.name.padEnd(16)}</Text>
              <Text> {c.description}</Text>
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={C.blue}>{SYM.input} </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={onSubmit}
          placeholder="Ask to investigate, or / for commands…"
        />
      </Box>
    </Box>
  );
}
