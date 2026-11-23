import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { projectsPath, SKILL_SOURCE } from "../paths.ts";
import { VERSION } from "../version.ts";

/** Where a project's copy of the Hub Skill lives, relative to its git root (hub-skill spec). */
export const SKILL_DIR = ".agents/skills/hermes-hub";
/** The `.git/info/exclude` line that keeps an uncommitted copy out of `git status`. */
const EXCLUDE_LINE = `/${SKILL_DIR}/`;

/** One `projects.json` entry: a project the Skill was installed into. */
export interface ProjectRecord {
  root: string;
  committed: boolean;
}

export function gitRoot(dir: string): string | undefined {
  const res = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--show-toplevel"], { stderr: "ignore" });
  return res.exitCode === 0 ? res.stdout.toString().trim() : undefined;
}

export const skillFile = (root: string) => join(root, SKILL_DIR, "SKILL.md");

/** `metadata.version` from a SKILL.md's YAML frontmatter, or undefined when absent or unreadable. */
export function skillVersion(skillMd: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(skillMd, "utf8");
  } catch {
    return undefined;
  }
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (!front) return undefined;
  let inMetadata = false;
  for (const line of front.split(/\r?\n/)) {
    if (/^metadata:\s*$/.test(line)) inMetadata = true;
    else if (!/^\s/.test(line)) inMetadata = false;
    else if (inMetadata) {
      const m = /^\s+version:\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
      if (m) return m[1];
    }
  }
  return undefined;
}

/** Numeric dotted-version comparison: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The runtime check: one WARN line when the project's copy is older than this `hermes`. */
export function staleSkillWarning(root: string | null | undefined): string | undefined {
  if (!root) return undefined;
  const version = skillVersion(skillFile(root));
  if (version === undefined || compareVersions(version, VERSION) >= 0) return undefined;
  return `WARN hermes-hub skill ${version} < ${VERSION} · run hermes skill update`;
}

/** The repository's own `info/exclude` (shared by linked worktrees). */
function excludeFile(root: string): string {
  const res = Bun.spawnSync(["git", "-C", root, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], { stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`cannot locate .git/info/exclude in ${root}: ${res.stderr.toString().trim()}`);
  return res.stdout.toString().trim();
}

export function isExcluded(root: string): boolean {
  try {
    return readFileSync(excludeFile(root), "utf8").split(/\r?\n/).includes(EXCLUDE_LINE);
  } catch {
    return false;
  }
}

function setExcluded(root: string, excluded: boolean): void {
  const file = excludeFile(root);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = text.split(/\r?\n/);
  if (lines.includes(EXCLUDE_LINE) === excluded) return;
  if (excluded) {
    mkdirSync(dirname(file), { recursive: true });
    const sep = text === "" || text.endsWith("\n") ? "" : "\n";
    writeFileSync(file, `${text}${sep}# hermes skill install\n${EXCLUDE_LINE}\n`);
  } else {
    writeFileSync(file, lines.filter((l) => l !== EXCLUDE_LINE && l !== "# hermes skill install").join("\n"));
  }
}

export function readProjects(): ProjectRecord[] {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(projectsPath(), "utf8"));
  } catch {
    return [];
  }
  const list = (doc as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p): p is ProjectRecord => typeof p === "object" && p !== null && typeof p.root === "string" && typeof p.committed === "boolean",
  );
}

function writeProjects(projects: ProjectRecord[]): void {
  const file = projectsPath();
  mkdirSync(dirname(file), { recursive: true });
  const sorted = [...projects].sort((a, b) => a.root.localeCompare(b.root));
  writeFileSync(file, `${JSON.stringify({ projects: sorted }, null, 2)}\n`);
}

function recordProject(root: string, committed: boolean): void {
  writeProjects([...readProjects().filter((p) => p.root !== root), { root, committed }]);
}

/** Replaces the copy wholesale, so files dropped from the Skill disappear from the project too. */
function writeCopy(root: string): void {
  const dest = join(root, SKILL_DIR);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(SKILL_SOURCE, dest, { recursive: true });
}

/** `hermes skill install`: copy, exclude unless committed, record. Returns the line to print. */
export function installSkill(root: string, committed: boolean): string {
  writeCopy(root);
  setExcluded(root, !committed);
  recordProject(root, committed);
  const where = join(root, SKILL_DIR);
  return committed
    ? `installed hermes-hub skill ${VERSION} in ${where} (to commit: git -C ${root} add ${SKILL_DIR})`
    : `installed hermes-hub skill ${VERSION} in ${where} (kept out of git by .git/info/exclude)`;
}

/** Every git repository under `folder`, without descending into a repository, dot-folders or node_modules. */
export function findRepos(folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (existsSync(join(dir, ".git"))) {
      found.push(dir);
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") walk(join(dir, e.name));
    }
  };
  walk(resolve(folder));
  return found.sort();
}

/** Refreshes one project's copy, keeping its recorded (or detected) committed state. */
function refreshCopy(root: string, record: ProjectRecord | undefined): string {
  const before = skillVersion(skillFile(root)) ?? "unknown";
  writeCopy(root);
  recordProject(root, record?.committed ?? !isExcluded(root));
  return `updated hermes-hub skill in ${root} (${before} → ${VERSION})`;
}

/** `hermes skill update` in one project; throws when the project has no copy. */
export function updateSkill(root: string): string {
  if (!existsSync(skillFile(root))) throw new Error(`no hermes-hub skill in ${root}; run hermes skill install`);
  return refreshCopy(root, readProjects().find((p) => p.root === root));
}

/** `hermes skill update --all`: every recorded copy; records whose copy is gone are dropped. */
export function updateAllSkills(): string[] {
  const lines: string[] = [];
  for (const record of readProjects()) {
    if (!existsSync(skillFile(record.root))) {
      writeProjects(readProjects().filter((p) => p.root !== record.root));
      lines.push(`forgot ${record.root}: its hermes-hub skill copy is gone`);
    } else lines.push(refreshCopy(record.root, record));
  }
  return lines;
}

/**
 * At Hub start: refreshes every recorded uncommitted copy whose version differs from this one.
 * Committed copies are left alone (they only get the CLI warning), so the Hub never makes a diff.
 */
export function refreshUncommittedSkills(): string[] {
  const lines: string[] = [];
  for (const record of readProjects()) {
    if (record.committed) continue;
    const version = skillVersion(skillFile(record.root));
    if (version === undefined || version === VERSION) continue;
    lines.push(refreshCopy(record.root, record));
  }
  return lines;
}
