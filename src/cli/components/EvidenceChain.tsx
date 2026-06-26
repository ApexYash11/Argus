import React from "react";
import { Text, Box } from "ink";
import type { Finding } from "../../model/types";
import { C } from "../theme.js";

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
}

export default function EvidenceChain({ finding, evidence, trace, showTrace }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{finding.id}</Text>
        <Text> | </Text>
        <Text color={finding.severity === "critical" ? C.red : finding.severity === "high" ? C.orange : C.yellow}>
          {finding.severity.toUpperCase()}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text bold>Title: </Text>
        <Text>{finding.title}</Text>
      </Box>
      <Box>
        <Text bold>Summary: </Text>
        <Text>{finding.summary}</Text>
      </Box>
      <Box>
        <Text bold>Confidence: </Text>
        <Text>{(finding.confidence * 100).toFixed(0)}%</Text>
      </Box>
      {finding.impactAmount != null && (
        <Box>
          <Text bold>Impact: </Text>
          <Text>{finding.impactCurrency ?? "INR"} {finding.impactAmount.toLocaleString()}</Text>
        </Box>
      )}
      <Box>
        <Text bold>Agent: </Text>
        <Text>{finding.agentType}</Text>
        {finding.vendorId && <Text> | Vendor: {finding.vendorId}</Text>}
      </Box>
      <Box>
        <Text bold>Status: </Text>
        <Text>{finding.status}</Text>
        <Text> | Created: {finding.createdAt.slice(0, 10)}</Text>
      </Box>

      {evidence && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Evidence Chain</Text>
          {evidence.evidence?.map((e, i) => (
            <Box key={i} marginLeft={1}>
              <Text color={C.purple}>{"\u2192 "}</Text>
              <Text>{e.key}: {e.value.slice(0, 200)}</Text>
            </Box>
          ))}
          {evidence.comparisons?.map((c, i) => (
            <Box key={i} marginLeft={1} marginTop={1} flexDirection="column">
              <Box><Text>{c.label}</Text></Box>
              <Box marginLeft={2}><Text>expected: {c.expected}</Text></Box>
              <Box marginLeft={2}>
                <Text>actual: {c.actual}</Text>
                {c.delta && <Text color={C.yellow}> ({c.delta})</Text>}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {showTrace && trace && trace.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Investigation Trace</Text>
          {trace.map((t, i) => (
            <Box key={i} marginLeft={1}>
              <Text color={C.muted}>{t.timestamp?.slice(11, 19) ?? ""}</Text>
              <Text> [</Text>
              <Text color={C.blue}>{t.type}</Text>
              <Text>] {t.message ?? ""}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
