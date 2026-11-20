import { proposalMatchesSchema } from "../schema/checks.ts";
import type { Policy, Question, QuestionAnswer, QuestionValue, Round } from "../schema/types.ts";

/** A Question whose Unanswered Policy fired. */
export interface Lock {
  value: QuestionValue;
  locked_at: string;
}

export type Locks = Record<string, Lock>;

/** The value a firing policy locks in: the Recommended value, or null for `cancel`. */
export function lockValue(q: Question, policy: Policy): QuestionValue {
  if (policy.on_timeout !== "apply_recommended") return null;
  switch (q.kind) {
    case "single":
      return { selected: q.recommended! };
    case "multi":
      return { selected: q.recommended! };
    case "text":
      return { text: q.recommended! };
    case "approve":
      return { decision: q.recommended!, edited: false };
  }
}

const isString = (v: unknown): v is string => typeof v === "string";

/** Parses a Human value for `q`, or returns an error message. `null` means "not answered". */
export function parseHumanValue(q: Question, raw: unknown): QuestionValue | string {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "the value must be an object";
  const v: Record<string, unknown> = { ...raw };
  const keys = Object.keys(v);
  switch (q.kind) {
    case "single": {
      if (keys.length === 1 && isString(v.selected)) {
        return q.options.some((o) => o.id === v.selected) ? { selected: v.selected } : `"${v.selected}" is not an option`;
      }
      if (keys.length === 1 && isString(v.other)) {
        if (!q.allow_other) return "this Question does not allow Other";
        return v.other.trim() ? { other: v.other } : "Other needs text";
      }
      return "expected {selected} or {other}";
    }
    case "multi": {
      const { selected, other } = v;
      if (!Array.isArray(selected) || !selected.every(isString) || keys.some((k) => k !== "selected" && k !== "other")) {
        return "expected {selected: [...], other?}";
      }
      if (new Set(selected).size !== selected.length) return "duplicate selections";
      const unknown = selected.find((id) => !q.options.some((o) => o.id === id));
      if (unknown !== undefined) return `"${unknown}" is not an option`;
      if (other !== undefined && (!isString(other) || !q.allow_other)) return "this Question does not allow Other";
      const otherText = isString(other) && other.trim() !== "" ? other : undefined;
      const count = selected.length + (otherText === undefined ? 0 : 1);
      if (count === 0) return null;
      if (q.min_selected !== undefined && count < q.min_selected) return `choose at least ${q.min_selected}`;
      if (q.max_selected !== undefined && count > q.max_selected) return `choose at most ${q.max_selected}`;
      return otherText === undefined ? { selected } : { selected, other: otherText };
    }
    case "text": {
      if (keys.length !== 1 || !isString(v.text)) return "expected {text}";
      if (!v.text.trim()) return null;
      const max = q.max_length ?? 10_000;
      return v.text.length > max ? `longer than ${max} characters` : { text: v.text };
    }
    case "approve": {
      const { decision, edited, proposal } = v;
      if ((decision !== "approve" && decision !== "reject") || typeof edited !== "boolean") {
        return "expected {decision: approve|reject, edited}";
      }
      if (!edited) return keys.includes("proposal") ? "proposal is only sent when edited" : { decision, edited };
      if (!q.proposal?.editable) return "this Proposal is not editable";
      if (!("proposal" in v)) return "an edited Proposal needs its new value";
      if (q.proposal.format === "json") {
        if (!proposalMatchesSchema(q.proposal.json_schema, proposal)) return "the edited Proposal does not match its json_schema";
      } else if (!isString(proposal)) {
        return "the edited Proposal must be text";
      }
      return { decision, edited, proposal };
    }
  }
}

/**
 * The Answer's `questions`: Locked values always stay (`set_by: policy`); `human` supplies the rest;
 * anything else is `null` with `set_by: none`.
 */
export function answerQuestions(
  round: Round,
  locks: Locks,
  human: Record<string, { value: QuestionValue; note?: string; suggested_by?: string }> = {},
): Record<string, QuestionAnswer> {
  return Object.fromEntries(
    round.questions.map((q): [string, QuestionAnswer] => {
      const lock = locks[q.id];
      if (lock) return [q.id, { value: lock.value, set_by: "policy" }];
      const given = human[q.id];
      if (given && given.value !== null) {
        return [
          q.id,
          {
            value: given.value,
            set_by: "human",
            ...(given.note ? { note: given.note } : {}),
            ...(given.suggested_by ? { suggested_by: given.suggested_by } : {}),
          },
        ];
      }
      return [q.id, { value: null, set_by: "none", ...(given?.note ? { note: given.note } : {}) }];
    }),
  );
}
