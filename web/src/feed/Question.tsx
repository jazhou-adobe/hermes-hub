import type { FeedRoundView } from "../../../src/hub/engine.ts";
import type { Question as QuestionDoc, QuestionValue } from "../../../src/schema/types.ts";
import { appliesRecommended, describeValue, hhmm, KIND_BADGE, ownPolicy } from "../format.ts";
import { Icon } from "../icons.tsx";
import { InlineMarkdown, Markdown } from "../markdown.tsx";
import { Attachment } from "./Attachment.tsx";
import { approveParts, isAnswered, isEdited, proposalText, type Value } from "./values.ts";

export type QuestionMode = "open" | "locked" | "ended";

/** How this Question relates to the Round's current Suggestion (delegation spec). */
export type SuggestionState = "filled" | "changed" | "offer" | null;

export interface QuestionProps {
  view: FeedRoundView;
  question: QuestionDoc;
  index: number;
  mode: QuestionMode;
  /** The value shown: the Human's while open, the policy's once locked, the Draft's once ended. */
  value: Value;
  onChange?: (value: Value) => void;
  /** Locked: the Human's Draft value the Lock overtook (kept as "Not sent"). */
  draftValue?: Value;
  /** Ended: "Draft · not sent", "Locked · read-only" … */
  endedState?: string;
  current?: boolean;
  suggestion?: { advisor: string; value: QuestionValue; rationale?: string };
  suggestionState?: SuggestionState;
  onAcceptSuggestion?: () => void;
  onCopyDraft?: () => void;
  now: number;
}

export function domId(view: FeedRoundView, q: QuestionDoc): string {
  return `${view.id}-${q.id}`;
}

function recommendedIds(q: QuestionDoc): string[] {
  if (q.kind === "single") return q.recommended ? [q.recommended] : [];
  if (q.kind === "multi") return q.recommended ?? [];
  if (q.kind === "approve") return q.recommended ? [q.recommended] : [];
  return [];
}

export function Question(props: QuestionProps) {
  const { view, question: q, index, mode, value, current, suggestion, suggestionState, now } = props;
  const id = domId(view, q);
  const lock = view.locks[q.id];
  const answered = isAnswered(value);
  const optional = q.required === false;
  const own = mode === "open" ? ownPolicy(view, q, now) : null;
  const edited = q.kind === "approve" && isEdited(q, value);
  const state =
    mode === "ended"
      ? (props.endedState ?? "Read-only")
      : mode === "locked"
        ? "Locked · read-only"
        : answered
          ? edited
            ? describeValue(q, { decision: approveParts(value).decision, edited: true })
            : "Answered"
          : optional
            ? "Optional"
            : "Not answered";

  return (
    <li className="hh-question" id={id} data-current={current ? "true" : undefined} data-state={mode === "locked" ? "locked" : undefined}>
      <div className="hh-question-call">
        <div className="hh-question-meta">
          <span className="hh-mono-sm">
            Q{index + 1} of {view.round.questions.length}
          </span>
          <span className="hh-badge">{KIND_BADGE[q.kind]}</span>
          {edited ? (
            <span className="hh-badge" data-tone="warning">
              <Icon name="check" /> Edited
            </span>
          ) : null}
          {lock ? (
            <>
              <span className="hh-badge" data-tone="expired">
                <Icon name="lock" /> Locked
              </span>
              <span className="hh-body-sm">
                Policy {lock.value === null ? "cancelled" : "applied recommended"} · {hhmm(lock.locked_at)}
              </span>
            </>
          ) : null}
          {own ? (
            <span className="hh-policy-badge">
              <span className="hh-badge" data-tone="info">
                <Icon name="clock" /> Own policy
              </span>
              <span className="hh-mono-sm">{own}</span>
            </span>
          ) : null}
          <span className="hh-answer-state" id={`${id}-s`}>
            {answered && mode === "open" ? <Icon name="check" /> : null} {state}
          </span>
        </div>
        <p className="hh-question-prompt" id={`${id}-p`}>
          {q.prompt}
        </p>
        {q.detail ? <Markdown className="hh-body-sm hh-prose" text={q.detail} /> : null}
        {q.attachments?.map((a, i) => <Attachment key={i} attachment={a} />)}
      </div>

      {q.kind === "single" || q.kind === "multi" ? (
        <ChoiceResponse {...props} />
      ) : q.kind === "text" ? (
        <TextResponse {...props} />
      ) : (
        <ApproveResponse {...props} />
      )}

      {suggestion && suggestionState === "filled" ? (
        <p className="hh-advisor-suggestion">
          <span className="hh-badge" data-tone="info">
            <Icon name="check" /> Suggested by {suggestion.advisor}
          </span>{" "}
          {suggestion.rationale ? <span className="hh-body-sm">{suggestion.rationale}</span> : null}
        </p>
      ) : null}
      {suggestion && suggestionState === "changed" ? (
        <p className="hh-advisor-changed">
          <span className="hh-badge" data-tone="warning">
            <Icon name="check" /> Changed from {suggestion.advisor}’s suggestion
          </span>{" "}
          <span className="hh-body-sm">Suggested: “{describeValue(q, suggestion.value)}”</span>{" "}
          <button type="button" className="hh-button" data-size="sm" onClick={props.onAcceptSuggestion}>
            Restore suggestion
          </button>
        </p>
      ) : null}
      {suggestion && suggestionState === "offer" ? (
        <div className="hh-advisor-offer">
          <p className="hh-body-sm hh-advisor-rationale">
            <strong>
              {suggestion.advisor} suggests {describeValue(q, suggestion.value)}
            </strong>
            {suggestion.rationale ? ` · ${suggestion.rationale}` : ""}
          </p>
          <button type="button" className="hh-button" data-size="sm" onClick={props.onAcceptSuggestion}>
            <Icon name="check" /> Accept
          </button>
        </div>
      ) : null}
      {mode === "locked" && isAnswered(props.draftValue) && JSON.stringify(props.draftValue) !== JSON.stringify(value) ? (
        <div className="hh-alert hh-question-draft" data-tone="warning" role="status">
          <span className="hh-badge" data-tone="expired">
            Not sent
          </span>
          <strong>Draft kept</strong>
          <div className="hh-body-sm">
            You had chosen <span className="hh-mono">{describeValue(q, props.draftValue)}</span> when the Lock fired. A policy never sends a
            Draft.
          </div>
          <div className="hh-row">
            <button type="button" className="hh-button" data-size="sm" onClick={props.onCopyDraft}>
              <Icon name="copy" /> Copy draft
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function RecommendedMarker({ props, applied }: { props: QuestionProps; applied: boolean }) {
  const { view, question: q, mode } = props;
  const words =
    mode === "locked" && applied ? "Recommended · applied" : mode === "open" && appliesRecommended(view, q) ? "Recommended · applied if unanswered" : "Recommended";
  return (
    <span className="hh-recommended">
      <Icon name="check" /> {words}
    </span>
  );
}

function ChoiceResponse(props: QuestionProps) {
  const { view, question, mode, value, onChange } = props;
  const q = question as Extract<QuestionDoc, { kind: "single" | "multi" }>;
  const id = domId(view, q);
  const readOnly = mode !== "open";
  const v = (value ?? {}) as { selected?: string | string[]; other?: string };
  const selected = new Set(Array.isArray(v.selected) ? v.selected : v.selected ? [v.selected] : []);
  const other = typeof v.other === "string" ? v.other : null;
  const multi = q.kind === "multi";
  const recommended = new Set(recommendedIds(q));

  function toggle(optionId: string) {
    if (!onChange) return;
    if (!multi) return onChange({ selected: optionId });
    const next = new Set(selected);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    onChange(other !== null ? { selected: [...next], other } : { selected: [...next] });
  }

  return (
    <fieldset className="hh-question-response" aria-labelledby={`${id}-p`} aria-describedby={`${id}-s`} disabled={readOnly}>
      {q.options.map((o, i) => {
        const checked = selected.has(o.id);
        const key = i < 9 ? String(i + 1) : undefined;
        return (
          <label key={o.id} className="hh-option" data-recommended={recommended.has(o.id) ? "true" : undefined} data-checked={checked ? "true" : undefined}>
            {readOnly || !key ? <span aria-hidden="true"></span> : <span className="hh-kbd" aria-hidden="true">{key}</span>}
            <input
              type={multi ? "checkbox" : "radio"}
              name={`${id}-choice`}
              value={o.id}
              checked={checked}
              onChange={() => toggle(o.id)}
              aria-keyshortcuts={readOnly ? undefined : key}
            />
            <span className="hh-option-text">
              {recommended.has(o.id) ? <RecommendedMarker props={props} applied={checked} /> : null}
              <span className="hh-option-label">{o.label}</span>
              {o.detail ? (
                <span className="hh-option-detail">
                  <InlineMarkdown text={o.detail} />
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
      {q.allow_other ? (
        <label className="hh-option" data-checked={other !== null ? "true" : undefined}>
          {readOnly || q.options.length >= 9 ? (
            <span aria-hidden="true"></span>
          ) : (
            <span className="hh-kbd" aria-hidden="true">
              {q.options.length + 1}
            </span>
          )}
          <input
            type={multi ? "checkbox" : "radio"}
            name={`${id}-choice`}
            value="__other"
            checked={other !== null}
            onChange={() =>
              onChange?.(
                multi
                  ? other !== null
                    ? { selected: [...selected] }
                    : { selected: [...selected], other: "" }
                  : { other: other ?? "" },
              )
            }
          />
          <span className="hh-option-text">
            <span className="hh-option-label">Other</span>
            {other !== null ? (
              <input
                type="text"
                className="hh-input"
                aria-label={`Other answer for: ${q.prompt}`}
                value={other}
                readOnly={readOnly}
                onChange={(e) => onChange?.(multi ? { selected: [...selected], other: e.target.value } : { other: e.target.value })}
              />
            ) : null}
          </span>
        </label>
      ) : null}
    </fieldset>
  );
}

function TextResponse(props: QuestionProps) {
  const { view, question, mode, value, onChange } = props;
  const q = question as Extract<QuestionDoc, { kind: "text" }>;
  const id = domId(view, q);
  const readOnly = mode !== "open";
  const text = value && typeof value === "object" && "text" in value && typeof value.text === "string" ? value.text : "";
  const common = {
    id: `${id}-t`,
    value: text,
    readOnly,
    placeholder: q.placeholder ?? (q.recommended ? "Write your own, or use the recommended text." : undefined),
    maxLength: q.max_length ?? 10000,
    "aria-describedby": `${id}-p`,
    onChange: (e: { target: { value: string } }) => onChange?.({ text: e.target.value }),
  };
  return (
    <div className="hh-question-response">
      {q.recommended && mode === "open" ? (
        <div className="hh-recommended-text">
          <RecommendedMarker props={props} applied={false} />
          <p className="hh-body hh-recommended-text-quote" id={`${id}-rec`}>
            {q.recommended}
          </p>
          <button type="button" className="hh-button" data-size="sm" aria-describedby={`${id}-rec`} onClick={() => onChange?.({ text: q.recommended! })}>
            Use it
          </button>
        </div>
      ) : null}
      <div className="hh-field">
        <label className="hh-label" htmlFor={`${id}-t`}>
          Answer{q.required === false ? " (optional)" : ""}
        </label>
        {q.multiline === false ? <input type="text" className="hh-input" {...common} /> : <textarea className="hh-textarea" rows={3} {...common} />}
      </div>
    </div>
  );
}

function ApproveResponse(props: QuestionProps) {
  const { view, question, mode, value, onChange } = props;
  const q = question as Extract<QuestionDoc, { kind: "approve" }>;
  const id = domId(view, q);
  const readOnly = mode !== "open";
  const parts = approveParts(value);
  const proposal = q.proposal;
  const edited = isEdited(q, value);
  const original = proposal ? proposalText(q, proposal.value) : "";
  const current = proposal && parts.edited && "proposal" in parts ? proposalText(q, parts.proposal) : original;
  let jsonError = false;
  if (proposal?.format === "json" && edited) {
    try {
      JSON.parse(current);
    } catch {
      jsonError = true;
    }
  }
  const approveLabel = q.approve_label ?? "Approve";
  const rejectLabel = q.reject_label ?? "Reject";
  const formatWord = proposal ? { text: "Text", command: "Command", json: "JSON" }[proposal.format] : "";

  function decide(decision: "approve" | "reject") {
    onChange?.(parts.edited ? { decision, edited: true, proposal: parts.proposal } : { decision, edited: false });
  }

  return (
    <fieldset className="hh-question-response" aria-labelledby={`${id}-p`} aria-describedby={`${id}-s`} disabled={readOnly}>
      {proposal ? (
        <figure className="hh-attachment hh-proposal" data-state={jsonError ? "invalid" : edited ? "edited" : proposal.editable && !readOnly ? "edit" : "read"}>
          <figcaption className="hh-attachment-head">
            <span className="hh-badge">
              <Icon name="code" /> {formatWord}
            </span>{" "}
            {proposal.editable && !readOnly ? (
              <span className="hh-badge" data-tone="info">
                Editable
              </span>
            ) : (
              <span className="hh-badge">
                <Icon name="lock" /> Read-only
              </span>
            )}{" "}
            {edited ? (
              <span className="hh-badge" data-tone="warning">
                <Icon name="check" /> Edited
              </span>
            ) : null}
            <span className="hh-attachment-title hh-mono">Proposal · {proposal.format}</span>
          </figcaption>
          {proposal.editable && !readOnly ? (
            <div className="hh-proposal-edit">
              <div className="hh-field">
                <label className="hh-label" htmlFor={`${id}-edit`}>
                  Edit the {proposal.format === "command" ? "command" : "proposal"} before approving
                </label>
                <textarea
                  id={`${id}-edit`}
                  className="hh-textarea hh-proposal-input"
                  spellCheck={false}
                  rows={Math.min(12, Math.max(2, current.split("\n").length))}
                  value={current}
                  aria-describedby={`${id}-hint${jsonError ? ` ${id}-json` : ""}`}
                  aria-invalid={jsonError || undefined}
                  onChange={(e) => onChange?.({ ...(parts.decision ? { decision: parts.decision } : {}), edited: true, proposal: e.target.value })}
                />
                <p className="hh-hint" id={`${id}-hint`}>
                  {proposal.format === "json" ? "JSON." : proposal.format === "command" ? "Plain text, run as typed." : "Plain text."} Approving sends your
                  version and marks it edited.
                </p>
                {jsonError ? (
                  <p className="hh-error" id={`${id}-json`} role="alert">
                    <span className="hh-badge" data-tone="destructive">
                      Error
                    </span>{" "}
                    The edited JSON does not parse.
                  </p>
                ) : null}
              </div>
              {edited ? (
                <div className="hh-row">
                  <button
                    type="button"
                    className="hh-button"
                    data-size="sm"
                    onClick={() => onChange?.(parts.decision ? { decision: parts.decision, edited: false } : null)}
                  >
                    <Icon name="refresh" /> Reset to {view.session.callsign}’s version
                  </button>
                  <details className="hh-proposal-original">
                    <summary>Show {view.session.callsign}’s version</summary>
                    <pre className="hh-attachment-body" tabIndex={0} aria-label={`${view.session.callsign}’s version of the proposal`}>
                      <code>{original}</code>
                    </pre>
                  </details>
                </div>
              ) : null}
            </div>
          ) : (
            <pre className="hh-attachment-body" tabIndex={0} aria-label={`Proposal ${proposal.format}`}>
              <code>{readOnly && parts.edited && "proposal" in parts ? current : original}</code>
            </pre>
          )}
        </figure>
      ) : null}
      <div className="hh-approve-pair">
        {(["approve", "reject"] as const).map((choice) => {
          const checked = parts.decision === choice;
          const rec = q.recommended === choice;
          return (
            <label key={choice} className="hh-option" data-choice={choice} data-recommended={rec ? "true" : undefined} data-checked={checked ? "true" : undefined}>
              {readOnly ? (
                <span aria-hidden="true"></span>
              ) : (
                <span className="hh-kbd" aria-hidden="true">
                  {choice === "approve" ? "A" : "R"}
                </span>
              )}
              <input
                type="radio"
                name={`${id}-decision`}
                value={choice}
                checked={checked}
                onChange={() => decide(choice)}
                aria-keyshortcuts={readOnly ? undefined : choice === "approve" ? "A" : "R"}
              />
              <span className="hh-option-text">
                {rec ? <RecommendedMarker props={props} applied={checked} /> : null}
                <span className="hh-option-label">
                  <Icon name={choice === "approve" ? "check" : "x"} /> {choice === "approve" ? approveLabel : rejectLabel}
                  {choice === "approve" && edited ? " (edited)" : ""}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {!q.recommended ? <p className="hh-body-sm">No recommendation from the Agent.</p> : null}
    </fieldset>
  );
}
