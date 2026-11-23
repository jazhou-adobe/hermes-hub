import { basename } from "node:path";
import { KIND_PREFIX } from "../kinds.ts";

export interface CallsignInput {
  id: string;
  kind: string;
  label: string | null;
  cwd: string | null;
  session_key: string;
}

/** `KIND·label`; label = declared label, else last cwd segment, else first 6 chars of the session key. */
export function callsign(s: Omit<CallsignInput, "id">): string {
  const label = s.label || (s.cwd ? basename(s.cwd) : "") || s.session_key.slice(0, 6);
  return `${KIND_PREFIX[s.kind] ?? "AGENT"}·${label}`;
}

/** A stable 4-character tag for one session's clash suffix (`CLAUDE·api·3f9a`). */
function clashTag(sessionId: string): string {
  return new Bun.CryptoHasher("sha256").update(sessionId).digest("hex").slice(0, 4);
}

/**
 * Callsigns for a set of sessions, each with Gone excluded or not from clash detection: two Live or
 * Idle sessions sharing a callsign both get a clash suffix; a Gone session never does, and never
 * forces a suffix onto someone else.
 */
export function resolveCallsigns(sessions: (CallsignInput & { liveness: "live" | "idle" | "gone" })[]): Map<string, string> {
  const base = new Map(sessions.map((s) => [s.id, callsign(s)] as const));
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.liveness === "gone") continue;
    const b = base.get(s.id)!;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return new Map(
    sessions.map((s) => {
      const b = base.get(s.id)!;
      const clashes = s.liveness !== "gone" && (counts.get(b) ?? 0) > 1;
      return [s.id, clashes ? `${b}·${clashTag(s.id)}` : b] as const;
    }),
  );
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
