/** The chain of ancestor processes above a pid, nearest first (agent-identity spec: detection and the fallback session key both walk it). */
export interface ProcEntry {
  pid: number;
  ppid: number;
  comm: string;
}

const SHELLS: Record<string, true> = { sh: true, bash: true, zsh: true, fish: true, dash: true };

function baseName(comm: string): string {
  return comm.split("/").pop() ?? comm;
}

/** `ps` output, or "" where a sandbox forbids spawning it (Codex's seatbelt does): detection then works without ancestry. */
function ps(args: string[]): string {
  try {
    return Bun.spawnSync(["ps", ...args], { stderr: "ignore" }).stdout.toString();
  } catch {
    return "";
  }
}

/** `ps`'s whole table, pid -> {ppid, comm}. `comm` may itself contain spaces (an app bundle path). */
export function processTable(): Map<number, ProcEntry> {
  const out = ps(["-axo", "pid=,ppid=,comm="]);
  const table = new Map<number, ProcEntry>();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3]! });
  }
  return table;
}

/** Walks from `startPid` up to pid 1, nearest first. Stops at a cycle or a missing entry. */
export function ancestryChain(startPid: number, table: Map<number, ProcEntry> = processTable()): ProcEntry[] {
  const chain: ProcEntry[] = [];
  const seen = new Set<number>();
  let pid = startPid;
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const entry = table.get(pid);
    if (!entry) break;
    chain.push(entry);
    pid = entry.ppid;
  }
  return chain;
}

/** The nearest ancestor that isn't a shell: the anchor for the fallback session key. */
export function nonShellAnchor(chain: ProcEntry[]): ProcEntry | undefined {
  return chain.find((p) => !SHELLS[baseName(p.comm)]);
}

/** The chain index of `pid` (0 = nearest), or -1 if it is not in the chain. */
export function depthOf(chain: ProcEntry[], pid: number | undefined): number {
  return pid === undefined ? -1 : chain.findIndex((p) => p.pid === pid);
}

/** A process's start time (for the fallback session key: a reused pid is a different session). */
export function startTime(pid: number): string | null {
  const out = ps(["-o", "lstart=", "-p", String(pid)]).trim();
  return out || null;
}
