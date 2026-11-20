import type { LogEntry } from "../../../src/hub/engine.ts";
import type { Attachment, Outcome, Question, QuestionAnswer } from "../../../src/schema/types.ts";

/** The Outcome in words (answered-log spec). */
export const OUTCOME_WORDS: Record<Outcome, string> = {
  answered: "Answered",
  dismissed: "Dismissed",
  redirected: "Redirected",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** A Question's value in words, from its Answer. */
export function formatAnswerValue(q: Question, qa: QuestionAnswer | undefined): string {
  if (!qa || qa.value === null) return "—";
  const v = qa.value;
  if ("text" in v) return v.text;
  if ("decision" in v) {
    const word = v.decision === "approve" ? "Approved" : "Rejected";
    return v.edited ? `${word} (edited)` : word;
  }
  if ("selected" in v) {
    if (q.kind === "single" && typeof v.selected === "string") {
      return q.options.find((o) => o.id === v.selected)?.label ?? v.selected;
    }
    if (q.kind === "multi" && Array.isArray(v.selected)) {
      const labels = v.selected.map((id) => q.options.find((o) => o.id === id)?.label ?? id);
      const other = "other" in v && v.other ? [v.other] : [];
      return [...labels, ...other].join(", ");
    }
  }
  if ("other" in v) return v.other ?? "—";
  return "—";
}

/** Who set a Question's value: You, Policy, or "Suggested by ADVISOR" (command-center spec). */
export function formatSetter(qa: QuestionAnswer | undefined): string {
  if (!qa || qa.set_by === "none") return "Not answered";
  if (qa.set_by === "policy") return "Policy";
  return qa.suggested_by ? `Suggested by ${qa.suggested_by}` : "You";
}

function attachmentBytes(a: Attachment): number {
  const text = a.kind === "image" ? a.data : a.kind === "link" ? a.url : a.content;
  return new TextEncoder().encode(text).length;
}

/** `1.2 KB`-style size, for Attachments and the database size line. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Copy as Markdown (answered-log spec): title, callsign, project and Outcome with its time; the
 * context; each Question with its answer, setter and note; the Round note or redirect message;
 * links; Attachments as one line each (kind, title, size), without their bodies. */
export function entryMarkdown(entry: LogEntry): string {
  const { round, answer, meta } = entry;
  const lines: string[] = [
    `# ${round.title}`,
    `${meta.callsign} · ${meta.project ?? "no project"} · ${OUTCOME_WORDS[answer.outcome]} · ${answer.decided_at}`,
  ];
  if (round.context) lines.push("", round.context);
  for (const q of round.questions) {
    const qa = answer.questions[q.id];
    lines.push("", `## ${q.prompt}`, `${formatAnswerValue(q, qa)} — ${formatSetter(qa)}`);
    if (qa?.note) lines.push(`Note: ${qa.note}`);
  }
  if (answer.outcome === "redirected" && answer.message) lines.push("", `Redirect: ${answer.message}`);
  else if (answer.note) lines.push("", `Note: ${answer.note}`);
  if (round.links?.length) {
    lines.push("", "Links:");
    for (const link of round.links) lines.push(`- [${link.label ?? link.url}](${link.url})`);
  }
  const attachments = [...(round.attachments ?? []), ...round.questions.flatMap((q) => q.attachments ?? [])];
  if (attachments.length) {
    lines.push("", "Attachments:");
    for (const a of attachments) lines.push(`- ${a.kind}: ${a.title ?? "(untitled)"} (${formatBytes(attachmentBytes(a))})`);
  }
  return lines.join("\n");
}
