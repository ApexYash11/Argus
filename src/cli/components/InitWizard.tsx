/**
 * Multi-step first-run wizard. Wires argus init to:
 *   1. workspace name + currency
 *   2. data source (use sample data | point at a folder)
 *   3. LLM mode (skip | OpenRouter | Groq)
 *   4. ingest + investigate + summary
 */
import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import fs from "fs";
import path from "path";
import { BANNER, C, SYM, WORDMARK, VERSION } from "../theme";

const SAMPLE_PROVIDER: "sample" | "folder" = "sample";
const SAMPLE_DIR = path.resolve("test-data");

export interface WizardState {
  step: 0 | 1 | 2 | 3 | 4;
  company: string;
  currency: string;
  dataChoice: "sample" | "folder" | "skip";
  folder: string;
  llmChoice: "skip" | "openrouter" | "groq";
  llmKey: string;
  done: boolean;
  result: { ingested: number; findings: number; workspace: string };
}

interface Props {
  cwd: string;
  initial?: Partial<WizardState>;
  onComplete: (state: WizardState) => Promise<void> | void;
}

const STEPS: { title: string; sub: string }[] = [
  { title: "Company", sub: "What is this workspace called?" },
  { title: "Currency", sub: "Default currency code (3 letters)" },
  { title: "Data", sub: "How should we get data in?" },
  { title: "LLM", sub: "Which LLM provider? (Enter to skip)" },
  { title: "Run", sub: "Ingest + investigate..." },
];

export default function InitWizard({ cwd, initial, onComplete }: Props) {
  const { exit } = useApp();
  const [state, setState] = useState<WizardState>({
    step: 0,
    company: initial?.company ?? "My Company",
    currency: initial?.currency ?? "INR",
    dataChoice: "sample",
    folder: "",
    llmChoice: "skip",
    llmKey: "",
    done: false,
    result: { ingested: 0, findings: 0, workspace: cwd },
  });

  const advance = useCallback((next: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...next, step: Math.min(4, s.step + 1) as WizardState["step"] }));
  }, []);

  useInput((input, key) => {
    if (key.escape) exit();
  });

  useEffect(() => {
    if (state.step === 4 && !state.done) {
      Promise.resolve(onComplete(state)).then(() => {
        setState((s) => ({ ...s, done: true }));
      }).catch((err) => {
        setState((s) => ({ ...s, done: true, result: { ...s.result, findings: -1 } }));
        console.error("Wizard error:", err.message);
      });
    }
  }, [state.step, state.done, onComplete, state]);

  const stepMeta = STEPS[state.step]!;

  return (
    <Box flexDirection="column" height="100%" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={C.muted}>{WORDMARK} {VERSION}  {SYM.dot}  {cwd}</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor={C.cyan} paddingX={2} paddingY={1} marginBottom={1}>
        <Text color={C.cyan} bold>Step {state.step + 1}/5 · {stepMeta.title}</Text>
        <Text color={C.muted}>{stepMeta.sub}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {STEPS.map((s, i) => (
          <Text key={i} color={i < state.step ? C.green : i === state.step ? C.cyan : C.muted}>
            {i < state.step ? `${SYM.ok} ` : i === state.step ? "› " : "  "}{s.title}
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {state.step === 0 && (
          <>
            <Text color={C.muted}>Company name:</Text>
            <Box marginTop={1}>
              <Text color={C.cyan}>{SYM.input} </Text>
              <TextInput
                value={state.company}
                onChange={(v) => setState((s) => ({ ...s, company: v }))}
                onSubmit={() => advance({})}
              />
            </Box>
          </>
        )}
        {state.step === 1 && (
          <>
            <Text color={C.muted}>Currency code:</Text>
            <Box marginTop={1}>
              <Text color={C.cyan}>{SYM.input} </Text>
              <TextInput
                value={state.currency}
                onChange={(v) => setState((s) => ({ ...s, currency: v.toUpperCase().slice(0, 3) }))}
                onSubmit={() => advance({})}
              />
            </Box>
          </>
        )}
        {state.step === 2 && (
          <ChoiceList
            options={[
              { value: "sample", label: "Use bundled sample data (30s demo, recommended)" },
              { value: "folder", label: "Point at a folder of CSVs/PDFs" },
              { value: "skip", label: "Skip — I'll ingest manually" },
            ]}
            value={state.dataChoice}
            onSelect={(v) => {
              if (v === "skip") {
                advance({ dataChoice: "skip" });
              } else if (v === "sample") {
                advance({ dataChoice: "sample" });
              } else {
                setState((s) => ({ ...s, dataChoice: "folder" }));
                setTimeout(() => advance({ dataChoice: "folder", folder: "." }), 0);
              }
            }}
          />
        )}
        {state.step === 3 && (
          <ChoiceList
            options={[
              { value: "skip", label: "Skip for now (local fallback only)" },
              { value: "openrouter", label: "OpenRouter (free models available)" },
              { value: "groq", label: "Groq" },
            ]}
            value={state.llmChoice}
            onSelect={(v) => advance({ llmChoice: v as any })}
          />
        )}
        {state.step === 4 && !state.done && (
          <Text color={C.cyan}>Ingesting + investigating... (Ctrl+C to abort)</Text>
        )}
        {state.step === 4 && state.done && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={C.green} bold>Setup complete.</Text>
            <Text>  Ingested: {state.result.ingested} record(s)</Text>
            <Text>  Findings: {state.result.findings} (run `argus findings` to see them)</Text>
            <Text>  Next: `argus status`, `argus chat`, `argus report --share`</Text>
            <Box marginTop={1}><Text color={C.muted}>Press any key to exit.</Text></Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface Choice { value: string; label: string }
function ChoiceList({ options, value, onSelect }: { options: Choice[]; value: string; onSelect: (v: string) => void }) {
  const [idx, setIdx] = useState(Math.max(0, options.findIndex((o) => o.value === value)));
  useInput((input, key) => {
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setIdx((i) => Math.min(options.length - 1, i + 1));
    if (key.return) onSelect(options[idx]!.value);
  });
  return (
    <Box flexDirection="column">
      {options.map((o, i) => (
        <Box key={o.value}>
          <Text color={i === idx ? C.cyan : C.muted}>{i === idx ? "›" : " "} </Text>
          <Text color={i === idx ? C.hi : C.base}>{o.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

void BANNER;
void SAMPLE_PROVIDER;
