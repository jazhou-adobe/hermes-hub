import type { Attachment, QuestionValue, Round } from "../schema/types.ts";
import { parseHumanValue } from "./answers.ts";

/** One Advisor run, as recorded in `advisor_runs` and shown on the Round (delegation spec: History). */
export interface AdvisorRunView {
  id: string;
  advisor_name: string;
  trigger: "manual" | "auto";
  brief: string | null;
  started_at: string;
  ended_at: string | null;
  status: "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
  raw_output: string | null;
  suggestion: Suggestion | null;
}

/** The Round's current valid Suggestion (delegation spec): per-Question value and rationale. */
export interface Suggestion {
  advisor: string;
  run_id: string;
  summary?: string;
  questions: Record<string, { value: QuestionValue; rationale?: string }>;
  /** Question ids the Advisor tried to answer but whose value did not validate. */
  skipped?: string[];
}

interface ParsedSuggestion {
  summary?: string;
  questions: Record<string, { value: QuestionValue; rationale?: string }>;
  skipped: string[];
}

/** The raw output shown as an "unparsed briefing" is capped at 256 KiB (delegation spec). */
export const RAW_OUTPUT_CAP_BYTES = 256 * 1024;

export function capOutput(text: string): string {
  const buf = Buffer.from(text, "utf8");
  return buf.byteLength <= RAW_OUTPUT_CAP_BYTES ? text : buf.subarray(0, RAW_OUTPUT_CAP_BYTES).toString("utf8");
}

/**
 * Scans `text` for every balanced top-level `{...}` (ignoring braces inside strings) and returns the
 * last one that parses as JSON: "the Hub takes [the Suggestion] from the last JSON object in stdout".
 */
export function extractLastJsonObject(text: string): unknown {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i]!);
    } catch {
      // not valid JSON; keep scanning further back
    }
  }
  return undefined;
}

/**
 * Validates a parsed Suggestion against `round`: the schema tag, and per-Question value shapes using
 * the same rules as a Human's Answer (`parseHumanValue`). Returns `null` when nothing valid survived
 * (shown as an "unparsed briefing"); otherwise the valid Questions plus any skipped ids ("partly valid").
 */
export function parseSuggestion(round: Round, raw: unknown): ParsedSuggestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schema !== "hermes.suggestion/v1") return null;
  if (!obj.questions || typeof obj.questions !== "object" || Array.isArray(obj.questions)) return null;
  const byId = new Map(round.questions.map((q) => [q.id, q]));
  const questions: Record<string, { value: QuestionValue; rationale?: string }> = {};
  const skipped: string[] = [];
  for (const [id, entry] of Object.entries(obj.questions as Record<string, unknown>)) {
    const q = byId.get(id);
    if (!q) continue; // not a Question on this Round; ignore
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      skipped.push(id);
      continue;
    }
    const { value: rawValue, rationale } = entry as Record<string, unknown>;
    const value = parseHumanValue(q, rawValue);
    if (typeof value === "string" || value === null) {
      skipped.push(id);
      continue;
    }
    questions[id] = { value, ...(typeof rationale === "string" && rationale.trim() ? { rationale } : {}) };
  }
  if (Object.keys(questions).length === 0) return null;
  const summary = typeof obj.summary === "string" && obj.summary.trim() ? obj.summary : undefined;
  return { summary, questions, skipped };
}

/** Whether a Draft's raw value for a Question already counts as answered (mirrors the Feed's own check). */
export function draftHasValue(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if ("other" in v) return typeof v.other === "string" && v.other.trim() !== "";
  if ("text" in v) return typeof v.text === "string" && v.text.trim() !== "";
  if ("selected" in v) return Array.isArray(v.selected) ? v.selected.length > 0 : typeof v.selected === "string";
  if ("decision" in v) return v.decision === "approve" || v.decision === "reject";
  return false;
}

function renderAttachments(attachments: Attachment[] | undefined, lines: string[]): void {
  for (const a of attachments ?? []) {
    switch (a.kind) {
      case "image":
        lines.push(`[image attachment: ${a.alt}]`);
        break;
      case "link":
        lines.push(`[link: ${a.title ?? a.url} — ${a.url}]`);
        break;
      case "markdown":
        lines.push(`--- markdown attachment ---`, a.content);
        break;
      case "diff":
        lines.push(`--- diff attachment${a.path ? ` (${a.path})` : ""} ---`, a.content);
        break;
      case "code":
        lines.push(`--- code attachment${a.path ? ` (${a.path})` : ""} ---`, a.content);
        break;
      case "file":
        lines.push(`--- file attachment (${a.path}) ---`, a.content);
        break;
    }
  }
}

const SUGGESTION_FORMAT_EXAMPLE = {
  schema: "hermes.suggestion/v1",
  summary: "One-line summary of your recommendation.",
  questions: {
    "<question id>": { value: "<same shape a Human would send for that Question's kind>", rationale: "Why." },
  },
};

/** Builds the Advisor's stdin prompt: instructions, the Round, text Attachments, the brief, the output format. */
export function buildPrompt(round: Round, brief: string | undefined): string {
  const lines: string[] = [
    "You are an Advisor to the Hermes Hub. A Human reviews your Suggestion before anything is sent; you never send it yourself.",
    "Read the Round below and suggest a value for every Question you can confidently answer, each with a short rationale.",
    "",
    `# ${round.title}`,
  ];
  if (round.context) lines.push("", round.context);
  if (round.links?.length) {
    lines.push("", "Links:");
    for (const l of round.links) lines.push(`- ${l.label ?? l.url}: ${l.url}`);
  }
  if (round.attachments?.length) {
    lines.push("", "Round attachments:");
    renderAttachments(round.attachments, lines);
  }
  lines.push("", "Questions:");
  for (const q of round.questions) {
    lines.push("", `## ${q.id}: ${q.prompt}`, `kind: ${q.kind}${q.required === false ? " (optional)" : ""}`);
    if (q.detail) lines.push(q.detail);
    if (q.kind === "single" || q.kind === "multi") {
      lines.push("options:");
      for (const o of q.options) lines.push(`- ${o.id}: ${o.label}${o.detail ? ` — ${o.detail}` : ""}`);
      const recommended = q.kind === "single" ? q.recommended : q.recommended?.join(", ");
      if (recommended) lines.push(`recommended: ${recommended}`);
    }
    if (q.kind === "text" && q.recommended) lines.push(`recommended: ${q.recommended}`);
    if (q.kind === "approve" && q.proposal) {
      lines.push(`proposal (${q.proposal.format}${q.proposal.editable ? ", editable" : ""}):`);
      lines.push(typeof q.proposal.value === "string" ? q.proposal.value : JSON.stringify(q.proposal.value, null, 2));
      if (q.recommended) lines.push(`recommended: ${q.recommended}`);
    }
    if (q.attachments?.length) renderAttachments(q.attachments, lines);
  }
  if (brief) lines.push("", "Brief from the Human:", brief);
  lines.push(
    "",
    'Print exactly one JSON object as the LAST thing in your output, in this format (every key under "questions" must be',
    "a Question id from above, with the same value shape a Human would send for that Question's kind):",
    JSON.stringify(SUGGESTION_FORMAT_EXAMPLE, null, 2),
  );
  return lines.join("\n");
}
