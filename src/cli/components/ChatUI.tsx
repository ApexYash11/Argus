import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import type { ChatEvent } from "../../model/types";
import type { Finding } from "../../model/types";
import { handleChatMessage } from "../commands/chat";
import type { ChatContext } from "../commands/chat";
import { BANNER, C, SYM, VERSION } from "../theme";
import { renderMarkdown, renderFindingCard, renderToolLine } from "./chat-render";
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



const STATUS_BAR = "\u2578ARGUS\u257A  chat mode  \u00B7  type \"exit\" to quit  \u00B7  Esc to cancel";
const RESERVED_LINES = 6;

interface Message {
  id: number;
  type: ChatEvent["type"];
  text: string;
  isUser: boolean;
  accent?: boolean;
  finding?: Finding;
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
  const streamMsgId = useRef<number | null>(null);
  const [activity, setActivity] = useState<string | null>(null);

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

  const addCard = useCallback((finding: Finding): number => {
    const id = msgId.current++;
    messagesRef.current = [...messagesRef.current, { id, type: "finding_card" as const, text: "", isUser: false, finding }];
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

  function fmtDur(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  const doProcess = useCallback(async (query: string) => {
    processingRef.current = true;
    setProcessing(true);

    streamMsgId.current = null;
    setActivity(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = handleChatMessage(query, chatCtx, controller.signal);
    let llmActive = false;

    try {
      for await (const event of gen) {
        switch (event.type) {
          case "agent_thinking":
            // Transient activity, not transcript — one live line, never a dump.
            setActivity(event.message);
            setStatusText(event.message.slice(0, 60));
            break;
          case "tool_start": {
            // Drop any half-streamed raw tool JSON — replace with a clean card.
            if (streamMsgId.current !== null) {
              removeMessage(streamMsgId.current);
              streamMsgId.current = null;
              llmActive = false;
            }
            setActivity(renderToolLine(event.tool, "start"));
            setStatusText(renderToolLine(event.tool, "start"));
            break;
          }
          case "tool_end":
            addMessage("tool_end", `${SYM.ok} ${renderToolLine(event.tool, "done", event.summary)}`, false);
            break;
          case "tool_error":
            addMessage("tool_error", `${SYM.warn} ${event.tool} failed: ${event.error}`, false);
            setActivity(null);
            break;
          case "finding_card":
            setActivity(null);
            addCard(event.finding);
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
            setActivity(null);
            setStatusText("Ready.");
            break;
          case "done":
            setActivity(null);
            setStatusText(
              event.totalFindings !== undefined
                ? `${event.totalFindings} finding(s) in ${fmtDur(event.durationMs)}`
                : "Ready."
            );
            break;
          case "error":
            setActivity(null);
            addMessage("error", `Error: ${event.message}`, false);
            setStatusText("Error.");
            break;
          case "clear":
            messagesRef.current = [];
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
  }, [cwd, addMessage, appendToLast, removeMessage]);

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

  function renderAssistant(text: string, keyPrefix: string): React.ReactNode[] {
    return renderMarkdown(text).map((line, i) => (
      <Text key={`${keyPrefix}-${i}`}>
        {line.segments.map((s, j) => (
          <Text key={j} color={s.color} bold={s.bold}>{s.text}</Text>
        ))}
      </Text>
    ));
  }

  function renderCard(msg: Message): React.ReactNode {
    const card = renderFindingCard(msg.finding!);
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={2} marginLeft={2}>
        <Text>
          {card.headline.map((s, i) => (
            <Text key={i} color={s.color} bold={s.bold}>{s.text}</Text>
          ))}
        </Text>
        <Text color={C.muted}>{card.detail}</Text>
        <Text color={C.muted}>→ {card.hint}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={C.muted}>{STATUS_BAR}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {scrollMsgs.map((msg) => (
          <Box key={msg.id} marginBottom={1} flexDirection="column">
            {msg.isUser ? (
              <Box>
                <Text color={C.blue}>{SYM.input} </Text>
                <Text bold>{msg.text}</Text>
              </Box>
            ) : msg.type === "finding_card" && msg.finding ? (
              renderCard(msg)
            ) : msg.type === "llm_chunk" ? (
              renderAssistant(msg.text, `m${msg.id}`)
            ) : (
              <Box paddingLeft={2}>
                <Text color={msgColor(msg)}>{msg.text}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {activity !== null && (
        <Box marginY={1} paddingLeft={2}>
          <Text color={C.cyan}>✻ {activity}</Text>
        </Box>
      )}

      {processing && activity === null && (
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
      <Box>
        <Text color={C.dim}>esc to cancel · / for commands · exit to quit</Text>
      </Box>
    </Box>
  );
}
