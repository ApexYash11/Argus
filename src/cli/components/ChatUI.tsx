import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import type { ChatEvent } from "../../model/types";
import { handleChatMessage } from "../commands/chat";
import { BANNER, C, SYM } from "../theme";

const STATUS_BAR = "\u2578ARGUS\u257A  chat mode  \u00B7  type \"exit\" to quit  \u00B7  Ctrl+C to stop";
const RESERVED_LINES = 6;

interface Message {
  id: number;
  type: ChatEvent["type"];
  text: string;
  isUser: boolean;
}

export default function ChatUI({ cwd }: { cwd: string }) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [visibleLines, setVisibleLines] = useState(20);
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

  useEffect(() => {
    setInputRef.current = setInput;
    const rows = process.stdout.rows || 24;
    setVisibleLines(Math.max(5, rows - RESERVED_LINES));
    const msgs: Message[] = BANNER.map((line) => ({
      id: msgId.current++, type: "agent_thinking" as const, text: line, isUser: false,
    }));
    msgs.push({ id: msgId.current++, type: "agent_thinking" as const, text: "Type a message or /help for commands.", isUser: false });
    messagesRef.current = msgs;
    forceRender((n) => n + 1);
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        processingRef.current = false;
        setProcessing(false);
        setStatusText("Cancelled.");
      }
    }
    if (key.ctrl && key.shift) {
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
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = handleChatMessage(query, cwd, controller.signal);
    let llmActive = false;

    try {
      for await (const event of gen) {
        switch (event.type) {
          case "agent_thinking":
            addMessage("agent_thinking", event.message, false);
            setStatusText(event.message.slice(0, 60));
            break;
          case "tool_start": {
            const mid = addMessage("tool_start", `\u25C6 ${event.tool}: ${event.args}`, false);
            toolMsgMap.current.set(event.toolCallId, mid);
            setStatusText(`Running ${event.tool}...`);
            break;
          }
          case "tool_end":
            updateByToolCallId(event.toolCallId, `\u2713 ${event.summary} (${fmtDur(event.durationMs)})`);
            break;
          case "tool_error":
            updateByToolCallId(event.toolCallId, `\u2717 ${event.error}`);
            break;
          case "llm_chunk":
            if (!llmActive) {
              llmActive = true;
              addMessage("llm_chunk", event.text, false);
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
  }, [cwd, addMessage, appendToLast, updateByToolCallId]);

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

  const scrollMsgs = messagesRef.current.slice(-visibleLines);

  function msgColor(msg: Message): string | undefined {
    if (msg.isUser) return C.blue;
    switch (msg.type) {
      case "error": return C.red;
      case "llm_chunk": return undefined;
      case "agent_thinking": return C.cyan;
      case "tool_start": return C.muted;
      case "tool_end": return C.green;
      case "tool_error": return C.red;
      default: return C.muted;
    }
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box>
        <Text color={C.muted}>{STATUS_BAR}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {scrollMsgs.map((msg) => (
          <Box key={msg.id}>
            {msg.isUser ? (
              <Text>
                <Text color={C.blue}>{SYM.input} </Text>
                <Text>{msg.text}</Text>
              </Text>
            ) : (
              <Text color={msgColor(msg)}>{msg.text}</Text>
            )}
          </Box>
        ))}
      </Box>

      {processing && (
        <Box marginTop={1}>
          <Text color="green"><Spinner type="dots" /></Text>
          <Text color="#62627a"> {statusText}</Text>
          {queueCount > 0 && (
            <Text color="#efc02a"> ({queueCount} queued)</Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="#5b9cf6">{SYM.input} </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={onSubmit}
          placeholder="type a message..."
        />
      </Box>
    </Box>
  );
}
