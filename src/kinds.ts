/** Shared between the CLI's detection, the callsign and the Command Center's Agent roster. */

/** The callsign prefix (`KIND·label`) per detected kind; `AGENT` covers `unknown`. */
export const KIND_PREFIX: Record<string, string> = {
  "claude-code": "CLAUDE",
  codex: "CODEX",
  "cursor-cli": "CURSOR",
  "cursor-ide": "CURSOR",
  "vscode-copilot": "COPILOT",
  omp: "OMP",
  script: "SCRIPT",
};

/** The command that reopens a session, by kind; kinds with no resume handle are omitted. */
export const RESUME: Record<string, (sessionId: string) => string> = {
  "claude-code": (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  "cursor-cli": (id) => `cursor-agent --resume ${id}`,
  omp: (id) => `omp --resume ${id}`,
};
