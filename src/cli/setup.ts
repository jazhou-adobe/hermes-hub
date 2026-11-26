import { WRAPPER } from "../paths.ts";

/** The MCP server's registered name in each client's config; the tools keep their `hermes_*` names. */
export const MCP_SERVER_NAME = "hermes-hub";

/**
 * The registration, verified against Claude Code 2.1.231: it writes `mcpServers.hermes-hub` to
 * `~/.claude.json`, with this clone's wrapper by absolute path (nothing is on PATH).
 */
export const claudeMcpAdd = (): string[] => ["mcp", "add", "--scope", "user", MCP_SERVER_NAME, "--", WRAPPER, "mcp"];

/**
 * `hermes-hub setup claude`: registers the stdio shim in Claude Code's user-scope MCP config after the
 * Human confirms (hub-skill spec). Uses whatever `claude` is on PATH, so its config is Claude
 * Code's own business.
 */
export function setupClaude(): number {
  const claude = Bun.which("claude");
  if (!claude) {
    console.error("hermes-hub setup claude: Claude Code (`claude`) is not on PATH");
    return 1;
  }
  if (Bun.spawnSync([claude, "mcp", "get", MCP_SERVER_NAME], { stdout: "ignore", stderr: "ignore" }).exitCode === 0) {
    console.log(
      `Claude Code already has an MCP server named ${MCP_SERVER_NAME}; nothing to do (\`claude mcp get ${MCP_SERVER_NAME}\` shows it).`,
    );
    return 0;
  }
  const add = claudeMcpAdd();
  console.log(`This runs: claude ${add.join(" ")}`);
  console.log(`Claude Code then starts \`${WRAPPER} mcp\` in every project and learns Hermes from its tool descriptions.`);
  const reply = prompt("Register the Hermes Hub MCP shim in Claude Code's user config? [y/N]");
  if (!reply || !/^y(es)?$/i.test(reply.trim())) {
    console.log("Not registered; nothing changed.");
    return 1;
  }
  const res = Bun.spawnSync([claude, ...add], { stdout: "inherit", stderr: "inherit" });
  if (res.exitCode !== 0) return res.exitCode ?? 1;
  console.log("Registered. Claude Code sessions started from now on have hermes_ask, hermes_wait, hermes_cancel and hermes_inbox.");
  return 0;
}
