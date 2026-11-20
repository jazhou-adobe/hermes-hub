import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LogEntry, LogFilter } from "../../../src/hub/engine.ts";
import type { Outcome } from "../../../src/schema/types.ts";
import { fetchLog, logExportUrl } from "../api.ts";
import { entryMarkdown, formatAnswerValue, formatBytes, formatSetter, OUTCOME_WORDS } from "./markdown.ts";

const SEARCH_DEBOUNCE_MS = 300;
const OUTCOMES: Outcome[] = ["answered", "dismissed", "redirected", "expired", "cancelled"];

function groupByDay(entries: LogEntry[]): [string, LogEntry[]][] {
  const groups = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const day = entry.answer.decided_at.slice(0, 10);
    const list = groups.get(day);
    if (list) list.push(entry);
    else groups.set(day, [entry]);
  }
  return [...groups.entries()];
}

/** Renders a `snippet()` result (plain text with our own `<mark>`/`</mark>` delimiters) as React
 * nodes, never as HTML: the matched text came from a Round's own content, so it must stay escaped. */
function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/(<mark>|<\/mark>)/);
  let marking = false;
  return parts.map((part, i) => {
    if (part === "<mark>") {
      marking = true;
      return null;
    }
    if (part === "</mark>") {
      marking = false;
      return null;
    }
    return marking ? <mark key={i}>{part}</mark> : part;
  });
}

export function Log() {
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const [callsign, setCallsign] = useState<string | undefined>(undefined);
  const [project, setProject] = useState<string | undefined>(undefined);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [dbSizeBytes, setDbSizeBytes] = useState(0);
  const [allCallsigns, setAllCallsigns] = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The chip options come from the whole log, not the current filter, so narrowing one chip never
  // hides the others.
  useEffect(() => {
    let cancelled = false;
    fetchLog({})
      .then((res) => {
        if (cancelled) return;
        setAllCallsigns([...new Set(res.entries.map((e) => e.meta.callsign))].sort());
        const projects = res.entries.map((e) => e.meta.project).filter((p): p is string => p !== null);
        setAllProjects([...new Set(projects)].sort());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim() || undefined), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filter: LogFilter = useMemo(
    () => ({
      ...(outcome !== undefined ? { outcome } : {}),
      ...(callsign !== undefined ? { callsign } : {}),
      ...(project !== undefined ? { project } : {}),
      ...(fromDate ? { from: `${fromDate}T00:00:00.000Z` } : {}),
      ...(toDate ? { to: `${toDate}T23:59:59.999Z` } : {}),
      ...(q !== undefined ? { q } : {}),
    }),
    [outcome, callsign, project, fromDate, toDate, q],
  );

  useEffect(() => {
    let cancelled = false;
    fetchLog(filter)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setDbSizeBytes(res.db_size_bytes);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const hasFilters = outcome !== undefined || callsign !== undefined || project !== undefined || fromDate !== "" || toDate !== "" || q !== undefined;

  function clearFilters() {
    setOutcome(undefined);
    setCallsign(undefined);
    setProject(undefined);
    setFromDate("");
    setToDate("");
    setSearchInput("");
    setQ(undefined);
  }

  const days = groupByDay(entries);

  return (
    <main className="log">
      <header className="bar">
        <h1>Answered log</h1>
        <span className="db-size">Database: {formatBytes(dbSizeBytes)}</span>
      </header>
      <div className="filters">
        <div className="chip-row" role="group" aria-label="Outcome">
          {OUTCOMES.map((o) => (
            <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(outcome === o ? undefined : o)}>
              {OUTCOME_WORDS[o]}
            </button>
          ))}
        </div>
        {allCallsigns.length > 0 ? (
          <div className="chip-row" role="group" aria-label="Callsign">
            {allCallsigns.map((c) => (
              <button key={c} type="button" aria-pressed={callsign === c} onClick={() => setCallsign(callsign === c ? undefined : c)}>
                {c}
              </button>
            ))}
          </div>
        ) : null}
        {allProjects.length > 0 ? (
          <div className="chip-row" role="group" aria-label="Project">
            {allProjects.map((p) => (
              <button key={p} type="button" aria-pressed={project === p} onClick={() => setProject(project === p ? undefined : p)}>
                {p}
              </button>
            ))}
          </div>
        ) : null}
        <div className="date-range">
          <label>
            From <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
        <input
          type="search"
          placeholder="Search the log…"
          aria-label="Search the log"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <a className="export" href={logExportUrl(filter)}>
          Export JSON
        </a>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {entries.length === 0 ? (
        <p className="empty">
          No Rounds match
          {hasFilters ? (
            <>
              {" "}
              ·{" "}
              <button type="button" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {days.map(([day, dayEntries]) => (
        <section key={day} className="day-group">
          <h2 className="day-heading">
            {new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </h2>
          {dayEntries.map((entry) => (
            <LogEntryCard key={entry.meta.round_id} entry={entry} />
          ))}
        </section>
      ))}
    </main>
  );
}

function LogEntryCard({ entry }: { entry: LogEntry }) {
  const { round, answer, meta } = entry;
  return (
    <article className="round log-entry" aria-labelledby={`log-${meta.round_id}-title`}>
      <h3 id={`log-${meta.round_id}-title`}>{round.title}</h3>
      <p className="meta">
        {meta.callsign} · {meta.project ?? "no project"} · {OUTCOME_WORDS[answer.outcome]} · {new Date(answer.decided_at).toLocaleTimeString()}
        {answer.superseded_by ? (
          <>
            {" "}
            · Replaced by <a href={`/rounds/${answer.superseded_by}`}>{answer.superseded_by}</a>
          </>
        ) : null}
      </p>
      <p className="meta">{meta.delivered_at ? `Delivered ${new Date(meta.delivered_at).toLocaleTimeString()}` : "Not picked up"}</p>
      {entry.snippet ? <p className="snippet">{renderSnippet(entry.snippet)}</p> : null}
      {round.context ? <p className="context">{round.context}</p> : null}
      {round.questions.map((q) => {
        const qa = answer.questions[q.id];
        return (
          <div key={q.id} className="question-answer">
            <strong>{q.prompt}</strong>: {formatAnswerValue(q, qa)} <span className="setter">({formatSetter(qa)})</span>
            {qa?.note ? <div className="note">{qa.note}</div> : null}
          </div>
        );
      })}
      {answer.outcome === "redirected" && answer.message ? (
        <p className="note">Redirect: {answer.message}</p>
      ) : answer.note ? (
        <p className="note">Note: {answer.note}</p>
      ) : null}
      {entry.draft ? (
        <p className="draft-kept">
          Not sent
          <button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(entry.draft))}>
            Copy draft
          </button>
        </p>
      ) : null}
      <div className="actions">
        <button type="button" onClick={() => void navigator.clipboard.writeText(entryMarkdown(entry))}>
          Copy as Markdown
        </button>
      </div>
    </article>
  );
}
