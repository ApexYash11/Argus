Object.defineProperty(process.stdin, "isTTY", { get: () => true });
process.stdin.setRawMode = () => {};
process.stdout.isTTY = true;

const { initWorkspace } = await import("./src/cli/commands/init.ts");
await initWorkspace(process.cwd(), "Test Co");
console.log("initWorkspace OK");

// Register agents via index
await import("./src/agents/index.ts");

const { investigate } = await import("./src/cli/commands/investigate.ts");
const stream = await investigate();
let eventCount = 0;
let hasDone = false;
for await (const evt of stream) {
  eventCount++;
  if (evt.type === "done") { hasDone = true; break; }
  if (evt.type === "step") console.log("  step:", evt.message);
  if (evt.type === "agent_start") console.log("  agent:", evt.description);
}
console.log("investigate OK — events:", eventCount, "| done:", hasDone);
