import React from "react";
import { Text, Box } from "ink";
import type { Finding } from "../../model/types";

interface Props {
  findings: Finding[];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  resolved: "#22c55e",
  dismissed: "#888888",
};

export default function FindingsTable({ findings }: Props) {
  if (findings.length === 0) {
    return <Text>No findings found.</Text>;
  }

  const headerColor = "#888";
  const rows = findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    status: f.status,
    title: f.title.length > 50 ? f.title.slice(0, 47) + "..." : f.title,
    confidence: (f.confidence * 100).toFixed(0) + "%",
    impact: f.impactAmount != null ? `${f.impactCurrency ?? "INR"} ${f.impactAmount.toLocaleString()}` : "-",
    agent: f.agentType,
    created: f.createdAt.slice(0, 10),
  }));

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={headerColor}>{"ID".padEnd(24)}</Text>
        <Text color={headerColor}>{"Sev".padEnd(10)}</Text>
        <Text color={headerColor}>{"Status".padEnd(10)}</Text>
        <Text color={headerColor}>{"Title".padEnd(52)}</Text>
        <Text color={headerColor}>{"Conf".padEnd(6)}</Text>
        <Text color={headerColor}>{"Impact".padEnd(16)}</Text>
        <Text color={headerColor}>{"Date".padEnd(12)}</Text>
      </Box>
      <Text color={headerColor}>{"\u2500".repeat(126)}</Text>
      {rows.map((r, i) => (
        <Box key={i}>
          <Text>{r.id.padEnd(24)}</Text>
          <Text color={SEVERITY_COLORS[r.severity] ?? "#fff"}>{r.severity.padEnd(10)}</Text>
          <Text color={STATUS_COLORS[r.status] ?? "#fff"}>{r.status.padEnd(10)}</Text>
          <Text>{r.title.padEnd(52)}</Text>
          <Text>{r.confidence.padEnd(6)}</Text>
          <Text>{r.impact.padEnd(16)}</Text>
          <Text color="#888">{r.created.padEnd(12)}</Text>
        </Box>
      ))}
    </Box>
  );
}
