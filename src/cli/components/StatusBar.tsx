import React from "react";
import { Text, Box } from "ink";

interface AgentStatus {
  agent: string;
  ready: boolean;
  reason?: string;
  missingData?: string[];
}

interface DataSourceInfo {
  name: string;
  recordCount: number;
}

interface SpendOverview {
  ok: boolean;
  reason?: string;
  currency?: string;
  avgMonthlyBurn?: number;
  monthCount?: number;
  lastMonthTotal?: number;
  lastMonthLabel?: string;
  trendPct?: number;
  committedTotal?: number;
}

interface Props {
  recordCount: number;
  vendorCount: number;
  agents: AgentStatus[];
  dataSources: DataSourceInfo[];
  spend?: SpendOverview;
}

export default function StatusBar({ recordCount, vendorCount, agents, dataSources, spend }: Props) {
  const readyCount = agents.filter((a) => a.ready).length;
  const totalAgents = agents.length;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>System Status</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Records: </Text>
        <Text bold>{recordCount}</Text>
        <Text>  Vendors: </Text>
        <Text bold>{vendorCount}</Text>
        <Text>  Agents: </Text>
        <Text bold>{readyCount}/{totalAgents}</Text>
        <Text> ready</Text>
      </Box>

      <Box marginTop={1}>
        <Text bold underline>Data Sources</Text>
      </Box>
      {dataSources.map((ds) => (
        <Box key={ds.name} marginLeft={1}>
          {ds.recordCount > 0 ? (
            <Text color="#22c55e">{"\u2713 "}</Text>
          ) : (
            <Text color="#ef4444">{"\u2717 "}</Text>
          )}
          <Text>{ds.name}</Text>
          <Text color="#888"> ({ds.recordCount} records)</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text bold underline>Spend &amp; Burn{spend?.currency ? ` (${spend.currency})` : ""}</Text>
      </Box>
      {!spend || !spend.ok ? (
        <Box marginLeft={1}>
          <Text color="#888">{spend?.reason ?? "No spend history yet."}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={1}>
          <Box>
            <Text>Avg burn: </Text>
            <Text bold>{(spend.avgMonthlyBurn ?? 0).toLocaleString()}/mo</Text>
            <Text color="#888"> ({spend.monthCount} complete months)</Text>
          </Box>
          <Box>
            <Text>Last month: </Text>
            <Text bold>{(spend.lastMonthTotal ?? 0).toLocaleString()} ({spend.lastMonthLabel})</Text>
            <Text> </Text>
            <Text color={(spend.trendPct ?? 0) > 0 ? "#ef4444" : "#22c55e"}>
              {(spend.trendPct ?? 0) > 0 ? "+" : ""}{spend.trendPct}% vs avg
            </Text>
          </Box>
          <Box>
            <Text>Committed upcoming: </Text>
            <Text bold>{(spend.committedTotal ?? 0).toLocaleString()}</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text bold underline>Agents</Text>
      </Box>
      {agents.map((agent) => (
        <Box key={agent.agent} marginLeft={1}>
          {agent.ready ? (
            <Text color="#22c55e">{"\u2713 "}</Text>
          ) : agent.reason ? (
            <Text color="#eab308">{"~ "}</Text>
          ) : (
            <Text color="#ef4444">{"\u2717 "}</Text>
          )}
          <Text>{agent.agent}</Text>
          <Text> — </Text>
          {agent.ready ? (
            <Text color="#22c55e">ready</Text>
          ) : (
            <Text color="#eab308">{agent.reason ?? `needs: ${agent.missingData?.join(", ") ?? "unknown"}`}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
