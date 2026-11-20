/** TypeScript view of docs/specs/round.schema.json (hermes.round/v1, hermes.answer/v1). */

export type Markdown = string;

export type Policy =
  | { on_timeout: "wait" }
  | { on_timeout: "apply_recommended" | "cancel"; after_seconds: number };

export interface Link {
  url: string;
  label?: string;
}

export type Attachment =
  | { kind: "markdown"; content: Markdown; title?: string }
  | { kind: "diff"; content: string; path?: string; title?: string }
  | { kind: "code"; content: string; language?: string; path?: string; start_line?: number; title?: string }
  | { kind: "image"; media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string; alt: string; title?: string }
  | { kind: "file"; path: string; content: string; title?: string }
  | { kind: "link"; url: string; title?: string; description?: string };

export interface Option {
  id: string;
  label: string;
  detail?: Markdown;
}

interface QuestionBase {
  id: string;
  prompt: string;
  detail?: Markdown;
  required?: boolean;
  policy?: Policy;
  attachments?: Attachment[];
}

export interface SingleQuestion extends QuestionBase {
  kind: "single";
  options: Option[];
  recommended?: string;
  allow_other?: boolean;
}

export interface MultiQuestion extends QuestionBase {
  kind: "multi";
  options: Option[];
  recommended?: string[];
  allow_other?: boolean;
  min_selected?: number;
  max_selected?: number;
}

export interface TextQuestion extends QuestionBase {
  kind: "text";
  placeholder?: string;
  recommended?: string;
  multiline?: boolean;
  max_length?: number;
}

export interface Proposal {
  format: "text" | "command" | "json";
  value: unknown;
  editable?: boolean;
  json_schema?: object;
}

export interface ApproveQuestion extends QuestionBase {
  kind: "approve";
  proposal?: Proposal;
  approve_label?: string;
  reject_label?: string;
  recommended?: "approve" | "reject";
}

export type Question = SingleQuestion | MultiQuestion | TextQuestion | ApproveQuestion;

export interface Round {
  schema: "hermes.round/v1";
  title: string;
  context?: Markdown;
  idempotency_key?: string;
  supersedes?: string;
  links?: Link[];
  policy?: Policy;
  attachments?: Attachment[];
  questions: Question[];
}

export type Outcome = "answered" | "dismissed" | "redirected" | "expired" | "cancelled";

export type QuestionValue =
  | null
  | { selected: string }
  | { other: string }
  | { selected: string[]; other?: string }
  | { text: string }
  | { decision: "approve" | "reject"; edited: boolean; proposal?: unknown };

export interface QuestionAnswer {
  value: QuestionValue;
  note?: string;
  set_by: "human" | "policy" | "none";
  suggested_by?: string;
}

export interface Answer {
  schema: "hermes.answer/v1";
  round_id: string;
  outcome: Outcome;
  message?: string;
  note?: string;
  questions: Record<string, QuestionAnswer>;
  decided_at: string;
  cancelled_by?: "agent" | "human";
  superseded_by?: string;
}

/** What get/wait returns while a Round is pending. */
export interface PendingStatus {
  status: "pending";
  next_deadline: string | null;
}
