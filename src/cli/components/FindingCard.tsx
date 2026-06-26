import React from "react";
import { Text, Box } from "ink";
import type { Finding } from "../../model/types";
import { C } from "../theme.js";

interface Props {
  finding: Finding;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: C.red,
  high: C.orange,
  medium: C.yellow,
  low: C.green,
};

const STATUS_COLORS: Record<string, string> = {
  open: C.blue,
  resolved: C.green,
  dismissed: C.muted,
};

export default function FindingCard({ finding }: Props) {
  const sevColor = SEVERITY_COLORS[finding.severity] ?? "#ffffff";
  const statusColor = STATUS_COLORS[finding.status] ?? "#ffffff";
  const icon = finding.severity === "critical" ? "\u26A0" : finding.severity === "high" ? "!" : "\u00B7";

  return (
    <Box flexDirection="column" marginY={1} paddingX={1} borderStyle="round" borderColor={sevColor}>
      <Box>
        <Text color={sevColor} bold>{icon} {finding.id}</Text>
        <Text> </Text>
        <Text color={statusColor}>[{finding.status}]</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold>{finding.title}</Text>
      </Box>
      <Box>
        <Text>{finding.summary.slice(0, 200)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Severity: </Text>
        <Text color={sevColor}>{finding.severity.toUpperCase()}</Text>
        <Text>  Confidence: {(finding.confidence * 100).toFixed(0)}%</Text>
      </Box>
      {finding.impactAmount != null && (
        <Box>
          <Text>Impact: {finding.impactCurrency ?? "INR"} {finding.impactAmount.toLocaleString()}</Text>
        </Box>
      )}
      <Box>
        <Text color={C.muted}>Agent: {finding.agentType}</Text>
        {finding.vendorId && <Text color={C.muted}>  Vendor: {finding.vendorId}</Text>}
      </Box>
      <Box>
        <Text color={C.muted}>Created: {finding.createdAt.slice(0, 10)}</Text>
        {finding.resolvedAt && <Text color={C.muted}>  Resolved: {finding.resolvedAt.slice(0, 10)}</Text>}
      </Box>
    </Box>
  );
}
