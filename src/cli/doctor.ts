import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_DIR, WRAPPER } from "../paths.ts";
import { VERSION } from "../version.ts";
import { isRecord } from "./client.ts";
import { MCP_SERVER_NAME } from "./setup.ts";
import { compareVersions, gitRoot, isExcluded, shellWord, SKILL_DIR, skillFile, skillVersion, type ProjectStore } from "./skill.ts";

const HUB_PROBE_MS = 3_000;
/** `claude mcp get` health-checks the server it finds; give it time to start the shim. */
const CLAUDE_PROBE_MS = 30_000;

type ClientId = "claude" | "codex" | "cursor" | "code" | "omp";

interface Client {
  id: ClientId;
  name: string;
  /** The binary on PATH, or the app bundle. */
  found: string;
}

/** A macOS app bundle in /Applications or ~/Applications. */
function app(bundle: string): string | undefined {
  return [join("/Applications", bundle), join(homedir(), "Applications", bundle)].find((p) => existsSync(p));
}

/** The clients `hermes-hub doctor` covers (hub-skill spec), as found from this shell. */
function detectClients(): Client[] {
  const clients: Client[] = [];
  const add = (id: ClientId, name: string, found: string | null | undefined) => {
    if (found) clients.push({ id, name, found });
  };
  add("claude", "Claude Code", Bun.which("claude"));
  add("codex", "Codex", Bun.which("codex"));
  add("cursor", "Cursor", [Bun.which("cursor-agent"), app("Cursor.app")].filter(Boolean).join(", "));
  add("code", "VS Code Copilot", [Bun.which("code"), app("Visual Studio Code.app")].filter(Boolean).join(", "));
  add("omp", "omp", Bun.which("omp"));
  return clients;
}

/**
 * The exact setting each client's sandbox needs before `hermes-hub` may reach `127.0.0.1:<port>`.
 * Printed only: the Human applies it (hub-skill spec, "No edits to sandbox settings, ever").
 */
export function sandboxSnippet(id: ClientId, port: string): string[] {
  switch (id) {
    case "codex":
      return [
        "workspace-write blocks the network. Add to ~/.codex/config.toml:",
        "  [sandbox_workspace_write]",
        "  network_access = true",
        "or run hermes-hub outside the sandbox (approve it when Codex asks to escalate).",
      ];
    case "claude":
      return [
        "if Claude Code's sandbox is on (/sandbox), add one of these to ~/.claude/settings.json:",
        '  { "sandbox": { "network": { "allowLocalBinding": true } } }',
        `  { "sandbox": { "network": { "allowedDomains": ["127.0.0.1:${port}"] } } }`,
        "or run hermes-hub outside the sandbox:",
        `  { "sandbox": { "excludedCommands": [${JSON.stringify(`${WRAPPER} *`)}] } }`,
        `(the ${MCP_SERVER_NAME} MCP shim is an MCP server, so it runs outside the sandbox already)`,
      ];
    case "cursor":
      return [
        "add to ~/.cursor/sandbox.json (or <project>/.cursor/sandbox.json):",
        '  { "networkPolicy": { "allow": ["127.0.0.1/32"] } }',
      ];
    case "code":
      return [
        "if chat.agent.sandbox.enabled is on, add to your user settings.json:",
        '  "chat.agent.sandbox.network.allowLocalNetwork": true',
      ];
    case "omp":
      return ["none: omp runs hermes-hub with your own network access"];
  }
}

async function hubLine(url: string, env: Record<string, string | undefined>): Promise<string[]> {
  const lines: string[] = [];
  try {
    const res = await fetch(`${url}/v1/hub`, { signal: AbortSignal.timeout(HUB_PROBE_MS) });
    const info: unknown = await res.json();
    const version = isRecord(info) && typeof info.version === "string" ? info.version : "unknown";
    lines.push(`${url}: reachable, Hub ${version}`);
    if (version !== VERSION) lines.push(`WARN hermes-hub ${VERSION} != Hub ${version} · restart the Hub (hermes-hub restart)`);
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "cannot connect";
    lines.push(`${url}: not reachable from this shell (${reason}). Start it with \`hermes-hub start\`.`);
  }
  if (env.CODEX_SANDBOX && env.CODEX_SANDBOX_NETWORK_DISABLED === "1") {
    lines.push("this shell runs in Codex's sandbox with network access off: apply the Codex setting below.");
  }
  return lines;
}

async function skillLines(cwd: string, store: ProjectStore): Promise<string[]> {
  const root = gitRoot(cwd);
  if (!root) return [`${cwd} is not in a git repository; run hermes-hub doctor inside a project`];
  const version = skillVersion(skillFile(root));
  if (version === undefined) return [`not installed in ${root}. Run \`hermes-hub skill install\`.`];
  // An unreachable Hub is reported on the Hub line; fall back to what git says.
  const recorded = (await store.list().catch(() => [])).find((p) => p.root === root);
  const committed = recorded?.committed ?? !isExcluded(root);
  const lines = [`${join(root, SKILL_DIR)}: ${version}, ${committed ? "committed" : "uncommitted (in .git/info/exclude)"}`];
  if (compareVersions(version, VERSION) < 0) lines.push(`WARN hermes-hub skill ${version} < ${VERSION} · run hermes-hub skill update`);
  return lines;
}

/** Whether Claude Code has the shim, from `claude mcp get hermes-hub` (exit 1 when no server has that name). */
function claudeShimLines(claude: string): string[] {
  const res = Bun.spawnSync([claude, "mcp", "get", MCP_SERVER_NAME], { stderr: "pipe", timeout: CLAUDE_PROBE_MS });
  if (res.exitCode !== 0) return ["not registered. Run `hermes-hub setup claude`."];
  const out = res.stdout.toString();
  const scope = /Scope:\s*(.+)/.exec(out)?.[1]?.trim();
  const status = /Status:\s*(.+)/.exec(out)?.[1]?.trim();
  return [`registered${scope ? `, ${scope}` : ""}${status ? `; ${status}` : ""}`];
}

/** One labelled block: the label on the first line, the rest aligned under it. */
function block(label: string, lines: string[], indent: string): string[] {
  const pad = " ".repeat(label.length);
  return lines.map((l, i) => `${indent}${i === 0 ? label : pad}${l}`);
}

/** `HERMES_HUB_APP`, the wrapper's folder for callers outside this repo (friendly-grill, scripts). */
function appLine(app: string | undefined): string {
  const fix = `export HERMES_HUB_APP=${shellWord(APP_DIR)}`;
  if (!app) return `HERMES_HUB_APP is not set; friendly-grill and scripts find hermes-hub through it: ${fix}`;
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
  if (real(app) === real(APP_DIR)) return `HERMES_HUB_APP: ${app} (this clone's wrapper folder)`;
  if (!existsSync(join(app, "hermes-hub"))) return `WARN HERMES_HUB_APP=${app} has no hermes-hub wrapper · ${fix}`;
  return `WARN HERMES_HUB_APP=${app} is another clone's wrapper folder; this hermes-hub is ${APP_DIR} · ${fix}`;
}

/** `hermes-hub doctor`: diagnostics for the Human; it reads, never edits, any client's settings. */
export async function runDoctor(
  url: string,
  store: ProjectStore,
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const port = new URL(url).port || "80";
  const out: string[] = [`hermes-hub ${VERSION} doctor`, ""];
  out.push(...block("Hub      ", await hubLine(url, env), ""));
  const bun = Bun.which("bun");
  out.push(
    ...block(
      "Shell    ",
      [
        `hermes-hub: ${WRAPPER} (Agents and MCP clients run it by this path)`,
        bun ? `bun: ${bun}` : "bun is not on PATH: hermes-hub needs it in every agent shell (~/.bun/bin)",
        appLine(env.HERMES_HUB_APP),
      ],
      "",
    ),
  );
  out.push(...block("Skill    ", await skillLines(cwd, store), ""));
  out.push("", "Clients");
  const clients = detectClients();
  if (clients.length === 0) out.push("  none found (claude, codex, cursor-agent or Cursor, code or VS Code, omp)");
  for (const c of clients) {
    out.push(`  ${c.name} (${c.found})`);
    if (c.id === "claude") {
      out.push(...block("Learns    ", [`Hermes from the ${MCP_SERVER_NAME} MCP shim's tool descriptions`], "    "));
      out.push(...block("MCP shim  ", claudeShimLines(Bun.which("claude")!), "    "));
    } else {
      out.push(...block("Learns    ", [`Hermes from the Skill in ${SKILL_DIR}`], "    "));
    }
    out.push(...block("Sandbox   ", sandboxSnippet(c.id, port), "    "));
  }
  console.log(out.join("\n"));
  return 0;
}
