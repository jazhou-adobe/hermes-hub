import { hostname } from "node:os";
import type { SessionRequest } from "../schema/validate.ts";

export interface IdentityFlags {
  label?: string;
  kind?: string;
  session?: string;
}

/**
 * Client variables in collision-safe order (agent-identity spec, step 3). omp comes first because it
 * also sets CLAUDECODE=1. Cursor, VS Code Copilot, the ancestor tie-break and the generic markers
 * (steps 2, 4, 5) arrive with the identity slice.
 */
const CLIENT_VARS = [
  { env: "PI_SESSION_ID", kind: "omp", isSessionId: true, documented: true },
  { env: "OMPCODE", kind: "omp", isSessionId: false, documented: false },
  { env: "CODEX_THREAD_ID", kind: "codex", isSessionId: true, documented: false },
  { env: "CLAUDE_CODE_SESSION_ID", kind: "claude-code", isSessionId: true, documented: true },
] as const;

const SIGNAL_ENV = /^(HERMES_|PI_SESSION_ID$|OMPCODE$|CODEX_THREAD_ID$|CLAUDE_CODE_SESSION_ID$|CLAUDECODE$|AI_AGENT$|AGENT$)/;

function git(cwd: string): SessionRequest["git"] {
  const rev = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD", "HEAD"], {
    stderr: "ignore",
  });
  if (rev.exitCode !== 0) return null;
  const [root, branch, head] = rev.stdout.toString().trim().split("\n");
  const remote = Bun.spawnSync(["git", "-C", cwd, "config", "--get", "remote.origin.url"], { stderr: "ignore" });
  return { root, branch, head, ...(remote.exitCode === 0 ? { remote: remote.stdout.toString().trim() } : {}) };
}

/** Builds the `POST /v1/sessions` body: first hit wins, per field. */
export function detectSession(
  flags: IdentityFlags,
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): SessionRequest {
  const client = CLIENT_VARS.find((v) => env[v.env]);
  const explicitKind = flags.kind ?? env.HERMES_AGENT_KIND;
  const sessionId =
    flags.session ?? env.HERMES_SESSION_ID ?? (client?.isSessionId ? env[client.env] : undefined);
  // Fallback key until the identity slice adds the long-lived-ancestor anchor.
  const session_key =
    sessionId ?? new Bun.CryptoHasher("sha256").update(`${process.ppid}:${cwd}`).digest("hex").slice(0, 32);

  return {
    kind: explicitKind ?? client?.kind ?? "script",
    session_key,
    label: flags.label ?? env.HERMES_LABEL ?? null,
    cwd,
    git: git(cwd),
    host: hostname(),
    client_version: null,
    detection: explicitKind
      ? { step: 1, source: flags.kind ? "--kind" : "HERMES_AGENT_KIND", documented: true }
      : client
        ? { step: 3, source: client.env, documented: client.documented }
        : { step: 6, source: "none", documented: true },
    signals: {
      env: Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== undefined && SIGNAL_ENV.test(k))),
      ancestry: [],
      client_info: null,
      meta_keys: [],
    },
  };
}
