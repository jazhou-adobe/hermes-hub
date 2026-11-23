/** The registration, verified against Claude Code 2.1.231: it writes `mcpServers.hermes` to `~/.claude.json`. */
export const CLAUDE_MCP_ADD = ["mcp", "add", "--scope", "user", "hermes", "--", "hermes", "mcp"];

/**
 * `hermes setup claude`: registers the stdio shim in Claude Code's user-scope MCP config after the
 * Human confirms (hub-skill spec). Uses whatever `claude` is on PATH, so its config is Claude
 * Code's own business.
 */
export function setupClaude(): number {
  const claude = Bun.which("claude");
  if (!claude) {
    console.error("hermes setup claude: Claude Code (`claude`) is not on PATH");
    return 1;
  }
  if (Bun.spawnSync([claude, "mcp", "get", "hermes"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0) {
    console.log("Claude Code already has an MCP server named hermes; nothing to do (`claude mcp get hermes` shows it).");
    return 0;
  }
  console.log(`This runs: claude ${CLAUDE_MCP_ADD.join(" ")}`);
  console.log("Claude Code then starts `hermes mcp` in every project and learns Hermes from its tool descriptions.");
  if (!Bun.which("hermes")) {
    console.log("WARN hermes is not on PATH here, so Claude Code could not start it: run `bun link` in the hermes-hub clone first.");
  }
  const reply = prompt("Register the hermes MCP shim in Claude Code's user config? [y/N]");
  if (!reply || !/^y(es)?$/i.test(reply.trim())) {
    console.log("Not registered; nothing changed.");
    return 1;
  }
  const add = Bun.spawnSync([claude, ...CLAUDE_MCP_ADD], { stdout: "inherit", stderr: "inherit" });
  if (add.exitCode !== 0) return add.exitCode ?? 1;
  console.log("Registered. Claude Code sessions started from now on have hermes_ask, hermes_wait, hermes_cancel and hermes_inbox.");
  return 0;
}
