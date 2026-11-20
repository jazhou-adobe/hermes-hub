import { basename } from "node:path";

const KIND_PREFIX: Record<string, string> = {
  "claude-code": "CLAUDE",
  codex: "CODEX",
  "cursor-cli": "CURSOR",
  "cursor-ide": "CURSOR",
  "vscode-copilot": "COPILOT",
  omp: "OMP",
  script: "SCRIPT",
};

/** `KIND·label`; label = declared label, else last cwd segment, else first 6 chars of the session key. */
export function callsign(s: { kind: string; label: string | null; cwd: string | null; session_key: string }): string {
  const label = s.label || (s.cwd ? basename(s.cwd) : "") || s.session_key.slice(0, 6);
  return `${KIND_PREFIX[s.kind] ?? "AGENT"}·${label}`;
}

/** The project a session belongs to: its git root, else its cwd, else none (agent-identity spec). */
export function project(s: { git: string | null; cwd: string | null }): string | null {
  if (s.git) {
    try {
      const parsed: unknown = JSON.parse(s.git);
      if (parsed && typeof parsed === "object" && "root" in parsed && typeof parsed.root === "string" && parsed.root) {
        return parsed.root;
      }
    } catch {
      // malformed git JSON falls through to cwd
    }
  }
  return s.cwd;
}
