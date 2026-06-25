import React, { useEffect, useState } from "react";
import { Text, Box } from "ink";
import Spinner from "ink-spinner";
import type { AuditEvent, Finding } from "../../model/types";

interface Props {
  stream: AsyncGenerator<AuditEvent>;
  onComplete?: () => void;
}

export default function InvestigationStream({ stream, onComplete }: Props) {
  const [messages, setMessages] = useState<{ text: string; type: string }[]>([]);
  const [isRunning, setIsRunning] = useState(true);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [done, setDone] = useState<{ totalFindings: number; durationMs: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for await (const event of stream) {
        if (cancelled) break;
        const line = formatEvent(event);
        if (line) setMessages((prev) => [...prev, line]);
        if (event.type === "finding") {
          setFindings((prev) => [...prev, event.finding]);
        }
        if (event.type === "done") {
          setDone({ totalFindings: event.totalFindings, durationMs: event.durationMs });
          setIsRunning(false);
          onComplete?.();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [stream]);

  return (
    <Box flexDirection="column">
      {messages.slice(-30).map((m, i) => (
        <Box key={i}>
          {m.type === "finding" ? (
            <Text color="#22c55e">{"\u25B6 "}</Text>
          ) : m.type === "step" ? (
            <Text color="#3b82f6">{"\u25C6 "}</Text>
          ) : m.type === "evidence" ? (
            <Text color="#a855f7">{"  \u2192 "}</Text>
          ) : m.type === "confidence" ? (
            <Text color="#eab308">{"    "}</Text>
          ) : (
            <Text>{"  "}</Text>
          )}
          <Text>{m.text}</Text>
        </Box>
      ))}
      {isRunning && (
        <Box>
          <Text color="green"><Spinner type="dots" /></Text>
          <Text> Investigating...</Text>
        </Box>
      )}
      {done && (
        <Box marginTop={1}>
          <Text bold>Done — {done.totalFindings} finding(s) in {done.durationMs}ms</Text>
        </Box>
      )}
      {done && (
        <Box>
          <Text color="#888">Run `audit findings` to review.</Text>
        </Box>
      )}
    </Box>
  );
}

function formatEvent(event: AuditEvent): { text: string; type: string } | null {
  switch (event.type) {
    case "agent_start":
      return { text: event.description, type: "step" };
    case "step":
      return { text: event.message, type: "step" };
    case "evidence_found":
      return { text: `${event.key}: ${event.value.slice(0, 120)}`, type: "evidence" };
    case "comparison":
      return { text: `${event.label}: expected ${event.expected}, got ${event.actual}${event.delta ? ` (${event.delta})` : ""}`, type: "comparison" };
    case "confidence":
      return { text: `${(event.score * 100).toFixed(0)}% — ${event.reason}`, type: "confidence" };
    case "finding": {
      const f = event.finding;
      const icon = f.severity === "critical" ? "\u26A0" : f.severity === "high" ? "!" : "\u00B7";
      return { text: `${icon} ${f.id} | ${f.title} | [${f.severity}] ${(f.confidence * 100).toFixed(0)}%`, type: "finding" };
    }
    case "agent_skipped":
      return { text: `~ ${event.agent}: ${event.reason}`, type: "step" };
    case "done":
      return null;
    default:
      return null;
  }
}
