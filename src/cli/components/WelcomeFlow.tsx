import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import fs from "fs";
import path from "path";
import { BANNER, C, SYM, VERSION } from "../theme.js";
import { initWorkspace } from "../commands/init.js";

export default function WelcomeFlow({ cwd }: { cwd: string }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState(1);
  const [isComplete, setIsComplete] = useState(false);

  const [company, setCompany] = useState("My Company");
  const [currency, setCurrency] = useState("USD");
  const [showCompanyInput, setShowCompanyInput] = useState(false);
  const [showCurrencyInput, setShowCurrencyInput] = useState(false);
  const [companyDone, setCompanyDone] = useState(false);
  const [currencyDone, setCurrencyDone] = useState(false);

  useEffect(() => {
    const auditDir = path.join(cwd, ".audit");
    fs.mkdirSync(auditDir, { recursive: true });
    fs.mkdirSync(path.join(auditDir, "scratchpad"), { recursive: true });
    setPhase(2);
    setShowCompanyInput(true);
  }, [cwd]);

  useEffect(() => {
    if (isComplete) {
      exit();
    }
  }, [isComplete, exit]);

  const handleCompanySubmit = (val: string) => {
    setCompany(val || "My Company");
    setCompanyDone(true);
    setShowCompanyInput(false);
    setShowCurrencyInput(true);
  };

  const handleCurrencySubmit = async (val: string) => {
    setCurrency(val || "USD");
    setCurrencyDone(true);
    setShowCurrencyInput(false);
    const name = company || "My Company";
    await initWorkspace(cwd, name);
    setPhase(3);
  };

  useEffect(() => {
    if (phase >= 3) {
      setIsComplete(true);
    }
  }, [phase]);

  const bannerLines = BANNER.map((line, i) => (
    <Text key={i} bold>{line}</Text>
  ));

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">{bannerLines}</Box>

      <Box marginTop={1}>
        <Text color={C.muted}>
          autonomous financial investigator  {SYM.dot}  {VERSION}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={C.dim}>{SYM.div.repeat(50)}</Text>
      </Box>

      {phase >= 1 && (
        <>
          <Box marginTop={1}>
            <Text color={C.muted}>initializing workspace</Text>
          </Box>

          <Box marginTop={1}>
            <Text>
              <Text color={C.green}>  {SYM.ok}  </Text>
              <Text color={C.base}>.audit/</Text>
              <Text color={C.dim}>         created</Text>
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color={C.green}>  {SYM.ok}  </Text>
              <Text color={C.base}>audit.yaml</Text>
              <Text color={C.dim}>      created</Text>
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color={C.green}>  {SYM.ok}  </Text>
              <Text color={C.base}>database</Text>
              <Text color={C.dim}>        8 tables ready</Text>
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text color={C.dim}>{SYM.div.repeat(50)}</Text>
          </Box>
        </>
      )}

      {!companyDone && showCompanyInput && (
        <Box marginTop={1}>
          <Text color={C.muted}>  company  </Text>
          <Text color={C.dim}>{SYM.input}  </Text>
          <TextInput
            value={company}
            onChange={setCompany}
            onSubmit={handleCompanySubmit}
            placeholder="My Company"
          />
        </Box>
      )}

      {companyDone && showCurrencyInput && (
        <Box marginTop={1}>
          <Text color={C.muted}>  currency  </Text>
          <Text color={C.dim}>{SYM.input}  </Text>
          <TextInput
            value={currency}
            onChange={setCurrency}
            onSubmit={handleCurrencySubmit}
            placeholder="USD"
          />
        </Box>
      )}

      {currencyDone && (
        <Box marginTop={1}>
          <Text color={C.dim}>{SYM.div.repeat(50)}</Text>
        </Box>
      )}

      {phase >= 3 && (
        <>
          <Box marginTop={1}>
            <Text>
              <Text color={C.green} bold>  {SYM.ok}  </Text>
              <Text color={C.hi} bold>7 agents standing by</Text>
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text color={C.dim}>{SYM.div.repeat(50)}</Text>
          </Box>

          <Box marginTop={1}>
            <Text color={C.dim}>
              {'\u2500\u2500\u2500'} next steps {'\u2500'.repeat(37)}
            </Text>
          </Box>

          <Box marginTop={1}>
            <Box flexDirection="column">
              <Text color={C.muted}>  ingest data</Text>
              <Text color={C.cyan}>    argus ingest ./your-data/transactions.csv</Text>
              <Text color={C.cyan}>    argus ingest ./your-data/subscriptions.csv</Text>
              <Text color={C.cyan}>    argus -d ./your-data ingest .</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Box flexDirection="column">
              <Text color={C.muted}>  investigate</Text>
              <Text color={C.cyan}>    argus investigate</Text>
              <Text color={C.cyan}>    argus -d ./client-a investigate</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Box flexDirection="column">
              <Text color={C.muted}>  chat with argus</Text>
              <Text color={C.cyan}>    argus chat</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text color={C.dim}>{SYM.div.repeat(50)}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
