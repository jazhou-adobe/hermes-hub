import type { Policy, Question, Round } from "./types.ts";

/** The Question's effective Unanswered Policy: its own, else the Round's, else wait. Dependency-free, so the browser bundle can use it. */
export function effectivePolicy(round: Round, q: Question): Policy {
  return q.policy ?? round.policy ?? { on_timeout: "wait" };
}
