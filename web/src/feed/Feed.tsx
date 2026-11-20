import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FeedRoundView } from "../../../src/hub/engine.ts";
import type { Answer, Outcome, Question } from "../../../src/schema/types.ts";
import type { Draft } from "../../../src/schema/validate.ts";
import { dismissRound, redirectRound, removeFromFeed, saveDraft, sendRound } from "../api.ts";
import { useStore } from "../store.ts";

const DRAFT_DEBOUNCE_MS = 500;

const OUTCOME_SENTENCE: Record<Outcome, string> = {
  answered: "Answered",
  dismissed: "Dismissed",
  redirected: "Redirected",
  expired: "Expired: its last open Question locked",
  cancelled: "Cancelled",
};

/** Bare functional Feed (S2 scope); the designed Feed replaces it in S4. */
export function Feed() {
  const rounds = useStore((s) => s.rounds);
  const connection = useStore((s) => s.connection);
  return (
    <main>
      <header className="bar">
        <h1>Hermes Hub</h1>
        <span className={`status status-${connection}`} role="status">
          {connection}
        </span>
      </header>
      {rounds.length === 0 ? <p className="empty">No pending Rounds.</p> : null}
      {rounds.map((view) => (
        <RoundCard key={view.id} view={view} />
      ))}
    </main>
  );
}

function RoundCard({ view }: { view: FeedRoundView }) {
  return view.status === "pending" ? <PendingCard view={view} /> : <EndedCard view={view} />;
}

function EndedCard({ view }: { view: FeedRoundView }) {
  const [removing, setRemoving] = useState(false);
  const answer = view.answer as Answer;
  return (
    <section className="round ended" aria-labelledby={`round-${view.id}-title`}>
      <h2 id={`round-${view.id}-title`}>{view.round.title}</h2>
      <p className="meta">
        {view.session.callsign} · {OUTCOME_SENTENCE[view.status as Outcome]}
        {answer.superseded_by ? (
          <>
            {" "}
            · Replaced by <a href={`/rounds/${answer.superseded_by}`}>{answer.superseded_by}</a>
          </>
        ) : null}
      </p>
      {view.draft ? (
        <p className="draft-kept">
          Not sent
          <button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(view.draft))}>
            Copy draft
          </button>
        </p>
      ) : null}
      <button type="button" disabled={removing} onClick={() => (setRemoving(true), removeFromFeed(view.id))}>
        Remove from feed
      </button>
    </section>
  );
}

function PendingCard({ view }: { view: FeedRoundView }) {
  const { round, locks } = view;
  const draft = view.draft;
  const [values, setValues] = useState<Record<string, unknown>>(() => draftValues(draft));
  const [note, setNote] = useState(draft?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRedirect, setShowRedirect] = useState(false);
  const [redirectMessage, setRedirectMessage] = useState(draft?.message ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function scheduleDraftSave(nextValues: Record<string, unknown>, nextNote: string, nextMessage: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const questions = Object.fromEntries(Object.entries(nextValues).map(([id, value]) => [id, { value }]));
      void saveDraft(view.id, { questions, ...(nextNote ? { note: nextNote } : {}), ...(nextMessage ? { message: nextMessage } : {}) });
    }, DRAFT_DEBOUNCE_MS);
  }

  function setValue(id: string, value: unknown) {
    const next = { ...values, [id]: value };
    setValues(next);
    scheduleDraftSave(next, note, redirectMessage);
  }

  const openQuestions = round.questions.filter((q) => !locks[q.id]);
  const ready = openQuestions.every((q) => q.required === false || isAnswered(q, values[q.id]));
  const nextDeadline = Object.values(view.deadlines).sort()[0];
  const lockSoon = nextDeadline !== undefined && Date.parse(nextDeadline) - Date.now() < 60_000;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    await act(() =>
      sendRound(view.id, {
        ...(note.trim() ? { note } : {}),
        questions: Object.fromEntries(openQuestions.map((q) => [q.id, { value: values[q.id] ?? null }])),
      }),
    );
  }

  const titleId = `round-${view.id}-title`;
  return (
    <form className={`round${lockSoon ? " lock-soon" : ""}`} id={`round-${view.id}`} aria-labelledby={titleId} onSubmit={onSend}>
      <h2 id={titleId}>{round.title}</h2>
      <p className="meta">
        {view.session.callsign} · {new Date(view.received_at).toLocaleTimeString()}
        {lockSoon ? <strong className="lock-soon-badge"> · Lock soon</strong> : null}
      </p>
      {round.context ? <p className="context">{round.context}</p> : null}
      {round.links?.length ? (
        <ul className="links">
          {round.links.map((l) => (
            <li key={l.url}>
              <a href={l.url}>{l.label ?? l.url}</a>
            </li>
          ))}
        </ul>
      ) : null}

      {round.questions.map((q) => {
        const lock = locks[q.id];
        const deadline = view.deadlines[q.id];
        return (
          <QuestionField
            key={q.id}
            question={q}
            locked={lock ? { at: lock.locked_at } : undefined}
            lockDeadline={deadline}
            value={values[q.id]}
            onChange={(value) => setValue(q.id, value)}
          />
        );
      })}

      <label className="note">
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            scheduleDraftSave(values, e.target.value, redirectMessage);
          }}
          rows={2}
        />
      </label>

      {showRedirect ? (
        <label className="redirect">
          Do this instead
          <input
            type="text"
            required
            value={redirectMessage}
            onChange={(e) => {
              setRedirectMessage(e.target.value);
              scheduleDraftSave(values, note, e.target.value);
            }}
          />
        </label>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}

      <div className="actions">
        <button type="submit" disabled={!ready || busy}>
          Send
        </button>
        <button type="button" disabled={busy} onClick={() => act(() => dismissRound(view.id, note.trim() ? { note } : {}))}>
          Dismiss
        </button>
        {showRedirect ? (
          <button
            type="button"
            disabled={busy || !redirectMessage.trim()}
            onClick={() => act(() => redirectRound(view.id, { message: redirectMessage, ...(note.trim() ? { note } : {}) }))}
          >
            Confirm redirect
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setShowRedirect(true)}>
            Redirect
          </button>
        )}
      </div>
    </form>
  );
}

function draftValues(draft: Draft | null): Record<string, unknown> {
  if (!draft?.questions) return {};
  return Object.fromEntries(Object.entries(draft.questions).map(([id, q]) => [id, q.value]));
}

function isAnswered(_q: Question, value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  if ("other" in value) return typeof value.other === "string" && value.other.trim() !== "";
  if ("text" in value) return typeof value.text === "string" && value.text.trim() !== "";
  if ("selected" in value) return Array.isArray(value.selected) ? value.selected.length > 0 : typeof value.selected === "string";
  if ("decision" in value) return value.decision === "approve" || value.decision === "reject";
  return false;
}

function lockedSentence(lock: { at: string }, recommended: boolean): string {
  const time = new Date(lock.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `Policy ${recommended ? "applied recommended" : "cancelled"} · ${time}`;
}

function QuestionField(props: {
  question: Question;
  locked?: { at: string };
  lockDeadline?: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { question: q, locked, value, onChange } = props;
  const disabled = locked !== undefined;
  return (
    <fieldset disabled={disabled} className={disabled ? "locked" : undefined}>
      <legend>
        {q.prompt}
        {q.required === false ? " (optional)" : ""}
      </legend>
      {q.detail ? <p className="detail">{q.detail}</p> : null}
      {locked ? <p className="lock-note">{lockedSentence(locked, hasApplyRecommendedLock(q, value))}</p> : null}
      {q.kind === "single" || q.kind === "multi" ? (
        <ChoiceOptions question={q} value={value} onChange={onChange} />
      ) : q.kind === "text" ? (
        <TextAnswer question={q} value={value} onChange={onChange} />
      ) : (
        <ApproveAnswer question={q} value={value} onChange={onChange} />
      )}
    </fieldset>
  );
}

function hasApplyRecommendedLock(_q: Question, value: unknown): boolean {
  return value !== null;
}

function ChoiceOptions({
  question: q,
  value,
  onChange,
}: {
  question: Extract<Question, { kind: "single" | "multi" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const v = (value ?? {}) as { selected?: string | string[]; other?: string };
  const selected = new Set(Array.isArray(v.selected) ? v.selected : v.selected ? [v.selected] : []);
  const other = typeof v.other === "string" ? v.other : null;
  const multi = q.kind === "multi";

  function toggle(id: string) {
    if (!multi) return onChange({ selected: id });
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(other !== null ? { selected: [...next], other } : { selected: [...next] });
  }

  return (
    <>
      {q.options.map((o) => (
        <label key={o.id} className="option">
          <input type={multi ? "checkbox" : "radio"} checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
          <span>
            {o.label}
            {isRecommended(q, o.id) ? <em className="recommended"> recommended</em> : null}
            {o.detail ? <small>{o.detail}</small> : null}
          </span>
        </label>
      ))}
      {q.allow_other ? (
        <label className="option">
          <input
            type={multi ? "checkbox" : "radio"}
            checked={other !== null}
            onChange={() => (multi ? onChange({ selected: [...selected], other: other ?? "" }) : onChange({ other: other ?? "" }))}
          />
          <span>
            Other
            {other !== null ? (
              <input
                type="text"
                aria-label={`Other answer for: ${q.prompt}`}
                value={other}
                onChange={(e) => (multi ? onChange({ selected: [...selected], other: e.target.value }) : onChange({ other: e.target.value }))}
              />
            ) : null}
          </span>
        </label>
      ) : null}
    </>
  );
}

function isRecommended(q: Extract<Question, { kind: "single" | "multi" }>, id: string): boolean {
  return q.kind === "single" ? q.recommended === id : (q.recommended ?? []).includes(id);
}

function TextAnswer({
  question: q,
  value,
  onChange,
}: {
  question: Extract<Question, { kind: "text" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const text = value && typeof value === "object" && "text" in value && typeof value.text === "string" ? value.text : "";
  const common = {
    value: text,
    placeholder: q.placeholder,
    maxLength: q.max_length ?? 10000,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ text: e.target.value }),
  };
  return (
    <>
      {q.recommended ? (
        <p className="recommended-text">
          Suggested: "{q.recommended}"
          <button type="button" onClick={() => onChange({ text: q.recommended! })}>
            Use it
          </button>
        </p>
      ) : null}
      {q.multiline === false ? <input type="text" {...common} /> : <textarea rows={3} {...common} />}
    </>
  );
}

function ApproveAnswer({
  question: q,
  value,
  onChange,
}: {
  question: Extract<Question, { kind: "approve" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const v = (value ?? {}) as { decision?: "approve" | "reject"; edited?: boolean; proposal?: unknown };
  const proposal = q.proposal;
  const editedValue = v.edited && "proposal" in v ? v.proposal : (proposal?.value ?? "");
  return (
    <div className="approve">
      {proposal ? (
        <div className="proposal">
          {proposal.editable ? (
            <textarea
              rows={3}
              value={typeof editedValue === "string" ? editedValue : JSON.stringify(editedValue)}
              onChange={(e) => onChange({ decision: v.decision ?? "approve", edited: true, proposal: e.target.value })}
            />
          ) : (
            <pre>{typeof proposal.value === "string" ? proposal.value : JSON.stringify(proposal.value, null, 2)}</pre>
          )}
          {v.edited ? (
            <p>
              Edited{" "}
              <button type="button" onClick={() => onChange(v.decision ? { decision: v.decision, edited: false } : null)}>
                Reset
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="approve-buttons">
        <button
          type="button"
          aria-pressed={v.decision === "approve"}
          onClick={() => onChange(v.edited ? { decision: "approve", edited: true, proposal: editedValue } : { decision: "approve", edited: false })}
        >
          {q.approve_label ?? "Approve"}
          {q.recommended === "approve" ? <em className="recommended"> recommended</em> : null}
        </button>
        <button
          type="button"
          aria-pressed={v.decision === "reject"}
          onClick={() => onChange({ decision: "reject", edited: false })}
        >
          {q.reject_label ?? "Reject"}
          {q.recommended === "reject" ? <em className="recommended"> recommended</em> : null}
        </button>
      </div>
    </div>
  );
}
