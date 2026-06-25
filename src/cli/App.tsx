import React from "react";
import { Text } from "ink";
import InvestigationStream from "./components/InvestigationStream";
import FindingsTable from "./components/FindingsTable";
import EvidenceChain from "./components/EvidenceChain";
import StatusBar from "./components/StatusBar";
import type { AuditEvent, Finding } from "../model/types";

interface AgentStatus {
  agent: string;
  ready: boolean;
  reason?: string;
  missingData?: string[];
}

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

interface AppProps {
  command: string;
  props?: Record<string, unknown>;
}

export default function App({ command, props }: AppProps) {
  switch (command) {
    case "investigate": {
      const stream = props?.stream as AsyncGenerator<AuditEvent> | undefined;
      const onComplete = props?.onComplete as (() => void) | undefined;
      return stream ? <InvestigationStream stream={stream} onComplete={onComplete} /> : <Text>No investigation stream available.</Text>;
    }

    case "findings": {
      const findings = props?.findings as Finding[] | undefined;
      return findings ? <FindingsTable findings={findings} /> : <Text>No findings to display.</Text>;
    }

    case "explain": {
      const finding = props?.finding as Finding | undefined;
      if (!finding) return <Text color="red">Finding not found.</Text>;
      const evidence = props?.evidence as { evidence: EvidenceItem[]; comparisons: ComparisonItem[] } | undefined;
      const trace = props?.trace as TraceEntry[] | undefined;
      const showTrace = props?.showTrace as boolean | undefined;
      return <EvidenceChain finding={finding} evidence={evidence} trace={trace} showTrace={showTrace} />;
    }

    case "status": {
      return (
        <StatusBar
          recordCount={(props?.recordCount as number) ?? 0}
          vendorCount={(props?.vendorCount as number) ?? 0}
          agents={(props?.agents as AgentStatus[]) ?? []}
          dataSources={(props?.dataSources as { name: string; recordCount: number }[]) ?? []}
        />
      );
    }

    default:
      return <Text>audit: unknown command. Run `audit --help`.</Text>;
  }
}
