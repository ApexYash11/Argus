import React from "react";
import { Text, Box } from "ink";

interface ParseError {
  line: number;
  column?: string;
  value?: string;
  message: string;
  hint?: string;
}

interface Props {
  errors: ParseError[];
  filename: string;
}

const COLORS: Record<string, string> = {
  red: "#ef4444",
  yellow: "#eab308",
  dim: "#888888",
};

function distinctRowCount(errors: ParseError[]): number {
  return new Set(errors.filter((e) => e.line > 0).map((e) => e.line)).size;
}

export default function ParseErrorPreview({ errors, filename }: Props) {
  if (errors.length === 0) return null;

  const fileErrors = errors.filter((e) => e.line > 0);
  const structuralErrors = errors.filter((e) => e.line === 0);
  const failedRowCount = distinctRowCount(errors);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={COLORS.red}>{"\u2716"}</Text>
        <Text> </Text>
        <Text bold>Parse Errors — {filename}</Text>
        <Text> (</Text>
        <Text color={COLORS.yellow}>{errors.length} issue{errors.length > 1 ? "s" : ""}</Text>
        <Text>)</Text>
      </Box>

      {structuralErrors.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {structuralErrors.map((err, i) => (
            <Box key={`struct-${i}`} flexDirection="column">
              <Text color={COLORS.red}>{"! "}{err.message}</Text>
              {err.hint && <Text color={COLORS.dim}>  Hint: {err.hint}</Text>}
            </Box>
          ))}
        </Box>
      )}

      {fileErrors.length > 0 && (
        <Box marginTop={structuralErrors.length > 0 ? 1 : 0}>
          <Text>
            <Text color={COLORS.yellow}>{failedRowCount}</Text>
            <Text> row{failedRowCount > 1 ? "s" : ""} failed validation</Text>
          </Text>
        </Box>
      )}

      {fileErrors.slice(0, 3).map((err, i) => (
        <Box key={`file-${i}`} flexDirection="column" marginLeft={2} marginTop={1}>
          <Box>
            <Text color={COLORS.red}>{"! "}</Text>
            <Text bold>Line {err.line}</Text>
            {err.column && <Text color={COLORS.dim}> column: {err.column}</Text>}
          </Box>
          <Box marginLeft={3}>
            <Text>{err.message}</Text>
          </Box>
          {err.value && (
            <Box marginLeft={3}>
              <Text color={COLORS.dim}>Got: "{err.value}"</Text>
            </Box>
          )}
          {err.hint && (
            <Box marginLeft={3}>
              <Text color={COLORS.dim}>Hint: {err.hint}</Text>
            </Box>
          )}
        </Box>
      ))}

      {fileErrors.length > 3 && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={COLORS.dim}>... and {fileErrors.length - 3} more error{fileErrors.length - 3 > 1 ? "s" : ""}</Text>
        </Box>
      )}

      {errors.length > 0 && (
        <Box marginTop={1} marginLeft={2}>
          <Text color={COLORS.yellow}>Fix the errors above and re-run: audit ingest {filename}</Text>
        </Box>
      )}
    </Box>
  );
}
