import { useState, type FormEvent } from "react";
import type { PendingRoundView } from "../../../src/hub/engine.ts";
import type { QuestionValue, SingleQuestion } from "../../../src/schema/types.ts";
import { sendRound } from "../api.ts";
import { useStore } from "../store.ts";

/** Bare functional Feed (walking skeleton); the designed Feed replaces it in S4. */
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

function isComplete(value: QuestionValue | undefined): boolean {
  return value != null && !("other" in value && !value.other?.trim());
}

function RoundCard({ view }: { view: PendingRoundView }) {
  const { round, session } = view;
  const [values, setValues] = useState<Record<string, QuestionValue>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ready = round.questions.every((q) => q.required === false || isComplete(values[q.id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await sendRound(view.id, {
        ...(note.trim() ? { note } : {}),
        questions: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }])),
      });
      // The card leaves the Feed when the round.ended event arrives.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSending(false);
    }
  }

  const titleId = `round-${view.id}-title`;
  return (
    <form className="round" id={`round-${view.id}`} aria-labelledby={titleId} onSubmit={submit}>
      <h2 id={titleId}>{round.title}</h2>
      <p className="meta">
        {session.callsign} · {new Date(view.received_at).toLocaleTimeString()}
      </p>
      {round.context ? <p className="context">{round.context}</p> : null}
      {round.questions.map((q) =>
        q.kind === "single" ? (
          <SingleChoice
            key={q.id}
            roundId={view.id}
            question={q}
            value={values[q.id]}
            onChange={(value) => setValues((prev) => ({ ...prev, [q.id]: value }))}
          />
        ) : null,
      )}
      <label className="note">
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={!ready || sending}>
        Send
      </button>
    </form>
  );
}

function SingleChoice(props: {
  roundId: string;
  question: SingleQuestion;
  value: QuestionValue | undefined;
  onChange: (value: QuestionValue) => void;
}) {
  const { roundId, question: q, value, onChange } = props;
  const name = `${roundId}:${q.id}`;
  const other = value && "other" in value ? value.other : null;
  return (
    <fieldset>
      <legend>
        {q.prompt}
        {q.required === false ? " (optional)" : ""}
      </legend>
      {q.options.map((o) => (
        <label key={o.id} className="option">
          <input
            type="radio"
            name={name}
            value={o.id}
            checked={value != null && "selected" in value && value.selected === o.id}
            onChange={() => onChange({ selected: o.id })}
          />
          <span>
            {o.label}
            {q.recommended === o.id ? <em className="recommended"> recommended</em> : null}
            {o.detail ? <small>{o.detail}</small> : null}
          </span>
        </label>
      ))}
      {q.allow_other ? (
        <label className="option">
          <input type="radio" name={name} checked={other !== null} onChange={() => onChange({ other: other ?? "" })} />
          <span>
            Other
            {other !== null ? (
              <input
                type="text"
                aria-label={`Other answer for: ${q.prompt}`}
                value={other}
                onChange={(e) => onChange({ other: e.target.value })}
              />
            ) : null}
          </span>
        </label>
      ) : null}
    </fieldset>
  );
}
