const agent = process.argv[2];
if (agent !== "codex" && agent !== "opencode") {
  console.error("usage: node scripts/smoke-agent.mjs <codex|opencode>");
  process.exitCode = 2;
} else {
  const key = agent === "codex" ? "CODEX_ACP_COMMAND" : "OPENCODE_ACP_COMMAND";
  const command = process.env[key];
  if (!command) {
    console.log(`SKIP: ${key} is not configured; no ${agent} ACP smoke was run.`);
  } else {
    console.log(`READY: run the configured ACP host and follow docs/manual-smoke.md.`);
    console.log(`${key}=${command}`);
  }
}
