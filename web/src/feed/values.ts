import type { Question } from "../../../src/schema/types.ts";
import type { Draft } from "../../../src/schema/validate.ts";

/**
 * The in-page value of one Question while the Human answers. It is a superset of the Answer's
 * QuestionValue: an approve value may hold the edited Proposal text before a decision is made.
 */
export type Value = unknown;

export function draftValues(draft: Draft | null): Record<string, Value> {
  if (!draft?.questions) return {};
  return Object.fromEntries(Object.entries(draft.questions).map(([id, q]) => [id, q.value]));
}

export function isAnswered(value: Value): boolean {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if ("decision" in v) return v.decision === "approve" || v.decision === "reject";
  if (typeof v.text === "string") return v.text.trim() !== "";
  if (Array.isArray(v.selected)) return v.selected.length > 0 || (typeof v.other === "string" && v.other.trim() !== "");
  if (typeof v.selected === "string") return true;
  if (typeof v.other === "string") return v.other.trim() !== "";
  return false;
}

export function sameValue(a: Value, b: Value): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The approve value's parts, whatever was stored. */
export function approveParts(value: Value): { decision?: "approve" | "reject"; edited: boolean; proposal?: unknown } {
  const v = (value ?? {}) as { decision?: unknown; edited?: unknown; proposal?: unknown };
  return {
    ...(v.decision === "approve" || v.decision === "reject" ? { decision: v.decision } : {}),
    edited: v.edited === true,
    ...("proposal" in v ? { proposal: v.proposal } : {}),
  };
}

/** The Proposal as the text the Human edits. */
export function proposalText(q: Extract<Question, { kind: "approve" }>, value: unknown): string {
  return typeof value === "string" ? value : q.proposal?.format === "json" ? JSON.stringify(value, null, 2) : String(value ?? "");
}

/**
 * The value Send posts for one Question, or an error message. Edited JSON Proposals are parsed here;
 * a rejection never carries the edited Proposal.
 */
export function toSendValue(q: Question, value: Value): unknown {
  if (!isAnswered(value)) return null;
  if (q.kind !== "approve") return value;
  const { decision, edited, proposal } = approveParts(value);
  if (decision === "reject" || !edited || !q.proposal) return { decision, edited: false };
  const original = proposalText(q, q.proposal.value);
  const text = proposalText(q, proposal);
  if (text === original) return { decision, edited: false };
  if (q.proposal.format !== "json") return { decision, edited: true, proposal: text };
  try {
    return { decision, edited: true, proposal: JSON.parse(text) };
  } catch {
    return new Error("the edited JSON does not parse");
  }
}

/** Whether an approve value carries an edit that differs from the Agent's Proposal. */
export function isEdited(q: Extract<Question, { kind: "approve" }>, value: Value): boolean {
  const { edited, proposal } = approveParts(value);
  return edited && q.proposal !== undefined && proposalText(q, proposal) !== proposalText(q, q.proposal.value);
}
