import React from "react";
import { Text, Box } from "ink";
import type { Finding } from "../../model/types";

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
        <Text color={finding.severity === "critical" ? "#ef4444" : finding.severity === "high" ? "#f97316" : "#eab308"}>
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
              <Text color="#a855f7">{"\u2192 "}</Text>
              <Text>{e.key}: {e.value.slice(0, 200)}</Text>
            </Box>
          ))}
          {evidence.comparisons?.map((c, i) => (
            <Box key={`cmp-${i}`} marginLeft={1} marginTop={1}>
              <Text>{c.label}</Text>
            </Box>
          ))}
          {evidence.comparisons?.map((c, i) => (
            <Box key={`cmpd-${i}`} marginLeft={3}>
              <Text>expected: {c.expected}</Text>
            </Box>
          ))}
          {evidence.comparisons?.map((c, i) => (
            <Box key={`cmpa-${i}`} marginLeft={3}>
              <Text>actual: {c.actual}</Text>
              {c.delta && <Text color="#eab308"> ({c.delta})</Text>}
            </Box>
          ))}
        </Box>
      )}

      {showTrace && trace && trace.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Investigation Trace</Text>
          {trace.map((t, i) => (
            <Box key={i} marginLeft={1}>
              <Text color="#888">{t.timestamp?.slice(11, 19) ?? ""}</Text>
              <Text> [</Text>
              <Text color="#3b82f6">{t.type}</Text>
              <Text>] {t.message ?? ""}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
