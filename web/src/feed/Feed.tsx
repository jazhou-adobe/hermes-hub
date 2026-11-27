import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FeedRoundView } from "../../../src/hub/engine.ts";
import type { Answer } from "../../../src/schema/types.ts";
import { countdown, hhmm, LOCK_SOON_MS, nextDeadline, OUTCOME_WORDS, plural, projectLabel } from "../format.ts";
import { Icon } from "../icons.tsx";
import { clearJump, reconnectNow, useNow, useStore } from "../store.ts";
import { isTextField, KeyList } from "../keys.tsx";
import { Callsign, EndedRound, PendingRound, type RoundHandle } from "./Round.tsx";
import { Standby } from "./Standby.tsx";

interface Filters {
  callsigns: Set<string>;
  projects: Set<string>;
}

/** Scrolls a Round into view and focuses its heading. */
function focusRound(id: string): void {
  const li = document.getElementById(id);
  if (!li) return;
  li.scrollIntoView({ block: "start" });
  li.querySelector<HTMLElement>(".hh-strip-header")?.focus({ preventScroll: true });
}

/** The Round in view: the first one crossing a band near the top of the viewport (preview.js). */
function useInView(ids: string[], listRef: RefObject<HTMLOListElement | null>): [string | null, (id: string) => void] {
  const [inView, setInView] = useState<string | null>(null);
  const visible = useRef(new Set<string>());
  const observer = useRef<IntersectionObserver | null>(null);
  const order = useRef(ids);
  order.current = ids;

  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? visible.current.add(e.target.id) : visible.current.delete(e.target.id));
        const first = order.current.find((id) => visible.current.has(id));
        if (first) setInView(first);
      },
      { rootMargin: "-30% 0px -65% 0px" },
    );
    return () => observer.current?.disconnect();
  }, []);

  const key = ids.join(" ");
  useEffect(() => {
    const o = observer.current;
    if (!o || !listRef.current) return;
    const items = [...listRef.current.querySelectorAll<HTMLElement>(":scope > .hh-feed-item")];
    for (const item of items) o.observe(item);
    return () => {
      for (const item of items) o.unobserve(item);
    };
  }, [key, listRef]);

  const current = inView && ids.includes(inView) ? inView : (ids[0] ?? null);
  return [current, setInView];
}

function IndexEntry({ view, inView, offline, now }: { view: FeedRoundView; inView: boolean; offline: boolean; now: number }) {
  const pending = view.status === "pending";
  const next = nextDeadline(view);
  const left = next === null ? null : next - now;
  const locked = Object.keys(view.locks).length;
  const answer = view.answer as Answer | null;
  return (
    <li className="hh-feed-index-item">
      <a
        className="hh-feed-index-link"
        href={`#${view.id}`}
        aria-current={inView ? "location" : undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          focusRound(view.id);
        }}
      >
        <Callsign name={view.session.callsign} />
        <span className="hh-feed-index-title">{view.round.title}</span>
        <span className="hh-feed-index-meta">
          {pending ? (
            <span className="hh-mono-sm">
              {left === null ? "No deadline · keeps waiting" : `${countdown(left)} to next Lock`}
              {offline ? " (estimated) · Stale" : ""}
            </span>
          ) : (
            <>
              <span className="hh-badge" data-tone="expired">
                {OUTCOME_WORDS[view.status as Answer["outcome"]]}
              </span>{" "}
              <span className="hh-mono-sm">
                {answer?.superseded_by
                  ? `Replaced by ${answer.superseded_by}`
                  : answer?.cancelled_by === "human"
                    ? `Cancelled by Forget · ${hhmm(answer.decided_at)}`
                    : answer
                      ? `${OUTCOME_WORDS[answer.outcome]} ${hhmm(answer.decided_at)}`
                      : ""}
              </span>
            </>
          )}
          {pending && locked > 0 ? (
            <span className="hh-badge">
              <Icon name="lock" /> {locked} of {view.round.questions.length} locked
            </span>
          ) : null}
          {pending && view.round.supersedes ? (
            <span className="hh-badge" data-tone="info">
              <Icon name="refresh" /> Replaces {view.round.supersedes}
            </span>
          ) : null}
          {pending && left !== null && left < LOCK_SOON_MS ? (
            <span className="hh-badge" data-tone="warning">
              <Icon name="clock" /> Lock soon
            </span>
          ) : null}
          <span className="hh-feed-index-inview">
            <Icon name="chevron-right" /> In view
          </span>
        </span>
      </a>
    </li>
  );
}

function ConnectionAlert() {
  const connection = useStore((s) => s.connection);
  const retryIn = useStore((s) => s.retryIn);
  const lastUpdate = useStore((s) => s.lastUpdate);
  if (connection === "reconnecting") {
    return (
      <div className="hh-alert" data-tone="warning" role="status">
        <span className="hh-badge" data-tone="warning">
          <Icon name="refresh" /> Reconnecting
        </span>
        <strong>The Feed may be out of date</strong>
        <div className="hh-body-sm">
          {retryIn !== null ? `Retry in ${retryIn} s. ` : ""}Rounds stay on screen and Send is still attempted.{" "}
          <button type="button" className="hh-button" data-size="sm" onClick={reconnectNow}>
            <Icon name="refresh" /> Reconnect now
          </button>
        </div>
      </div>
    );
  }
  if (connection === "offline") {
    return (
      <div className="hh-alert" data-tone="destructive" role="alert">
        <span className="hh-badge" data-tone="destructive">
          <Icon name="x" /> Offline
        </span>
        <strong>Answers cannot be sent</strong>
        <div className="hh-body-sm">
          {lastUpdate ? `Last update ${hhmm(lastUpdate)}. ` : ""}Drafts stay on this page. Index entries show Stale and timers say estimated.{" "}
          <button type="button" className="hh-button" data-size="sm" onClick={reconnectNow}>
            <Icon name="refresh" /> Reconnect now
          </button>
        </div>
      </div>
    );
  }
  return null;
}

export function Feed() {
  const rounds = useStore((s) => s.rounds);
  const loaded = useStore((s) => s.loaded);
  const advisors = useStore((s) => s.advisors);
  const connection = useStore((s) => s.connection);
  const shortcuts = useStore((s) => s.settings.shortcuts);
  const jumpTo = useStore((s) => s.jumpTo);
  const now = useNow();
  const offline = connection === "offline";
  const [filters, setFilters] = useState<Filters>({ callsigns: new Set(), projects: new Set() });
  const handles = useRef(new Map<string, RoundHandle>());
  const listRef = useRef<HTMLOListElement>(null);

  const callsigns = useMemo(() => [...new Set(rounds.map((r) => r.session.callsign))].sort(), [rounds]);
  const projects = useMemo(() => [...new Set(rounds.map((r) => r.session.project).filter((p): p is string => p !== null))].sort(), [rounds]);
  const filtering = filters.callsigns.size > 0 || filters.projects.size > 0;
  // Chips OR inside one kind and AND across kinds (preview.js).
  const shown = rounds.filter(
    (r) =>
      (filters.callsigns.size === 0 || filters.callsigns.has(r.session.callsign)) &&
      (filters.projects.size === 0 || (r.session.project !== null && filters.projects.has(r.session.project))),
  );
  const ids = shown.map((r) => r.id);
  const [inView, setInView] = useInView(ids, listRef);
  const pendingCount = rounds.filter((r) => r.status === "pending").length;

  function toggle(kind: keyof Filters, value: string) {
    setFilters((f) => {
      const next = new Set(f[kind]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [kind]: next };
    });
  }

  /** After Send, Dismiss or Redirect: scroll to the next Pending Round and focus it (command-center spec). */
  const advance = useCallback(
    (doneId: string) => {
      const at = shown.findIndex((r) => r.id === doneId);
      const after = shown.slice(at + 1).find((r) => r.status === "pending" && r.id !== doneId);
      const before = [...shown.slice(0, Math.max(0, at))].reverse().find((r) => r.status === "pending");
      const next = after ?? before;
      requestAnimationFrame(() => {
        if (next) {
          setInView(next.id);
          focusRound(next.id);
        } else {
          document.getElementById("feed-h")?.focus();
        }
      });
    },
    [shown, setInView],
  );

  useEffect(() => {
    if (!jumpTo || !loaded) return;
    clearJump();
    if (!ids.includes(jumpTo)) setFilters({ callsigns: new Set(), projects: new Set() });
    requestAnimationFrame(() => {
      setInView(jumpTo);
      focusRound(jumpTo);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, loaded]);

  // Keys (command-center spec): never inside a text field except ⌘↵; single keys can be switched off.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement;
      const focusedRound = target.closest?.(".hh-feed-item")?.id;
      const roundId = focusedRound ?? inView;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (!roundId) return;
        e.preventDefault();
        handles.current.get(roundId)?.send();
        return;
      }
      if (!shortcuts || e.metaKey || e.ctrlKey || e.altKey || isTextField(target)) return;
      const index = inView ? ids.indexOf(inView) : -1;
      const handle = roundId ? handles.current.get(roundId) : undefined;
      if (e.key === "j" || e.key === "k") {
        const next = ids[e.key === "j" ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1)];
        if (!next) return;
        e.preventDefault();
        setInView(next);
        focusRound(next);
      } else if (/^[1-9]$/.test(e.key) && handle) {
        e.preventDefault();
        handle.choose(Number(e.key));
      } else if ((e.key === "a" || e.key === "r") && handle) {
        e.preventDefault();
        handle.decide(e.key === "a" ? "approve" : "reject");
      } else if (e.key === "n" && handle) {
        e.preventDefault();
        handle.openNotes();
      } else if ((e.key === "d" || e.key === "e" || e.key === "v") && handle) {
        e.preventDefault();
        handle.openPanel(e.key === "d" ? "dismiss" : e.key === "e" ? "redirect" : "advisor");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ids, inView, shortcuts, setInView]);

  return (
    <section className="hh-page" aria-labelledby="feed-h">
      <div className="hh-page-head">
        <h1 className="hh-heading-lg" id="feed-h" tabIndex={-1}>
          Feed
        </h1>
        <span className="hh-mono-sm">
          {plural(rounds.length, "Round")} in the Feed · {pendingCount} pending · arrival order
        </span>
      </div>
      <ConnectionAlert />
      {!loaded ? (
        <div aria-busy="true" className="hh-stack">
          <p className="hh-body-sm">Loading Rounds…</p>
          <span className="hh-skeleton" data-shape="strip"></span>
          <span className="hh-skeleton" data-shape="strip"></span>
        </div>
      ) : rounds.length === 0 ? (
        <Standby compact={false} />
      ) : (
        <div className="hh-feed">
          <aside className="hh-feed-index hh-panel" data-density="compact" aria-labelledby="index-h">
            <div className="hh-feed-index-head">
              <h2 className="hh-heading-md" id="index-h">
                Feed index
              </h2>
              <span className="hh-mono-sm" role="status">
                {filtering && shown.length === 0 ? "No Rounds match · Clear filters" : `Showing ${shown.length} of ${rounds.length}`}
              </span>
            </div>
            <fieldset className="hh-feed-index-filters">
              <legend className="hh-visually-hidden">Filter by callsign</legend>
              {callsigns.map((c) => (
                <button key={c} type="button" className="hh-chip" aria-pressed={filters.callsigns.has(c)} onClick={() => toggle("callsigns", c)}>
                  <Callsign name={c} />
                </button>
              ))}
            </fieldset>
            {projects.length > 0 ? (
              <fieldset className="hh-feed-index-filters">
                <legend className="hh-visually-hidden">Filter by project</legend>
                {projects.map((p) => (
                  <button key={p} type="button" className="hh-chip" aria-pressed={filters.projects.has(p)} onClick={() => toggle("projects", p)} title={p}>
                    {projectLabel(p)}
                  </button>
                ))}
              </fieldset>
            ) : null}
            {filtering ? (
              <div className="hh-row">
                <button
                  type="button"
                  className="hh-button"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={() => setFilters({ callsigns: new Set(), projects: new Set() })}
                >
                  Clear filters
                </button>
              </div>
            ) : null}
            <nav aria-label="Feed index">
              <ul className="hh-feed-index-list">
                {shown.map((r) => (
                  <IndexEntry key={r.id} view={r} inView={r.id === inView} offline={offline} now={now} />
                ))}
              </ul>
            </nav>
            {shortcuts ? <KeyList /> : null}
          </aside>
          <div className="hh-feed-column">
            {pendingCount === 0 ? <Standby compact={true} /> : null}
            <ol className="hh-feed-list" aria-label="Rounds in the Feed" ref={listRef}>
              {shown.map((r) =>
                r.status === "pending" ? (
                  <PendingRound
                    key={r.id}
                    view={r}
                    advisors={advisors}
                    inView={r.id === inView}
                    offline={offline}
                    onDone={advance}
                    handle={(h) => {
                      if (h) handles.current.set(r.id, h);
                      else handles.current.delete(r.id);
                    }}
                  />
                ) : (
                  <EndedRound key={r.id} view={r} />
                ),
              )}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
