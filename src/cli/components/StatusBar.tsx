import React from "react";
import { Text, Box } from "ink";

interface AgentStatus {
  agent: string;
  ready: boolean;
  reason?: string;
  missingData?: string[];
}

interface Props {
  recordCount: number;
  vendorCount: number;
  agents: AgentStatus[];
  dataSources: string[];
}

export default function StatusBar({ recordCount, vendorCount, agents, dataSources }: Props) {
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
        <Box key={ds} marginLeft={1}>
          <Text color="#22c55e">{"\u2713 "}</Text>
          <Text>{ds}</Text>
        </Box>
      ))}

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
