import type { FeedRoundView } from "../../src/hub/engine.ts";
import { effectivePolicy } from "../../src/schema/policy.ts";
import type { Answer, Outcome, Question } from "../../src/schema/types.ts";
import type { Draft } from "../../src/schema/validate.ts";

/** Lock soon: a Round's next deadline is under this long away (command-center spec). */
export const LOCK_SOON_MS = 60_000;

/** `14:06` in local time. */
export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** `14:06:20` in local time. */
export function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** `05:47`, or `1:05:47` past an hour; never negative. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `0:42` for an elapsed run time. */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One of the design's six callsign tones (`.hh-callsign[data-agent="1…6"]`), stable per callsign. */
export function callsignTone(callsign: string): string {
  let h = 0;
  for (const ch of callsign) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String((h % 6) + 1);
}

/** The last path segment of a project (git root or cwd). */
export function projectLabel(project: string | null): string {
  if (!project) return "no project";
  const parts = project.split("/").filter(Boolean);
  return parts.at(-1) ?? project;
}

export const KIND_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  "cursor-cli": "Cursor CLI",
  "cursor-ide": "Cursor IDE",
  "vscode-copilot": "VS Code Copilot",
  omp: "omp",
  script: "Script",
  unknown: "Unknown client",
};

export const OUTCOME_WORDS: Record<Outcome, string> = {
  answered: "Answered",
  dismissed: "Dismissed",
  redirected: "Redirected",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const KIND_BADGE: Record<Question["kind"], string> = {
  single: "Choose one",
  multi: "Choose any",
  text: "Free text",
  approve: "Approve or reject",
};

/** The earliest open deadline of a Round, as epoch ms, or null when it keeps waiting. */
export function nextDeadline(view: FeedRoundView): number | null {
  const times = Object.values(view.deadlines).map(Date.parse);
  return times.length ? Math.min(...times) : null;
}

/** "applies recommended at 14:20:00 unless you answer" / "cancels at …" / "keeps waiting". */
export function policySentence(view: FeedRoundView): string {
  const policy = view.round.policy ?? { on_timeout: "wait" as const };
  if (policy.on_timeout === "wait") return Object.keys(view.deadlines).length ? "keeps waiting · some Questions have their own policy" : "keeps waiting · no deadline";
  const at = new Date(Date.parse(view.received_at) + policy.after_seconds * 1000).toISOString();
  const verb = policy.on_timeout === "apply_recommended" ? "applies recommended" : "cancels";
  return `${verb} at ${hhmmss(at)} unless you answer`;
}

/** A per-Question override's words, or null when the Question follows the Round's policy. */
export function ownPolicy(view: FeedRoundView, q: Question, now: number): string | null {
  if (!q.policy) return null;
  if (q.policy.on_timeout === "wait") return "keeps waiting";
  const deadline = view.deadlines[q.id];
  const verb = q.policy.on_timeout === "apply_recommended" ? "applies recommended" : "cancels";
  if (!deadline) return verb;
  return `${verb} at ${hhmmss(deadline)} · ${countdown(Date.parse(deadline) - now)} left`;
}

/** Whether a Question's policy applies its Recommended value when it locks. */
export function appliesRecommended(view: FeedRoundView, q: Question): boolean {
  return effectivePolicy(view.round, q).on_timeout === "apply_recommended";
}

/** A Question's value in words (Draft, Lock or Answer). */
export function describeValue(q: Question, value: unknown): string {
  if (value == null || typeof value !== "object") return "No value";
  const v = value as Record<string, unknown>;
  if (typeof v.text === "string") return v.text || "No value";
  if (v.decision === "approve" || v.decision === "reject") {
    const word = v.decision === "approve" ? (q.kind === "approve" ? (q.approve_label ?? "Approve") : "Approve") : q.kind === "approve" ? (q.reject_label ?? "Reject") : "Reject";
    return v.edited ? `${word} (edited)` : word;
  }
  const labels: string[] = [];
  const ids = Array.isArray(v.selected) ? v.selected : typeof v.selected === "string" ? [v.selected] : [];
  for (const id of ids) {
    labels.push((q.kind === "single" || q.kind === "multi" ? q.options.find((o) => o.id === id)?.label : undefined) ?? String(id));
  }
  if (typeof v.other === "string" && v.other) labels.push(`Other: ${v.other}`);
  return labels.length ? labels.join(", ") : "No value";
}

/** Whether a Draft holds anything worth keeping as "Not sent". */
export function draftHasContent(draft: Draft | null): boolean {
  if (!draft) return false;
  if (draft.note?.trim() || draft.message?.trim()) return true;
  return Object.values(draft.questions ?? {}).some((q) => q.value != null || q.note?.trim());
}

/** Copy draft: the unsent Draft as plain text, one line per Question. */
export function draftText(view: FeedRoundView): string {
  const lines = [`Draft (not sent) · ${view.round.title} · ${view.id}`];
  view.round.questions.forEach((q, i) => {
    const d = view.draft?.questions?.[q.id];
    if (d?.value != null) lines.push(`Q${i + 1} ${q.prompt}: ${describeValue(q, d.value)}`);
    if (d?.note) lines.push(`Q${i + 1} note: ${d.note}`);
  });
  if (view.draft?.note) lines.push(`Note: ${view.draft.note}`);
  if (view.draft?.message) lines.push(`Redirect message: ${view.draft.message}`);
  return lines.join("\n");
}

/** The Outcome sentence of a Round that ended in place, and the line under it. */
export function outcomeSentence(view: FeedRoundView): { headline: string; body: string } {
  const answer = view.answer as Answer;
  const who = view.session.callsign;
  const at = hhmm(answer.decided_at);
  const kept = draftHasContent(view.draft) ? " Your Draft is kept here as Not sent." : "";
  if (answer.outcome === "expired") {
    const values = view.round.questions
      .map((q) => ({ q, v: answer.questions[q.id]?.value }))
      .filter(({ v }) => v != null)
      .map(({ q, v }) => describeValue(q, v));
    const what = values.length ? `policy applied recommended: ${values.join("; ")}` : "policy cancelled";
    return {
      headline: `Expired ${at} · ${what}`,
      body: `${who} received ${values.length ? "the policy values" : "no answers"} as the Answer. A policy never sends a Draft.${kept}`,
    };
  }
  if (answer.outcome === "cancelled" && answer.superseded_by) {
    return {
      headline: `Cancelled · Replaced by ${answer.superseded_by} at ${at}`,
      body: `${who} sent a Round that supersedes this one.${kept}${draftHasContent(view.draft) ? " Matching answers were carried over to the new Round." : ""}`,
    };
  }
  if (answer.outcome === "cancelled" && answer.cancelled_by === "human") {
    return {
      headline: `Cancelled · You forgot ${who} at ${at}`,
      body: `Forget cancels an Agent’s pending Rounds. The Round stays in the log as cancelled by you.${kept}`,
    };
  }
  if (answer.outcome === "cancelled") {
    return { headline: `Cancelled by ${who} at ${at}`, body: `The Agent no longer needs an Answer.${kept}` };
  }
  return { headline: `${OUTCOME_WORDS[answer.outcome]} ${at}`, body: kept.trim() };
}
