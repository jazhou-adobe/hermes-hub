import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { refreshUncommittedSkills, SKILL_COMMAND, SKILL_DIR, skillVersion } from "../src/cli/skill.ts";
import { migrate } from "../src/db/db.ts";
import { Engine } from "../src/hub/engine.ts";
import { startServer } from "../src/hub/server.ts";
import { INSTRUCTIONS, TOOLS } from "../src/mcp/tools.ts";
import { SKILL_SOURCE, WRAPPER } from "../src/paths.ts";
import { hubChecks } from "../src/schema/checks.ts";
import type { Round } from "../src/schema/types.ts";
import { validateAnswer, validateRound } from "../src/schema/validate.ts";
import { VERSION } from "../src/version.ts";

const MAIN = join(import.meta.dir, "../src/cli/main.ts");
const SERVER_TS = join(import.meta.dir, "../src/hub/server.ts");
const AGENT_ENV = /^(HERMES_|PI_|OMPCODE$|CODEX_|CLAUDE|CURSOR_|COPILOT_|AI_AGENT$|AGENT$)/;

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

const servers: Server<undefined>[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function up(): Promise<{ url: string }> {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const port = freePort();
  const url = `http://127.0.0.1:${port}`;
  servers.push(await startServer(new Engine(db, url), port));
  return { url };
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A git repository; `realpath`-style, as `git rev-parse --show-toplevel` reports it. */
function repo(parent: string, name: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", dir]);
  return Bun.spawnSync(["git", "-C", dir, "rev-parse", "--show-toplevel"]).stdout.toString().trim();
}

interface Box {
  root: string;
  home: string;
  bin: string;
  env: Record<string, string>;
}

/**
 * A temp HOME, HERMES_HUB_HOME and PATH (a fake-binaries folder, then the system's own for git): no
 * test reads or writes the real user's Hub, Claude, Codex or Cursor config.
 */
function box(): Box {
  const root = tempDir("hermes-skill-test-");
  const home = join(root, "hermes-home");
  const bin = join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(join(root, "user-home"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !AGENT_ENV.test(k)) env[k] = v;
  Object.assign(env, { HERMES_HUB_HOME: home, HOME: join(root, "user-home"), PATH: `${bin}:/usr/bin:/bin` });
  return { root, home, bin, env };
}

async function run(b: Box, cwd: string, args: string[], opts: { env?: Record<string, string>; stdin?: string } = {}) {
  const proc = Bun.spawn([process.execPath, MAIN, ...args], {
    cwd,
    env: { ...b.env, ...opts.env },
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

function fakeBinary(b: Box, name: string, script: string): void {
  const path = join(b.bin, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

const excludeLines = (root: string) => readFileSync(join(root, ".git/info/exclude"), "utf8").split("\n");
const projects = (b: Box) => JSON.parse(readFileSync(join(b.home, "projects.json"), "utf8")).projects;
const status = (root: string) => Bun.spawnSync(["git", "-C", root, "status", "--porcelain"]).stdout.toString();

function skillFiles(dir = SKILL_SOURCE): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? skillFiles(path) : [path];
  });
}

/**
 * The Command Center's own paths: every route in server.ts outside the Agent API (`/v1/…`, `/mcp`),
 * as patterns that match the path wherever it is written (`<url>/rounds/r_1`, `/cc/rounds`), but
 * not inside an Agent API path (`/v1/rounds/…`) or a file path (`~/.claude/settings.json`).
 */
function commandCenterPaths(): RegExp[] {
  const routes = [...readFileSync(SERVER_TS, "utf8").matchAll(/"(\/[a-z][^"]*)":\s*\{/g)].map((m) => m[1]!);
  const cc = [...new Set(routes)].filter((r) => !r.startsWith("/v1/") && r !== "/mcp");
  expect(cc).toContain("/cc/rounds/:id/send");
  expect(cc).toContain("/rounds/:id");
  const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const path = (route: string) => route.split("/").map((seg) => (seg.startsWith(":") ? "[^\\s/\"'`)]+" : literal(seg))).join("/");
  return [/\/cc\//, ...cc.map((r) => new RegExp(`(?<![A-Za-z_.-])(?<!/v1)${path(r)}(?![\\w-]|\\.\\w)`))];
}

describe("the Hub Skill's content", () => {
  test("frontmatter: name is the folder name, metadata.version is the hermes-hub version", () => {
    const text = readFileSync(join(SKILL_SOURCE, "SKILL.md"), "utf8");
    expect(text).toMatch(/^---\nname: hermes-hub\n/);
    expect(text).toMatch(/\ndescription: .+\n/);
    expect(skillVersion(join(SKILL_SOURCE, "SKILL.md"))).toBe(VERSION);
  });

  test("never mentions a Command Center endpoint, in any Skill file or MCP tool description", () => {
    const patterns = commandCenterPaths();
    const leaks = (text: string) => patterns.filter((p) => p.test(text)).map(String);
    // the detector itself: a leak of each kind is caught, the Agent API is not
    expect(leaks("POST /cc/rounds/r_1/send")).not.toEqual([]);
    expect(leaks("open http://127.0.0.1:4747/rounds/r_1 in the browser")).not.toEqual([]);
    expect(leaks("see /settings or /agents")).not.toEqual([]);
    expect(leaks("GET /v1/rounds/r_1?wait=25, GET /v1/hub, /mcp, ~/.claude/settings.json")).toEqual([]);

    const files = skillFiles();
    expect(files.map((f) => relative(SKILL_SOURCE, f)).sort()).toEqual(["SKILL.md", "references/round-format.md"]);
    for (const file of files) expect({ file, leaks: leaks(readFileSync(file, "utf8")) }).toEqual({ file, leaks: [] });
    for (const text of [INSTRUCTIONS, ...TOOLS.map((t) => t.description ?? "")]) expect(leaks(text)).toEqual([]);
  });

  test("never hard-codes the port or the Hub's limits", () => {
    for (const file of skillFiles()) {
      const text = readFileSync(file, "utf8");
      expect({ file, port: /4747|127\.0\.0\.1:\d/.test(text) }).toEqual({ file, port: false });
      expect({ file, limits: /256 KiB|4 MiB|262144|4194304/.test(text) }).toEqual({ file, limits: false });
    }
  });

  test("every JSON example is a valid Round or Answer", () => {
    let rounds = 0;
    let answers = 0;
    for (const file of skillFiles()) {
      for (const [, block] of readFileSync(file, "utf8").matchAll(/```json\n([\s\S]*?)```/g)) {
        const doc = JSON.parse(block!);
        if (doc.schema === "hermes.round/v1") {
          expect(validateRound(doc)).toEqual([]);
          expect(hubChecks(doc as Round)).toEqual([]);
          rounds++;
        } else {
          expect(validateAnswer(doc)).toEqual([]);
          answers++;
        }
      }
    }
    expect(rounds).toBe(2);
    expect(answers).toBe(1);
  });

  test("the MCP instructions and each tool description fit Claude Code's 2 KiB description cap", () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(2048);
    for (const tool of TOOLS) expect(tool.description!.length).toBeLessThanOrEqual(2048);
    for (const essential of ["never poll", "hermes_inbox once", "HERMES_ADVISOR", "supersedes", "redirected", "set_by", "suggested_by"]) {
      expect(INSTRUCTIONS).toContain(essential);
    }
  });
});

describe("hermes-hub skill install / update", () => {
  test("install from a subfolder copies to the git root, excludes it once, and records it uncommitted", async () => {
    const b = box();
    const root = repo(b.root, "proj");
    mkdirSync(join(root, "src"));
    for (let i = 0; i < 2; i++) {
      const res = await run(b, join(root, "src"), ["skill", "install"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain(`installed hermes-hub skill ${VERSION} in ${join(root, SKILL_DIR)}`);
    }
    const rendered = readFileSync(join(SKILL_SOURCE, "SKILL.md"), "utf8").replaceAll(SKILL_COMMAND, WRAPPER);
    expect(readFileSync(join(root, SKILL_DIR, "SKILL.md"), "utf8")).toBe(rendered);
    expect(rendered).toContain(`${WRAPPER} ask /tmp/hermes-<topic>/round1.json`); // Agents run the wrapper by path
    expect(readFileSync(join(root, SKILL_DIR, "references/round-format.md"), "utf8")).not.toContain(SKILL_COMMAND);
    expect(existsSync(join(root, SKILL_DIR, "references/round-format.md"))).toBe(true);
    expect(excludeLines(root).filter((l) => l === `/${SKILL_DIR}/`)).toHaveLength(1);
    expect(status(root)).toBe("");
    expect(projects(b)).toEqual([{ root, committed: false }]);
  });

  test("--commit leaves it visible to git, and drops an earlier exclude line", async () => {
    const b = box();
    const root = repo(b.root, "proj");
    await run(b, root, ["skill", "install"]);
    const res = await run(b, b.root, ["skill", "install", root, "--commit"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`git -C ${root} add ${SKILL_DIR}`);
    expect(excludeLines(root)).not.toContain(`/${SKILL_DIR}/`);
    expect(status(root)).toBe("?? .agents/\n");
    expect(projects(b)).toEqual([{ root, committed: true }]);
  });

  test("--all installs into every repository under the folder, without descending into one", async () => {
    const b = box();
    const ws = join(b.root, "ws");
    const a = repo(ws, "a");
    const nested = repo(ws, "group/b");
    repo(ws, "group/b/vendor/inner");
    repo(ws, "node_modules/dep");
    mkdirSync(join(ws, "plain"));
    const res = await run(b, b.root, ["skill", "install", "--all", ws]);
    expect(res.code).toBe(0);
    expect(projects(b)).toEqual([
      { root: a, committed: false },
      { root: nested, committed: false },
    ]);
    expect(existsSync(join(nested, "vendor/inner", SKILL_DIR))).toBe(false);
  });

  test("outside a git repository install fails; --all needs its folder", async () => {
    const b = box();
    const res = await run(b, b.root, ["skill", "install"]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("is not in a git repository");
    expect((await run(b, b.root, ["skill", "install", "--all"])).code).toBe(2);
  });

  test("without HERMES_HUB_HOME, install records through the running Hub into its own folder; no Hub, nothing lands", async () => {
    const b = box();
    const { HERMES_HUB_HOME: _unset, ...env } = b.env;
    const hubDir = join(b.root, "hub-folder");
    mkdirSync(hubDir);
    const port = freePort();
    writeFileSync(join(hubDir, "config.toml"), `port = ${port}\n`);
    const inHub = { cwd: hubDir, env, stdout: "pipe", stderr: "pipe" } as const;
    expect(await Bun.spawn([process.execPath, MAIN, "migrate"], inHub).exited).toBe(0);
    const hub = Bun.spawn([process.execPath, MAIN, "hub"], { ...inHub, stderr: "inherit" });
    try {
      const reader = hub.stdout.getReader();
      for (let text = ""; !text.includes(" on http://"); ) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`the Hub exited: ${text}`);
        text += new TextDecoder().decode(chunk.value);
      }
      const root = repo(b.root, "proj");
      const env4hub = { ...env, HERMES_HUB_URL: `http://127.0.0.1:${port}` };
      const ok = Bun.spawn([process.execPath, MAIN, "skill", "install"], { cwd: root, env: env4hub, stdout: "ignore", stderr: "inherit" });
      expect(await ok.exited).toBe(0);
      expect(JSON.parse(readFileSync(join(hubDir, "projects.json"), "utf8")).projects).toEqual([{ root, committed: false }]);
    } finally {
      hub.kill();
      await hub.exited;
    }

    const other = repo(b.root, "other");
    const proc = Bun.spawn([process.execPath, MAIN, "skill", "install"], {
      cwd: other,
      env: { ...env, HERMES_HUB_URL: `http://127.0.0.1:${freePort()}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const dead = { code: await proc.exited, stderr: await new Response(proc.stderr).text() };
    expect(dead.code).toBe(1);
    expect(dead.stderr).toContain("start it with `hermes-hub start`, or set HERMES_HUB_HOME");
    expect(existsSync(join(other, SKILL_DIR))).toBe(false);
  });

  test("update replaces the copy wholesale; --all refreshes every record and forgets a removed copy", async () => {
    const b = box();
    const one = repo(b.root, "one");
    const two = repo(b.root, "two");
    await run(b, one, ["skill", "install"]);
    await run(b, two, ["skill", "install", "--commit"]);
    writeFileSync(join(one, SKILL_DIR, "SKILL.md"), "---\nname: hermes-hub\nmetadata:\n  version: 0.0.1\n---\nold\n");
    writeFileSync(join(one, SKILL_DIR, "stale.md"), "dropped from the Skill");

    const res = await run(b, one, ["skill", "update"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`updated hermes-hub skill in ${one} (0.0.1 → ${VERSION})`);
    expect(skillVersion(join(one, SKILL_DIR, "SKILL.md"))).toBe(VERSION);
    expect(existsSync(join(one, SKILL_DIR, "stale.md"))).toBe(false);

    rmSync(join(two, ".agents"), { recursive: true });
    const all = await run(b, b.root, ["skill", "update", "--all"]);
    expect(all.stdout).toContain(`updated hermes-hub skill in ${one}`);
    expect(all.stdout).toContain(`forgot ${two}`);
    expect(projects(b)).toEqual([{ root: one, committed: false }]);

    const missing = await run(b, two, ["skill", "update"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("run hermes-hub skill install");
  });

  test("Hub start refreshes uncommitted copies whose version differs, never committed ones", async () => {
    const b = box();
    const loose = repo(b.root, "loose");
    const kept = repo(b.root, "kept");
    const before = process.env.HERMES_HUB_HOME;
    process.env.HERMES_HUB_HOME = b.home;
    try {
      const old = "---\nname: hermes-hub\nmetadata:\n  version: 0.0.1\n---\n";
      for (const root of [loose, kept]) {
        mkdirSync(join(root, SKILL_DIR), { recursive: true });
        writeFileSync(join(root, SKILL_DIR, "SKILL.md"), old);
      }
      writeFileSync(
        join(b.home, "projects.json"),
        JSON.stringify({ projects: [{ root: loose, committed: false }, { root: kept, committed: true }] }),
      );
      expect(await refreshUncommittedSkills()).toEqual([`updated hermes-hub skill in ${loose} (0.0.1 → ${VERSION})`]);
      expect(skillVersion(join(loose, SKILL_DIR, "SKILL.md"))).toBe(VERSION);
      expect(readFileSync(join(kept, SKILL_DIR, "SKILL.md"), "utf8")).toBe(old);
      expect(await refreshUncommittedSkills()).toEqual([]); // now current: nothing to do
    } finally {
      if (before === undefined) delete process.env.HERMES_HUB_HOME;
      else process.env.HERMES_HUB_HOME = before;
    }
  });

  test("`hermes-hub hub` runs that refresh as it starts", async () => {
    const b = box();
    const port = freePort();
    writeFileSync(join(b.home, "config.toml"), `port = ${port}\n`);
    const root = repo(b.root, "proj");
    mkdirSync(join(root, SKILL_DIR), { recursive: true });
    writeFileSync(join(root, SKILL_DIR, "SKILL.md"), "---\nname: hermes-hub\nmetadata:\n  version: 0.0.1\n---\n");
    writeFileSync(join(b.home, "projects.json"), JSON.stringify({ projects: [{ root, committed: false }] }));
    expect((await run(b, b.root, ["migrate"])).code).toBe(0);
    const hub = Bun.spawn([process.execPath, MAIN, "hub"], { cwd: b.root, env: b.env, stdout: "pipe", stderr: "inherit" });
    try {
      const reader = hub.stdout.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes("hermes-hub hub: updated")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`the Hub exited: ${text}`);
        text += decoder.decode(chunk.value, { stream: true });
      }
      expect(text).toContain(`hermes-hub hub: updated hermes-hub skill in ${root} (0.0.1 → ${VERSION})`);
      expect(skillVersion(join(root, SKILL_DIR, "SKILL.md"))).toBe(VERSION);
    } finally {
      hub.kill();
      await hub.exited;
    }
  });
});

describe("runtime version checks (one stderr line each; the command still succeeds)", () => {
  test("an older project copy: WARN hermes-hub skill <old> < <new> · run hermes-hub skill update", async () => {
    const b = box();
    const { url } = await up();
    const root = repo(b.root, "proj");
    mkdirSync(join(root, SKILL_DIR), { recursive: true });
    writeFileSync(join(root, SKILL_DIR, "SKILL.md"), "---\nname: hermes-hub\nmetadata:\n  version: 0.0.9\n---\n");
    const res = await run(b, root, ["inbox"], { env: { HERMES_HUB_URL: url } });
    expect(res.code).toBe(0);
    expect(res.stderr).toBe(`WARN hermes-hub skill 0.0.9 < ${VERSION} · run hermes-hub skill update\n`);

    writeFileSync(join(root, SKILL_DIR, "SKILL.md"), `---\nname: hermes-hub\nmetadata:\n  version: ${VERSION}\n---\n`);
    expect((await run(b, root, ["inbox"], { env: { HERMES_HUB_URL: url } })).stderr).toBe("");
  });

  test("a Hub on another version: WARN hermes-hub <mine> != Hub <theirs>", async () => {
    const b = box();
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      routes: {
        "/v1/hub": () => Response.json({ hub_id: "h", version: "9.9.9", schemas: ["hermes.round/v1"], limits: {} }),
        "/v1/sessions": { POST: () => Response.json({ session_id: "s_1", token: "hhs_x", callsign: "SCRIPT·x" }) },
        "/v1/inbox": () => Response.json({ answers: [] }),
      },
    });
    try {
      const res = await run(b, b.root, ["inbox"], { env: { HERMES_HUB_URL: `http://127.0.0.1:${fake.port}` } });
      expect(res.code).toBe(0);
      expect(res.stderr).toBe(`WARN hermes-hub ${VERSION} != Hub 9.9.9 · restart the Hub (hermes-hub restart)\n`);
    } finally {
      fake.stop(true);
    }
  });
});

describe("hermes-hub doctor", () => {
  test("inside Codex's workspace-write sandbox: the Hub is unreachable and the exact network_access snippet is printed", async () => {
    const b = box();
    fakeBinary(b, "codex", "exit 0");
    const res = await run(b, b.root, ["doctor"], {
      env: { HERMES_HUB_URL: `http://127.0.0.1:${freePort()}`, CODEX_SANDBOX: "seatbelt", CODEX_SANDBOX_NETWORK_DISABLED: "1", HERMES_HUB_APP: b.root },
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("not reachable from this shell");
    expect(res.stdout).toContain("this shell runs in Codex's sandbox with network access off: apply the Codex setting below.");
    expect(res.stdout).toContain(`WARN HERMES_HUB_APP=${b.root} has no hermes-hub wrapper · export HERMES_HUB_APP=${dirname(WRAPPER)}`);
    expect(res.stdout).toContain(
      [
        "    Sandbox   workspace-write blocks the network. Add to ~/.codex/config.toml:",
        "                [sandbox_workspace_write]",
        "                network_access = true",
        "              or run hermes-hub outside the sandbox (approve it when Codex asks to escalate).",
      ].join("\n"),
    );
  });

  test("a reachable Hub, the project's Skill copy, and each client's snippet with the Hub's port", async () => {
    const b = box();
    const { url } = await up();
    const port = new URL(url).port;
    for (const name of ["cursor-agent", "omp"]) fakeBinary(b, name, "exit 0");
    fakeBinary(b, "claude", 'case "$1 $2" in "mcp get") echo "hermes-hub:"; echo "  Scope: User config (available in all your projects)"; exit 0;; esac; exit 1');
    const root = repo(b.root, "proj");
    await run(b, root, ["skill", "install"]);
    const res = await run(b, root, ["doctor"], { env: { HERMES_HUB_URL: url, HERMES_HUB_APP: dirname(WRAPPER) } });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`Hub      ${url}: reachable, Hub ${VERSION}`);
    expect(res.stdout).toContain(`Skill    ${join(root, SKILL_DIR)}: ${VERSION}, uncommitted (in .git/info/exclude)`);
    expect(res.stdout).toContain("MCP shim  registered, User config (available in all your projects)");
    expect(res.stdout).toContain(`{ "sandbox": { "network": { "allowedDomains": ["127.0.0.1:${port}"] } } }`);
    expect(res.stdout).toContain(`{ "sandbox": { "excludedCommands": ["${WRAPPER} *"] } }`);
    expect(res.stdout).toContain(`Shell    hermes-hub: ${WRAPPER} (Agents and MCP clients run it by this path)`);
    expect(res.stdout).toContain(`HERMES_HUB_APP: ${dirname(WRAPPER)} (this clone's wrapper folder)`);
    expect(res.stdout).toContain('{ "networkPolicy": { "allow": ["127.0.0.1/32"] } }');
    expect(res.stdout).toContain("none: omp runs hermes-hub with your own network access");
    expect(res.stdout).not.toContain("Codex (");
  });

  test("Claude Code without the shim, and a project without the Skill", async () => {
    const b = box();
    fakeBinary(b, "claude", "exit 1");
    const root = repo(b.root, "proj");
    const res = await run(b, root, ["doctor"], { env: { HERMES_HUB_URL: `http://127.0.0.1:${freePort()}` } });
    expect(res.stdout).toContain("MCP shim  not registered. Run `hermes-hub setup claude`.");
    expect(res.stdout).toContain(`Skill    not installed in ${root}. Run \`hermes-hub skill install\`.`);
    expect(res.stdout).toContain(`HERMES_HUB_APP is not set; friendly-grill and scripts find hermes-hub through it: export HERMES_HUB_APP=${dirname(WRAPPER)}`);
  });
});

describe("hermes-hub setup claude", () => {
  /** A fake `claude` that logs its arguments; `mcp get` exits $GET_EXIT. */
  function fakeClaude(b: Box): string {
    const log = join(b.root, "claude.log");
    fakeBinary(b, "claude", `echo "$@" >> "${log}"\ncase "$1 $2" in "mcp get") exit \${GET_EXIT:-1};; "mcp add") echo "Added stdio MCP server hermes-hub"; exit 0;; esac\nexit 1`);
    return log;
  }
  const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);

  test("asks first, then registers the shim at user scope", async () => {
    const b = box();
    const log = fakeClaude(b);
    const res = await run(b, b.root, ["setup", "claude"], { stdin: "y\n" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`This runs: claude mcp add --scope user hermes-hub -- ${WRAPPER} mcp`);
    expect(res.stdout).toContain("Register the Hermes Hub MCP shim in Claude Code's user config? [y/N]");
    expect(calls(log)).toEqual(["mcp get hermes-hub", `mcp add --scope user hermes-hub -- ${WRAPPER} mcp`]);
  });

  test("anything but yes, or no answer at all, changes nothing", async () => {
    for (const stdin of ["n\n", ""]) {
      const b = box();
      const log = fakeClaude(b);
      const res = await run(b, b.root, ["setup", "claude"], { stdin });
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("Not registered; nothing changed.");
      expect(calls(log)).toEqual(["mcp get hermes-hub"]);
    }
  });

  test("already registered: nothing to ask", async () => {
    const b = box();
    const log = fakeClaude(b);
    const res = await run(b, b.root, ["setup", "claude"], { env: { GET_EXIT: "0" }, stdin: "y\n" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("already has an MCP server named hermes-hub");
    expect(calls(log)).toEqual(["mcp get hermes-hub"]);
  });

  test("without claude on PATH it says so", async () => {
    const b = box();
    const res = await run(b, b.root, ["setup", "claude"], { stdin: "y\n" });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("`claude`) is not on PATH");
  });
});
