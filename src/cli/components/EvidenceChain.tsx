import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import type { Finding } from "../../model/types";
import { C, SYM } from "../theme.js";

interface EvidenceItem {
  key: string;
  value: string;
  sourceDocId: string;
}

interface ComparisonItem {
  label: string;
  expected: string;
  actual: string;
  delta?: string;
}

interface TraceEntry {
  timestamp: string;
  type: string;
  message?: string;
}

interface Props {
  finding: Finding;
  evidence?: { evidence: EvidenceItem[]; comparisons: ComparisonItem[] };
  trace?: TraceEntry[];
  showTrace?: boolean;
  onResolve?: (action: "resolve" | "dismiss" | "escalate", reason: string) => void;
}

const SEVERITY_BAR: Record<string, string> = {
  critical: C.red,
  high: C.orange,
  warning: C.yellow,
  info: C.green,
};

export default function EvidenceChain({ finding, evidence, trace, showTrace, onResolve }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const sev = finding.severity;
  const color = SEVERITY_BAR[sev] ?? C.base;

  function copy(label: string, text: string) {
    try {
      const { spawn } = require("child_process") as typeof import("child_process");
      const cmd = process.platform === "win32" ? "clip" : "pbcopy";
      const child = spawn(cmd);
      child.stdin?.write(text);
      child.stdin?.end();
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  }

  useInput((input, key) => {
    if (key.escape) setReviewing(false);
    if (key.return && reviewing && onResolve) {
      onResolve("resolve", reason || "manual review");
      setReviewing(false);
      setReason("");
    }
    if (input === "c" && onResolve && !reviewing) {
      onResolve("resolve", "manual review (shortcut)");
    }
    if (input === "d" && onResolve && !reviewing) {
      onResolve("dismiss", "manual dismiss (shortcut)");
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor={color} paddingX={2} paddingY={1} flexDirection="column">
        <Box>
          <Text color={color} bold>{"\u25C6".padEnd(2)}</Text>
          <Text bold> {finding.id} </Text>
          <Text color={color} bold>{sev.toUpperCase()}</Text>
          {finding.impactAmount != null && (
            <Text>  {finding.impactAmount.toLocaleString()} {finding.impactCurrency ?? "INR"}</Text>
          )}
          <Text color={C.muted}>  {Math.round(finding.confidence * 100)}% confidence</Text>
        </Box>
        <Box marginTop={1}>
          <Text>{finding.title}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={C.muted}>{finding.summary.length > 240 ? finding.summary.slice(0, 240) + "..." : finding.summary}</Text>
        </Box>
      </Box>

      <Box flexDirection="row" marginTop={1} gap={2}>
        <Text color={C.muted}>agent:</Text>
        <Text>{finding.agentType}</Text>
        <Text color={C.muted}>  vendor:</Text>
        <Text>{finding.vendorId ?? "—"}</Text>
        <Text color={C.muted}>  status:</Text>
        <Text>{finding.status}</Text>
        <Text color={C.muted}>  created:</Text>
        <Text>{finding.createdAt.slice(0, 10)}</Text>
      </Box>

      {evidence && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold underline>Evidence</Text>
            <Text color={C.muted}>  ({evidence.evidence?.length ?? 0} item{evidence.evidence?.length === 1 ? "" : "s"})</Text>
          </Box>
          {evidence.evidence?.map((e, i) => (
            <Box key={i} marginLeft={1}>
              <Text color={C.purple}>{"\u2192 "}</Text>
              <Text color={C.cyan}>{e.key}:</Text>
              <Text> {e.value.length > 220 ? e.value.slice(0, 220) + "..." : e.value}</Text>
            </Box>
          ))}
          {evidence.comparisons && evidence.comparisons.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold underline>Comparisons</Text>
              {evidence.comparisons.map((c, i) => (
                <Box key={i} marginLeft={1} marginTop={1} flexDirection="column" borderStyle="single" borderColor={C.muted} paddingX={1}>
                  <Box><Text color={C.cyan}>{c.label}</Text></Box>
                  <Box marginLeft={1}>
                    <Text color={C.muted}>expected:</Text>
                    <Text> {c.expected}</Text>
                  </Box>
                  <Box marginLeft={1}>
                    <Text color={C.muted}>actual:  </Text>
                    <Text> {c.actual}</Text>
                  </Box>
                  {c.delta && (
                    <Box marginLeft={1}>
                      <Text color={C.muted}>delta:   </Text>
                      <Text color={C.yellow}> {c.delta}</Text>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {showTrace && trace && trace.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Investigation Timeline</Text>
          {trace.map((t, i) => (
            <Box key={i} marginLeft={1}>
              <Text color={C.muted}>{t.timestamp?.slice(11, 19) ?? ""}</Text>
              <Text>  {SYM.step} </Text>
              <Text color={C.blue}>{t.type.padEnd(18)}</Text>
              <Text> {t.message ?? ""}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <Text color={C.muted}>actions:</Text>
        <Text color={C.green}>[c]</Text>
        <Text>resolve </Text>
        <Text color={C.yellow}>[d]</Text>
        <Text>dismiss</Text>
        <Text color={C.muted}>  copy:</Text>
        <Text color={C.cyan}>[y]</Text>
        <Text>id </Text>
        <Text color={C.cyan}>[Y]</Text>
        <Text>summary</Text>
        {copied && <Text color={C.green}>  ✓ {copied} copied</Text>}
      </Box>
      {onResolve && !reviewing && (
        <Text color={C.muted}>press the bracket key above to act on this finding</Text>
      )}
    </Box>
  );
}
