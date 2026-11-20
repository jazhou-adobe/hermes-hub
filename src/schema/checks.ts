import Ajv2020 from "ajv/dist/2020.js";
import type { Attachment, Policy, Question, Round } from "./types.ts";
import type { ValidationIssue } from "./validate.ts";

/** Size caps (round-schema spec): per attachment after base64, and per submitted Round body. */
export const LIMITS = {
  attachment_bytes: 256 * 1024,
  round_bytes: 4 * 1024 * 1024,
  pending_per_session: 10,
} as const;

const proposalSchemas = new Ajv2020({ strict: false });

/** The Question's effective Unanswered Policy: its own, else the Round's, else wait. */
export function effectivePolicy(round: Round, q: Question): Policy {
  return q.policy ?? round.policy ?? { on_timeout: "wait" };
}

/** Checks the JSON Schema cannot express. Assumes the Round already passed the schema. */
export function hubChecks(round: Round): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  round.questions.forEach((q, i) => {
    const at = `/questions/${i}`;
    if (seen.has(q.id)) issues.push({ pointer: `${at}/id`, message: `duplicate Question id "${q.id}"` });
    seen.add(q.id);

    if (q.kind === "single" || q.kind === "multi") {
      const ids = new Set<string>();
      q.options.forEach((o, j) => {
        if (ids.has(o.id)) issues.push({ pointer: `${at}/options/${j}/id`, message: `duplicate option id "${o.id}"` });
        ids.add(o.id);
      });
      const recommended = q.kind === "single" ? (q.recommended === undefined ? [] : [q.recommended]) : (q.recommended ?? []);
      for (const id of recommended) {
        if (!ids.has(id)) issues.push({ pointer: `${at}/recommended`, message: `"${id}" is not an option id` });
      }
    }
    if (q.kind === "multi" && q.min_selected !== undefined && q.max_selected !== undefined && q.min_selected > q.max_selected) {
      issues.push({ pointer: `${at}/min_selected`, message: "min_selected is greater than max_selected" });
    }
    if (q.kind === "approve" && q.proposal) {
      const { format, value, json_schema } = q.proposal;
      if (format !== "json" && typeof value !== "string") {
        issues.push({ pointer: `${at}/proposal/value`, message: `a ${format} proposal value must be a string` });
      }
      if (json_schema !== undefined) {
        if (format !== "json") issues.push({ pointer: `${at}/proposal/json_schema`, message: "json_schema needs format json" });
        else if (!proposalSchemas.validateSchema(json_schema)) {
          issues.push({ pointer: `${at}/proposal/json_schema`, message: "not a valid JSON Schema" });
        }
      }
    }
    if (effectivePolicy(round, q).on_timeout === "apply_recommended") {
      const recommended = q.recommended;
      if (recommended === undefined || (Array.isArray(recommended) && recommended.length === 0)) {
        issues.push({ pointer: q.policy ? `${at}/policy` : "/policy", message: `apply_recommended needs a recommended value on "${q.id}"` });
      }
    }
  });
  return issues;
}

function attachmentBytes(a: Attachment): number {
  return Buffer.byteLength(a.kind === "image" ? a.data : a.kind === "link" ? a.url : a.content);
}

/** The first attachment over the per-attachment cap, as a JSON pointer. */
export function oversizedAttachment(round: Round): string | undefined {
  const all: [string, Attachment][] = [
    ...(round.attachments ?? []).map((a, i): [string, Attachment] => [`/attachments/${i}`, a]),
    ...round.questions.flatMap((q, i) =>
      (q.attachments ?? []).map((a, j): [string, Attachment] => [`/questions/${i}/attachments/${j}`, a]),
    ),
  ];
  return all.find(([, a]) => attachmentBytes(a) > LIMITS.attachment_bytes)?.[0];
}

/** JSON with object keys sorted recursively: "same body" for idempotency (lifecycle rule 10). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Validates an edited JSON proposal against the Question's json_schema, if any. */
export function proposalMatchesSchema(schema: object | undefined, value: unknown): boolean {
  return schema === undefined || proposalSchemas.validate(schema, value);
}
