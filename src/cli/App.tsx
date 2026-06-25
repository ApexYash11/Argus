import React from "react";
import { Text } from "ink";

interface AppProps {
  command: string;
  args: Record<string, unknown>;
}

export default function App({ command, args }: AppProps) {
  return <Text>Running: audit {command} {JSON.stringify(args)}</Text>;
}
