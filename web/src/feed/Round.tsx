import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import type { AdvisorConfig } from "../../../src/config.ts";
import type { FeedRoundView } from "../../../src/hub/engine.ts";
import type { Answer, Question as QuestionDoc } from "../../../src/schema/types.ts";
import { askAdvisor, cancelAdvisor, dismissRound, redirectRound, removeFromFeed, saveDraft, sendRound } from "../api.ts";
import {
  callsignTone,
  countdown,
  draftHasContent,
  draftText,
  elapsed,
  hhmm,
  hhmmss,
  LOCK_SOON_MS,
  nextDeadline,
  OUTCOME_WORDS,
  outcomeSentence,
  policySentence,
  projectLabel,
} from "../format.ts";
import { Icon } from "../icons.tsx";
import { Markdown } from "../markdown.tsx";
import { announce, openRound, useNow } from "../store.ts";
import { Attachment } from "./Attachment.tsx";
import { domId, Question, type SuggestionState } from "./Question.tsx";
import { approveParts, draftValues, isAnswered, sameValue, toSendValue, type Value } from "./values.ts";

const DRAFT_DEBOUNCE_MS = 500;

export type Panel = "dismiss" | "redirect" | "advisor";

/** What the Feed's keys do to one Round (command-center spec: Keys). */
export interface RoundHandle {
  /** `1`–`9`: choose option n in the current Question. */
  choose(n: number): void;
  /** `a` / `r` on the current approve/reject Question. */
  decide(decision: "approve" | "reject"): void;
  openNotes(): void;
  openPanel(panel: Panel): void;
  send(): void;
}

export function copy(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(
    () => announce(`${what} copied`),
    () => announce(`Could not copy the ${what.toLowerCase()}`),
  );
}

export function Callsign({ name }: { name: string }) {
  return (
    <span className="hh-callsign" data-agent={callsignTone(name)} title={name}>
      <span className="hh-callsign-mark" aria-hidden="true"></span>
      <span className="hh-callsign-text">{name}</span>
    </span>
  );
}

function linkLabel(url: string, label?: string): string {
  try {
    const host = new URL(url).host;
    return label ? `${label} (${host})` : url;
  } catch {
    return label ?? url;
  }
}

/** The Round head: callsign, project, status badges, title, context, policy sentence, links. */
function RoundHead({ view, now }: { view: FeedRoundView; now: number }) {
  const { round } = view;
  const pending = view.status === "pending";
  const lockedCount = Object.keys(view.locks).length;
  const next = nextDeadline(view);
  const left = next === null ? null : next - now;
  const lockSoon = pending && left !== null && left < LOCK_SOON_MS;
  const lastLock = Object.entries(view.locks).sort((a, b) => b[1].locked_at.localeCompare(a[1].locked_at))[0];
  const titleId = `${view.id}-h`;
  return (
    <div className="hh-round-head">
      <div className="hh-row">
        <Callsign name={view.session.callsign} />
        <span className="hh-mono-sm">
          {projectLabel(view.session.project)}
          {view.session.branch ? ` · ${view.session.branch}` : ""}
        </span>
        {!pending ? (
          <span className="hh-badge" data-tone="expired">
            {OUTCOME_WORDS[view.status as Answer["outcome"]]}
          </span>
        ) : null}
        {pending && lockedCount > 0 ? (
          <span className="hh-badge" data-tone="warning">
            <Icon name="lock" /> {lockedCount} of {round.questions.length} locked · Round stays pending
          </span>
        ) : null}
        {lockSoon ? (
          <span className="hh-badge" data-tone="warning">
            <Icon name="clock" /> Lock soon · {countdown(left!)} to next Lock
          </span>
        ) : null}
        {round.supersedes ? (
          <span className="hh-badge" data-tone="info">
            <Icon name="refresh" /> Replaces {round.supersedes}
          </span>
        ) : null}
        {pending && round.supersedes && draftHasContent(view.draft) ? (
          <span className="hh-badge">
            <Icon name="check" /> Draft carried over
          </span>
        ) : null}
      </div>
      <h2 className="hh-strip-header" id={titleId} tabIndex={-1}>
        {round.title}
      </h2>
      {round.context ? <Markdown className="hh-body hh-measure" text={round.context} /> : null}
      <div className="hh-policy-badge">
        <span className="hh-badge">
          <Icon name="clock" /> Policy
        </span>{" "}
        <span className="hh-body-sm">
          {lastLock
            ? `Q${round.questions.findIndex((q) => q.id === lastLock[0]) + 1} ${lastLock[1].value === null ? "cancelled" : "applied recommended"} at ${hhmmss(lastLock[1].locked_at)}`
            : policySentence(view)}
        </span>{" "}
        {pending && left !== null ? <span className="hh-mono-sm">Next Lock in {countdown(left)}</span> : null}
      </div>
      {round.links?.length ? (
        <p className="hh-row">
          {round.links.map((l) => (
            <a key={l.url} className="hh-link" href={l.url} target="_blank" rel="noreferrer">
              {linkLabel(l.url, l.label)}
              <span className="hh-visually-hidden"> opens in a new tab</span>
            </a>
          ))}
        </p>
      ) : null}
      {round.attachments?.map((a, i) => <Attachment key={i} attachment={a} />)}
    </div>
  );
}

/** The strip holder around a Round: status tab, paper, and the policy timer rail. */
export function RoundStrip({
  view,
  as: Tag = "li",
  className = "pv-feed-item",
  children,
}: {
  view: FeedRoundView;
  as?: "li" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  const now = useNow();
  const pending = view.status === "pending";
  const next = nextDeadline(view);
  let fraction = 1;
  if (pending && next !== null) {
    const total = next - Date.parse(view.received_at);
    fraction = total > 0 ? Math.max(0, Math.min(1, (next - now) / total)) : 0;
  }
  const policy = view.round.policy?.on_timeout ?? "wait";
  return (
    <Tag className={`hh-strip ${className}`} id={view.id} data-status={pending ? "pending" : view.status === "answered" ? "answered" : "expired"}>
      <div className="hh-strip-tab">
        <span>{pending ? "Pending" : OUTCOME_WORDS[view.status as Answer["outcome"]]}</span>
        <span className="hh-mono-sm">
          {view.id} · received {hhmm(view.received_at)}
        </span>
      </div>
      <div className="hh-strip-paper">{children}</div>
      {pending ? (
        <span
          className="hh-policy-timer"
          aria-hidden="true"
          data-policy={next === null ? "wait" : policy === "cancel" ? "cancel" : "apply-recommended"}
          style={{ "--timer-fraction": String(fraction) } as React.CSSProperties}
        >
          <span className="hh-policy-timer-fill"></span>
        </span>
      ) : null}
    </Tag>
  );
}

/** Ask advisor / "Advisor working · m:ss" / Suggestion ready / unparsed briefing (delegation spec). */
function AdvisorRow({ view, now }: { view: FeedRoundView; now: number }) {
  const run = view.advisor_runs[0];
  const [busy, setBusy] = useState(false);
  if (!run) return null;
  if (run.status === "running") {
    return (
      <li className="pv-advisor-row">
        <div className="hh-alert pv-advisor" data-tone="info" role="status">
          <span className="hh-badge" data-tone="info">
            Advisor
          </span>
          <strong>
            <span className="hh-spinner" aria-hidden="true"></span> Advisor working · <span className="hh-mono">{elapsed(now - Date.parse(run.started_at))}</span>
          </strong>
          <div className="hh-body-sm">
            <span className="hh-mono">{run.advisor_name}</span> was asked by {run.trigger === "auto" ? "an Auto-ask rule" : "you"} at {hhmmss(run.started_at)}.
            Deadlines keep running. It fills empty Questions when it returns.
          </div>
          <div className="hh-row">
            <button
              type="button"
              className="hh-button"
              data-size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void cancelAdvisor(view.id)
                  .catch((err: unknown) => announce(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false));
              }}
            >
              <Icon name="x" /> Cancel run
            </button>
          </div>
        </div>
      </li>
    );
  }
  const took = run.ended_at ? Math.round((Date.parse(run.ended_at) - Date.parse(run.started_at)) / 1000) : 0;
  if (run.status === "succeeded" && run.suggestion) {
    return (
      <li className="pv-advisor-row">
        <div className="hh-alert pv-advisor" data-tone="info" role="status">
          <span className="hh-badge" data-tone="info">
            Suggestion
          </span>
          <strong>
            Suggestion ready · <span className="hh-mono">{run.advisor_name}</span> · {took} s
          </strong>
          <div className="hh-body-sm">
            {run.suggestion.summary ? `${run.suggestion.summary} ` : ""}Empty Questions are filled and marked; answers you already set show what the
            Advisor would change.{" "}
            <a className="hh-link" href={`/rounds/${view.id}`}>
              Open run history
            </a>
          </div>
        </div>
      </li>
    );
  }
  if (run.status === "failed") {
    return (
      <li className="pv-advisor-row">
        <div className="hh-alert pv-advisor" data-tone="warning" role="status">
          <span className="hh-badge" data-tone="warning">
            <Icon name="alert" /> Unparsed
          </span>
          <strong>
            Advisor reply could not be read · <span className="hh-mono">{run.advisor_name}</span>
          </strong>
          <div className="hh-body-sm">The reply had no hermes.suggestion/v1 JSON object, so no answers were filled. It is shown as a plain briefing.</div>
          {run.raw_output ? (
            <figure className="hh-attachment pv-briefing">
              <figcaption className="hh-attachment-head">
                <span className="hh-badge">
                  <Icon name="file" /> Briefing
                </span>
                <span className="hh-attachment-title hh-mono">{run.advisor_name} · unparsed output</span>
                <span className="hh-mono-sm">
                  {run.raw_output.split("\n").length} lines · {took} s
                </span>
              </figcaption>
              <pre className="hh-attachment-body" tabIndex={0} aria-label={`Unparsed briefing from ${run.advisor_name}`}>
                <code>{run.raw_output}</code>
              </pre>
            </figure>
          ) : null}
        </div>
      </li>
    );
  }
  if (run.status === "timed_out") {
    return (
      <li className="pv-advisor-row">
        <div className="hh-alert pv-advisor" data-tone="warning" role="status">
          <span className="hh-badge" data-tone="warning">
            <Icon name="clock" /> Timed out
          </span>
          <strong>
            <span className="hh-mono">{run.advisor_name}</span> timed out after {took} s
          </strong>
          <div className="hh-body-sm">No Suggestion. Deadlines kept running.</div>
        </div>
      </li>
    );
  }
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A Pending Round, fully expanded and answerable in place. */
export function PendingRound({
  view,
  advisors,
  inView,
  offline,
  onDone,
  handle,
  as,
  className,
}: {
  view: FeedRoundView;
  advisors: AdvisorConfig[];
  inView: boolean;
  offline: boolean;
  /** Called after Send, Dismiss or Redirect succeeded (the Feed advances). */
  onDone?: (id: string) => void;
  handle?: Ref<RoundHandle>;
  as?: "li" | "div";
  className?: string;
}) {
  const { round, locks } = view;
  const now = useNow();
  const [values, setValues] = useState<Record<string, Value>>(() => draftValues(view.draft));
  const [note, setNote] = useState(view.draft?.note ?? "");
  const [notesOpen, setNotesOpen] = useState(Boolean(view.draft?.note));
  const [redirectMessage, setRedirectMessage] = useState(view.draft?.message ?? "");
  const [redirectInvalid, setRedirectInvalid] = useState(false);
  const [dismissNote, setDismissNote] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [advisor, setAdvisor] = useState("");
  const [brief, setBrief] = useState("");
  const [focusedQ, setFocusedQ] = useState<string | null>(null);
  const suggestion = view.suggestion;
  // Questions holding the Suggestion's value untouched; and ones the Human changed after it filled them.
  const [filled, setFilled] = useState<Set<string>>(
    () =>
      new Set(
        Object.entries(view.suggestion?.questions ?? {})
          .filter(([qid, s]) => sameValue(draftValues(view.draft)[qid], s.value))
          .map(([qid]) => qid),
      ),
  );
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mergedRunRef = useRef<string | undefined>(view.suggestion?.run_id);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Once a run ends with a valid Suggestion, fill still-empty, open Questions (delegation spec).
  const latestRun = view.advisor_runs[0];
  useEffect(() => {
    if (!latestRun || latestRun.status === "running" || !latestRun.suggestion) return;
    if (mergedRunRef.current === latestRun.id) return;
    mergedRunRef.current = latestRun.id;
    const fills = new Set<string>();
    setValues((prev) => {
      const next = { ...prev };
      for (const [qid, s] of Object.entries(latestRun.suggestion!.questions)) {
        if (locks[qid] || isAnswered(next[qid])) continue;
        next[qid] = s.value;
        fills.add(qid);
      }
      return fills.size ? next : prev;
    });
    if (fills.size) setFilled((prev) => new Set([...prev, ...fills]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun?.id, latestRun?.status]);

  function scheduleDraftSave(nextValues: Record<string, Value>, nextNote: string, nextMessage: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const questions = Object.fromEntries(Object.entries(nextValues).map(([id, value]) => [id, { value }]));
      void saveDraft(view.id, { questions, ...(nextNote ? { note: nextNote } : {}), ...(nextMessage ? { message: nextMessage } : {}) }).catch(() => {});
    }, DRAFT_DEBOUNCE_MS);
  }

  function setValue(qid: string, value: Value) {
    const next = { ...values, [qid]: value };
    setValues(next);
    if (filled.has(qid)) {
      setFilled((prev) => new Set([...prev].filter((x) => x !== qid)));
      if (suggestion?.questions[qid] && !sameValue(value, suggestion.questions[qid]!.value)) setChanged((prev) => new Set([...prev, qid]));
    } else if (changed.has(qid) && suggestion?.questions[qid] && sameValue(value, suggestion.questions[qid]!.value)) {
      setChanged((prev) => new Set([...prev].filter((x) => x !== qid)));
      setFilled((prev) => new Set([...prev, qid]));
    }
    scheduleDraftSave(next, note, redirectMessage);
  }

  const openQuestions = round.questions.filter((q) => !locks[q.id]);
  const required = openQuestions.filter((q) => q.required !== false);
  const requiredDone = required.filter((q) => isAnswered(values[q.id])).length;

  /** The current Question: the focused one, else the first open, unanswered one (command-center spec). */
  function currentQuestion(): QuestionDoc | undefined {
    const focused = openQuestions.find((q) => q.id === focusedQ);
    return focused ?? openQuestions.find((q) => !isAnswered(values[q.id]));
  }
  const current = inView || focusedQ ? currentQuestion() : undefined;

  function focusNextUnanswered(after: string, nextValues: Record<string, Value>) {
    const start = openQuestions.findIndex((q) => q.id === after);
    const next = openQuestions.slice(start + 1).find((q) => !isAnswered(nextValues[q.id]));
    if (!next) return;
    const li = document.getElementById(domId(view, next));
    li?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled])")?.focus();
  }

  function focusQuestionInput(q: QuestionDoc, selector = "input:checked, input, textarea") {
    document.getElementById(domId(view, q))?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  async function act(fn: () => Promise<void>, what: string) {
    if (offline) {
      setError("Offline: cannot send until the Hub is reachable. Your Answers stay here.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      clearTimeout(debounceRef.current);
      await fn();
      announce(`${what}: ${round.title}`);
      onDone?.(view.id);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  function send() {
    const missing = required.filter((q) => !isAnswered(values[q.id]));
    if (missing.length) {
      const names = missing.map((q) => `Q${round.questions.indexOf(q) + 1}`).join(", ");
      setError(`Answer ${names} before sending.`);
      focusQuestionInput(missing[0]!, "input, textarea");
      return;
    }
    const questions: Record<string, { value: unknown }> = {};
    for (const q of openQuestions) {
      const value = toSendValue(q, values[q.id]);
      if (value instanceof Error) {
        setError(`Q${round.questions.indexOf(q) + 1}: ${value.message}.`);
        return;
      }
      questions[q.id] = { value };
    }
    void act(() => sendRound(view.id, { ...(note.trim() ? { note } : {}), questions }), "Answer sent");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send();
  }

  function openPanel(next: Panel) {
    setPanel(next);
    // The panel renders on the next frame; focus its first field.
    requestAnimationFrame(() => document.getElementById(`${view.id}-${next}`)?.querySelector<HTMLElement>("textarea, input")?.focus());
  }

  /** Closes the open panel and returns focus to the action-bar button that opened it. */
  function closePanel() {
    const was = panel;
    setPanel(null);
    if (was) requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`button[aria-controls="${view.id}-${was}"]`)?.focus({ preventScroll: true }));
  }

  useImperativeHandle(handle, () => ({
    choose(n) {
      const q = currentQuestion();
      if (!q) return;
      let value: Value | undefined;
      if (q.kind === "single" || q.kind === "multi") {
        const option = q.options[n - 1];
        if (option) {
          if (q.kind === "single") value = { selected: option.id };
          else {
            const v = (values[q.id] ?? {}) as { selected?: string[]; other?: string };
            const sel = new Set(v.selected ?? []);
            if (sel.has(option.id)) sel.delete(option.id);
            else sel.add(option.id);
            value = v.other !== undefined ? { selected: [...sel], other: v.other } : { selected: [...sel] };
          }
        } else if (q.allow_other && n === q.options.length + 1) {
          setValue(q.id, q.kind === "multi" ? { ...((values[q.id] as object) ?? { selected: [] }), other: "" } : { other: "" });
          requestAnimationFrame(() => focusQuestionInput(q, 'input[type="text"]'));
          return;
        }
      } else if (q.kind === "approve" && (n === 1 || n === 2)) {
        const parts = approveParts(values[q.id]);
        const decision = n === 1 ? "approve" : "reject";
        value = parts.edited ? { decision, edited: true, proposal: parts.proposal } : { decision, edited: false };
      }
      if (value === undefined) return;
      const next = { ...values, [q.id]: value };
      setValue(q.id, value);
      // Choosing a value moves on to the next unanswered Question; a multi choice stays for more.
      if (q.kind !== "multi") requestAnimationFrame(() => focusNextUnanswered(q.id, next));
      else requestAnimationFrame(() => focusQuestionInput(q, `input[value="${q.options[n - 1]!.id}"]`));
    },
    decide(decision) {
      const q = currentQuestion();
      if (q?.kind !== "approve") return;
      const parts = approveParts(values[q.id]);
      const value = parts.edited ? { decision, edited: true, proposal: parts.proposal } : { decision, edited: false };
      const next = { ...values, [q.id]: value };
      setValue(q.id, value);
      requestAnimationFrame(() => focusNextUnanswered(q.id, next));
    },
    openNotes() {
      setNotesOpen(true);
      requestAnimationFrame(() => document.getElementById(`${view.id}-notes`)?.focus());
    },
    openPanel,
    send,
  }));

  const titleId = `${view.id}-h`;
  const callsign = view.session.callsign;
  return (
    <RoundStrip view={view} as={as} className={className}>
      <form
        ref={formRef}
        className="hh-round"
        aria-labelledby={titleId}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          send();
        }}
        onFocus={(e) => {
          const li = (e.target as HTMLElement).closest<HTMLElement>(".hh-question");
          const q = li ? round.questions.find((x) => domId(view, x) === li.id) : undefined;
          setFocusedQ(q ? q.id : null);
        }}
        onBlur={(e) => {
          if (!formRef.current?.contains(e.relatedTarget as Node | null)) setFocusedQ(null);
        }}
      >
        <RoundHead view={view} now={now} />
        <ol className="hh-round-questions">
          <AdvisorRow view={view} now={now} />
          {round.questions.map((q, i) => {
            const lock = locks[q.id];
            const s = suggestion?.questions[q.id];
            let state: SuggestionState = null;
            if (s && !lock) {
              if (filled.has(q.id)) state = "filled";
              else if (changed.has(q.id)) state = "changed";
              else if (isAnswered(values[q.id]) && !sameValue(values[q.id], s.value)) state = "offer";
            }
            return (
              <Question
                key={q.id}
                view={view}
                question={q}
                index={i}
                mode={lock ? "locked" : "open"}
                value={lock ? lock.value : values[q.id]}
                draftValue={lock ? values[q.id] : undefined}
                onChange={(v) => setValue(q.id, v)}
                current={current?.id === q.id}
                suggestion={s && suggestion ? { advisor: suggestion.advisor, value: s.value, ...(s.rationale ? { rationale: s.rationale } : {}) } : undefined}
                suggestionState={state}
                onAcceptSuggestion={() => s && setValue(q.id, s.value)}
                onCopyDraft={() => copy(draftText(view), "Draft")}
                now={now}
              />
            );
          })}
        </ol>
        <details className="hh-notes" open={notesOpen} onToggle={(e) => setNotesOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="hh-notes-summary">
            Add notes for {callsign} (optional){" "}
            <kbd className="hh-kbd" aria-hidden="true">
              N
            </kbd>
          </summary>
          <label className="hh-visually-hidden" htmlFor={`${view.id}-notes`}>
            Notes for {callsign}
          </label>
          <textarea
            id={`${view.id}-notes`}
            className="hh-textarea"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              scheduleDraftSave(values, e.target.value, redirectMessage);
            }}
          />
        </details>

        {panel === "dismiss" ? (
          <section className="hh-panel pv-inline-panel hh-stack" id={`${view.id}-dismiss`} aria-labelledby={`${view.id}-dismiss-h`}>
            <h3 className="hh-heading-md" id={`${view.id}-dismiss-h`}>
              Dismiss this Round
            </h3>
            <p className="hh-body-sm hh-measure">
              {callsign} gets Outcome <strong>dismissed</strong> and no answers. Questions a policy already locked keep their policy values.
            </p>
            <div className="hh-field">
              <label className="hh-label" htmlFor={`${view.id}-dismiss-note`}>
                Note for {callsign} (optional)
              </label>
              <textarea
                id={`${view.id}-dismiss-note`}
                className="hh-textarea"
                placeholder="For example: not needed, the flag was removed on main."
                value={dismissNote}
                onChange={(e) => setDismissNote(e.target.value)}
              />
            </div>
            <div className="hh-row">
              <button
                type="button"
                className="hh-button"
                data-variant="destructive"
                disabled={busy}
                onClick={() => void act(() => dismissRound(view.id, dismissNote.trim() ? { note: dismissNote } : {}), "Round dismissed")}
              >
                <Icon name="x" /> Dismiss Round
              </button>
              <button type="button" className="hh-button" data-variant="ghost" onClick={closePanel}>
                Keep answering
              </button>
            </div>
          </section>
        ) : null}

        {panel === "redirect" ? (
          <section className="hh-panel pv-inline-panel hh-stack" id={`${view.id}-redirect`} aria-labelledby={`${view.id}-redirect-h`}>
            <h3 className="hh-heading-md" id={`${view.id}-redirect-h`}>
              Redirect {callsign}
            </h3>
            <p className="hh-body-sm hh-measure">
              Ends the Round with Outcome <strong>redirected</strong>. {callsign} receives your message instead of answers.
            </p>
            <div className="hh-field">
              <label className="hh-label" htmlFor={`${view.id}-redirect-msg`}>
                Do this instead (required)
              </label>
              <textarea
                id={`${view.id}-redirect-msg`}
                className="hh-textarea"
                placeholder="For example: keep both flags, remove only legacy_nav."
                value={redirectMessage}
                aria-invalid={redirectInvalid || undefined}
                aria-describedby={redirectInvalid ? `${view.id}-redirect-err` : undefined}
                onChange={(e) => {
                  setRedirectMessage(e.target.value);
                  if (e.target.value.trim()) setRedirectInvalid(false);
                  scheduleDraftSave(values, note, e.target.value);
                }}
              />
              {redirectInvalid ? (
                <p className="hh-error" id={`${view.id}-redirect-err`} role="alert">
                  <span className="hh-badge" data-tone="destructive">
                    Error
                  </span>{" "}
                  Say what {callsign} should do instead.
                </p>
              ) : null}
            </div>
            <div className="hh-row">
              <button
                type="button"
                className="hh-button"
                data-variant="primary"
                disabled={busy}
                onClick={() => {
                  if (!redirectMessage.trim()) {
                    setRedirectInvalid(true);
                    document.getElementById(`${view.id}-redirect-msg`)?.focus();
                    return;
                  }
                  void act(() => redirectRound(view.id, { message: redirectMessage, ...(note.trim() ? { note } : {}) }), "Round redirected");
                }}
              >
                <Icon name="arrow-right" /> Send redirect
              </button>
              <button type="button" className="hh-button" data-variant="ghost" onClick={closePanel}>
                Keep answering
              </button>
            </div>
          </section>
        ) : null}

        {panel === "advisor" ? (
          <section className="hh-panel pv-inline-panel hh-stack" id={`${view.id}-advisor`} aria-labelledby={`${view.id}-advisor-h`}>
            <h3 className="hh-heading-md" id={`${view.id}-advisor-h`}>
              Ask advisor
            </h3>
            <p className="hh-body-sm hh-measure">An Advisor reads this Round and suggests answers. It never sends: you do. Deadlines keep running while it works.</p>
            {advisors.length === 0 ? (
              <p className="hh-body-sm hh-measure">
                No Advisors are configured. Add an <span className="hh-mono-sm">[[advisor]]</span> table to config.toml; Settings shows what is loaded.
              </p>
            ) : (
              <>
                <fieldset className="hh-field">
                  <legend className="hh-label">Advisor</legend>
                  {advisors.map((a, i) => (
                    <label key={a.name} className="hh-radio">
                      <input
                        type="radio"
                        name={`${view.id}-advisor-pick`}
                        value={a.name}
                        checked={(advisor || advisors[0]!.name) === a.name}
                        onChange={() => setAdvisor(a.name)}
                      />{" "}
                      <span>
                        <span className="hh-mono">{a.name}</span> <span className="hh-body-sm">· {a.timeout_seconds} s timeout</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="hh-field">
                  <label className="hh-label" htmlFor={`${view.id}-brief`}>
                    Brief (optional)
                  </label>
                  <textarea
                    id={`${view.id}-brief`}
                    className="hh-textarea"
                    aria-describedby={`${view.id}-brief-hint`}
                    placeholder="What should the Advisor look at?"
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                  />
                  <p className="hh-hint" id={`${view.id}-brief-hint`}>
                    Goes to the Advisor only, never to {callsign}.
                  </p>
                </div>
              </>
            )}
            <div className="hh-row">
              {advisors.length > 0 ? (
                <button
                  type="button"
                  className="hh-button"
                  data-variant="primary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    askAdvisor(view.id, { advisor: advisor || advisors[0]!.name, ...(brief.trim() ? { brief } : {}) })
                      .then(() => {
                        closePanel();
                        setBrief("");
                      })
                      .catch((err: unknown) => setError(errorText(err)))
                      .finally(() => setBusy(false));
                  }}
                >
                  <Icon name="send" /> Start advisor run
                </button>
              ) : null}
              <button type="button" className="hh-button" data-variant="ghost" onClick={closePanel}>
                Close
              </button>
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="hh-error pv-round-error" role="alert">
            <span className="hh-badge" data-tone={offline ? "expired" : "destructive"}>
              {offline ? "Offline" : "Error"}
            </span>{" "}
            {error}
          </p>
        ) : null}

        <div className="hh-answer-bar pv-action-bar">
          <div className="hh-answer-bar-row">
            <span className="hh-answer-progress">
              <span className="hh-mono-sm">
                {requiredDone} of {required.length} required answered
              </span>
            </span>
            <span className="hh-row">
              {(
                [
                  ["advisor", view.advisor_runs.length ? "Ask advisor again" : "Ask advisor", "v"],
                  ["redirect", "Redirect", "e"],
                  ["dismiss", "Dismiss", "d"],
                ] as const
              ).map(([p, label, key]) => (
                <button
                  key={p}
                  type="button"
                  className="hh-button"
                  aria-expanded={panel === p}
                  aria-controls={`${view.id}-${p}`}
                  aria-keyshortcuts={key}
                  onClick={() => (panel === p ? closePanel() : openPanel(p))}
                >
                  {label}{" "}
                  <kbd className="hh-kbd" aria-hidden="true">
                    {key}
                  </kbd>
                </button>
              ))}
              <button
                type="submit"
                className="hh-button"
                data-variant="primary"
                aria-keyshortcuts="Meta+Enter Control+Enter"
                aria-disabled={offline || busy || undefined}
              >
                <Icon name="send" /> Send Answer{" "}
                <kbd className="hh-kbd" aria-hidden="true">
                  ⌘↵
                </kbd>
                <span className="hh-visually-hidden">Command Enter</span>
              </button>
            </span>
          </div>
        </div>
      </form>
    </RoundStrip>
  );
}

/** A Round that ended in place (expired, superseded, cancelled): read-only until the Human removes it. */
export function EndedRound({ view, as, className }: { view: FeedRoundView; as?: "li" | "div"; className?: string }) {
  const now = useNow();
  const [removing, setRemoving] = useState(false);
  const answer = view.answer as Answer;
  const { headline, body } = outcomeSentence(view);
  const draft = draftValues(view.draft);
  const hasDraft = draftHasContent(view.draft);
  const callsign = view.session.callsign;
  return (
    <RoundStrip view={view} as={as} className={className}>
      <form className="hh-round" aria-labelledby={`${view.id}-h`} data-state="ended" onSubmit={(e) => e.preventDefault()}>
        <RoundHead view={view} now={now} />
        <ol className="hh-round-questions">
          {view.round.questions.map((q, i) => {
            const lock = view.locks[q.id];
            const value = lock ? lock.value : draft[q.id];
            return (
              <Question
                key={q.id}
                view={view}
                question={q}
                index={i}
                mode="ended"
                value={value}
                endedState={lock ? "Locked · read-only" : isAnswered(draft[q.id]) ? "Draft · not sent" : "Not answered"}
                now={now}
              />
            );
          })}
        </ol>
        {view.draft?.note ? (
          <details className="hh-notes">
            <summary className="hh-notes-summary">Notes for {callsign} (not sent)</summary>
            <label className="hh-visually-hidden" htmlFor={`${view.id}-notes`}>
              Notes for {callsign}
            </label>
            <textarea id={`${view.id}-notes`} className="hh-textarea" readOnly value={view.draft.note} />
          </details>
        ) : null}
        <div className="hh-answer-bar pv-ended-bar">
          <div className="hh-alert" data-tone="warning" role="status">
            <span className="hh-badge" data-tone="expired">
              {hasDraft ? "Not sent" : OUTCOME_WORDS[answer.outcome]}
            </span>
            <strong>{headline}</strong>
            <div className="hh-body-sm">
              {body}{" "}
              {answer.superseded_by ? (
                <a
                  className="hh-link"
                  href={`/rounds/${answer.superseded_by}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    openRound(answer.superseded_by!);
                  }}
                >
                  Open {answer.superseded_by}
                </a>
              ) : null}
            </div>
          </div>
          <div className="hh-answer-bar-row">
            <span className="hh-row">
              {hasDraft ? (
                <button type="button" className="hh-button" onClick={() => copy(draftText(view), "Draft")}>
                  <Icon name="file" /> Copy draft
                </button>
              ) : null}
            </span>
            <span className="hh-row">
              <button
                type="button"
                className="hh-button"
                data-variant="destructive"
                aria-label={`Remove from feed ${view.id}`}
                disabled={removing}
                onClick={() => {
                  setRemoving(true);
                  removeFromFeed(view.id)
                    .then(() => announce(`Removed ${view.round.title} from the Feed`))
                    .catch((err: unknown) => {
                      setRemoving(false);
                      announce(errorText(err));
                    });
                }}
              >
                <Icon name="x" /> Remove from feed
              </button>
            </span>
          </div>
        </div>
      </form>
    </RoundStrip>
  );
}
