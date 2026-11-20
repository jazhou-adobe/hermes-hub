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
