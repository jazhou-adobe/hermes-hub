import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../docs/specs/round.schema.json" with { type: "json" };

/** The spec's JSON Schema is the single source of truth for documents. */
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema);

const roundValidator = ajv.getSchema(`${schema.$id}#/$defs/Round`)!;
const answerValidator = ajv.getSchema(`${schema.$id}#/$defs/Answer`)!;

export interface ValidationIssue {
  pointer: string;
  message: string;
}

function issues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((e) => ({ pointer: e.instancePath || "/", message: e.message ?? "invalid" }));
}

export function validateRound(doc: unknown): ValidationIssue[] {
  return roundValidator(doc) ? [] : issues(roundValidator.errors);
}

export function validateAnswer(doc: unknown): ValidationIssue[] {
  return answerValidator(doc) ? [] : issues(answerValidator.errors);
}

export interface SessionRequest {
  kind: string;
  session_key: string;
  label?: string | null;
  cwd?: string | null;
  git?: { root?: string; branch?: string; head?: string; remote?: string } | null;
  host?: string | null;
  client_version?: string | null;
  detection?: { step: number; source: string; documented: boolean } | null;
  signals?: Record<string, unknown> | null;
}

const nullableString = { type: ["string", "null"], maxLength: 4096 };

export const isSessionRequest = ajv.compile<SessionRequest>({
  type: "object",
  required: ["kind", "session_key"],
  properties: {
    kind: { type: "string", pattern: "^[a-z][a-z-]{0,31}$" },
    session_key: { type: "string", minLength: 1, maxLength: 256 },
    label: { type: ["string", "null"], maxLength: 80 },
    cwd: nullableString,
    git: { type: ["object", "null"] },
    host: nullableString,
    client_version: nullableString,
    detection: { type: ["object", "null"] },
    signals: { type: ["object", "null"] },
  },
});

/** What the Command Center posts when the Human sends a Round. */
export interface SendInput {
  note?: string;
  questions: Record<string, { value: unknown; note?: string }>;
}

export const isSendInput = ajv.compile<SendInput>({
  type: "object",
  required: ["questions"],
  properties: {
    note: { type: "string", maxLength: 16384 },
    questions: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["value"],
        properties: { value: {}, note: { type: "string", maxLength: 16384 } },
      },
    },
  },
});

export { issues as validationIssues };
