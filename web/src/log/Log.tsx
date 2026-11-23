import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LogEntry, LogFilter } from "../../../src/hub/engine.ts";
import type { Outcome } from "../../../src/schema/types.ts";
import { fetchLog, logExportUrl } from "../api.ts";
import { copy, Callsign } from "../feed/Round.tsx";
import { describeValue, hhmm, hhmmss, plural, projectLabel } from "../format.ts";
import { Icon } from "../icons.tsx";
import { linkClick } from "../router.ts";
import { entryMarkdown, formatSetter, OUTCOME_WORDS } from "./markdown.ts";

const SEARCH_DEBOUNCE_MS = 300;
const OUTCOMES: Outcome[] = ["answered", "dismissed", "redirected", "expired", "cancelled"];
type Range = "all" | "today" | "week" | "custom";
const RANGES: [Range, string][] = [
  ["all", "All time"],
  ["today", "Today"],
  ["week", "Last 7 days"],
  ["custom", "Custom range"],
];

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function groupByDay(entries: LogEntry[]): [string, LogEntry[]][] {
  const groups = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const day = localDay(entry.answer.decided_at);
    const list = groups.get(day);
    if (list) list.push(entry);
    else groups.set(day, [entry]);
  }
  return [...groups.entries()];
}

function dayHeading(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 86_400_000).toISOString());
  const words = date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return day === today ? `Today · ${words}` : day === yesterday ? `Yesterday · ${words}` : words;
}

/** Renders a `snippet()` result (plain text with our own `<mark>` delimiters) as React nodes, never as HTML. */
function renderSnippet(snippet: string): ReactNode {
  let marking = false;
  return snippet.split(/(<mark>|<\/mark>)/).map((part, i) => {
    if (part === "<mark>" || part === "</mark>") {
      marking = part === "<mark>";
      return null;
    }
    return marking ? (
      <mark key={i} className="hh-match">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

function outcomeDetail(entry: LogEntry): string | null {
  const { answer } = entry;
  if (answer.superseded_by) return `Replaced by ${answer.superseded_by}`;
  if (answer.outcome === "cancelled") return answer.cancelled_by === "human" ? "Cancelled by you · Forget" : "Cancelled by the Agent";
  if (answer.outcome === "expired") return "Policy applied recommended";
  if (answer.outcome === "redirected" && answer.message) return `Message: “${answer.message}”`;
  if (answer.note) return `Note: “${answer.note}”`;
  return null;
}

function LogTable({ label, entries }: { label: string; entries: LogEntry[] }) {
  return (
    <div className="hh-answered-log hh-table-wrap" data-density="compact" role="region" tabIndex={0} aria-label={label}>
      <table className="hh-table">
        <caption className="hh-visually-hidden">{label}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Round and Outcome detail</th>
            <th scope="col">Agent and project</th>
            <th scope="col">Outcome</th>
            <th scope="col">Values and who set them</th>
            <th scope="col">Delivery</th>
            <th scope="col">
              <span className="hh-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const { round, answer, meta } = entry;
            const detail = outcomeDetail(entry);
            return (
              <tr key={meta.round_id}>
                <td className="hh-mono">{hhmm(answer.decided_at)}</td>
                <td>
                  <span className="hh-mono-sm">{meta.round_id}</span>{" "}
                  <a className="hh-link" href={`/rounds/${meta.round_id}`} onClick={linkClick(`/rounds/${meta.round_id}`)}>
                    {round.title}
                  </a>
                  {detail ? (
                    <>
                      <br />
                      <span className="hh-body-sm">{detail}</span>
                    </>
                  ) : null}
                  {entry.snippet ? (
                    <>
                      <br />
                      <span className="hh-body-sm">{renderSnippet(entry.snippet)}</span>
                    </>
                  ) : null}
                </td>
                <td>
                  <Callsign name={meta.callsign} />
                  <br />
                  <span className="hh-mono-sm" title={meta.project ?? undefined}>
                    {projectLabel(meta.project)}
                  </span>
                </td>
                <td>
                  <span className="hh-badge" data-tone={answer.outcome === "expired" || answer.outcome === "cancelled" ? "expired" : "answered"}>
                    {OUTCOME_WORDS[answer.outcome]}
                  </span>
                </td>
                <td>
                  <ul className="hh-log-values">
                    {round.questions.map((q, i) => {
                      const qa = answer.questions[q.id];
                      const draft = entry.draft?.questions?.[q.id]?.value;
                      return (
                        <li key={q.id}>
                          <span className="hh-mono-sm">Q{i + 1}</span> <span>{describeValue(q, qa?.value ?? draft)}</span>{" "}
                          <span className="hh-body-sm hh-log-setter">· {qa && qa.set_by !== "none" ? formatSetter(qa) : draft != null ? "Draft · Not sent" : "Not set"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </td>
                <td>
                  {meta.delivered_at ? (
                    <span className="hh-mono-sm">Delivered {hhmmss(meta.delivered_at)}</span>
                  ) : (
                    <span className="hh-badge" data-tone="warning">
                      <Icon name="alert" /> Not picked up
                    </span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="hh-button"
                    data-variant="ghost"
                    data-size="sm"
                    aria-label={`Copy as Markdown ${meta.round_id}`}
                    onClick={() => copy(entryMarkdown(entry), "Markdown")}
                  >
                    <Icon name="copy" /> Copy as Markdown
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Log() {
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const [callsign, setCallsign] = useState<string | undefined>(undefined);
  const [project, setProject] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<Range>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [all, setAll] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The chip options and the total come from the whole log, so narrowing one chip never hides the others.
  useEffect(() => {
    let cancelled = false;
    fetchLog({})
      .then((res) => {
        if (!cancelled) setAll(res.entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const allCallsigns = useMemo(() => [...new Set(all.map((e) => e.meta.callsign))].sort(), [all]);
  const allProjects = useMemo(() => [...new Set(all.map((e) => e.meta.project).filter((p): p is string => p !== null))].sort(), [all]);

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim() || undefined), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filter: LogFilter = useMemo(() => {
    const f: LogFilter = {};
    if (outcome !== undefined) f.outcome = outcome;
    if (callsign !== undefined) f.callsign = callsign;
    if (project !== undefined) f.project = project;
    if (q !== undefined) f.q = q;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (range === "today") f.from = startOfToday.toISOString();
    if (range === "week") f.from = new Date(startOfToday.getTime() - 6 * 86_400_000).toISOString();
    if (range === "custom") {
      if (fromDate) f.from = new Date(`${fromDate}T00:00:00`).toISOString();
      if (toDate) f.to = new Date(`${toDate}T23:59:59.999`).toISOString();
    }
    return f;
  }, [outcome, callsign, project, range, fromDate, toDate, q]);

  useEffect(() => {
    let cancelled = false;
    fetchLog(filter)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const hasFilters = outcome !== undefined || callsign !== undefined || project !== undefined || range !== "all" || q !== undefined;

  function clearFilters() {
    setOutcome(undefined);
    setCallsign(undefined);
    setProject(undefined);
    setRange("all");
    setFromDate("");
    setToDate("");
    setSearchInput("");
    setQ(undefined);
  }

  const shown = entries ?? [];
  return (
    <section className="hh-page" aria-labelledby="log-h">
      <div className="hh-page-head">
        <h1 className="hh-heading-lg" id="log-h">
          Answered log
        </h1>
        <span className="hh-mono">{plural(all.length, "ended Round")}</span>
      </div>
      <div className="hh-tray hh-filter-tray" data-density="compact">
          <div className="hh-field">
            <label className="hh-label" htmlFor="log-search">
              Search
            </label>
            <input
              id="log-search"
              className="hh-input"
              type="search"
              value={searchInput}
              placeholder="Titles, Questions, answers, notes"
              aria-describedby="log-search-hint"
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <p className="hh-hint" id="log-search-hint">
              Full-text over Round titles and context, Question prompts, options, free-text answers, notes and redirect messages. Attachment contents
              are not indexed.
            </p>
          </div>
          <div role="group" aria-label="Filter by Outcome" className="hh-row">
            {OUTCOMES.map((o) => (
              <button key={o} type="button" className="hh-chip" aria-pressed={outcome === o} onClick={() => setOutcome(outcome === o ? undefined : o)}>
                {OUTCOME_WORDS[o]}
              </button>
            ))}
          </div>
          {allCallsigns.length > 0 ? (
            <div role="group" aria-label="Filter by callsign" className="hh-row">
              {allCallsigns.map((c) => (
                <button key={c} type="button" className="hh-chip" aria-pressed={callsign === c} onClick={() => setCallsign(callsign === c ? undefined : c)}>
                  <Callsign name={c} />
                </button>
              ))}
            </div>
          ) : null}
          {allProjects.length > 0 ? (
            <div role="group" aria-label="Filter by project" className="hh-row">
              {allProjects.map((p) => (
                <button key={p} type="button" className="hh-chip" aria-pressed={project === p} title={p} onClick={() => setProject(project === p ? undefined : p)}>
                  {projectLabel(p)}
                </button>
              ))}
            </div>
          ) : null}
          <div role="group" aria-label="Filter by date range" className="hh-row">
            {RANGES.map(([r, label]) => (
              <button key={r} type="button" className="hh-chip" aria-pressed={range === r} onClick={() => setRange(r)}>
                {label}
              </button>
            ))}
          </div>
          {range === "custom" ? (
            <div className="hh-field-pair">
              <div className="hh-field">
                <label className="hh-label" htmlFor="log-from">
                  From
                </label>
                <input id="log-from" className="hh-input hh-mono" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="hh-field">
                <label className="hh-label" htmlFor="log-to">
                  To
                </label>
                <input id="log-to" className="hh-input hh-mono" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
          ) : null}
          <div className="hh-filter-tray-actions">
            <span className="hh-mono-sm" role="status">
              {entries === null ? "Loading…" : shown.length ? `Showing ${shown.length} of ${all.length}` : "No Rounds match · Clear filters"}
            </span>
            {hasFilters ? (
              <button type="button" className="hh-button" data-variant="ghost" data-size="sm" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
            <a className="hh-button" data-size="sm" href={logExportUrl(filter)}>
              <Icon name="file" /> Export JSON
            </a>
            <span className="hh-mono-sm">hermes-log-{localDay(new Date().toISOString())}.json · the filtered log</span>
          </div>
      </div>
      {error ? (
        <p className="hh-error" role="alert">
          <span className="hh-badge" data-tone="destructive">
            Error
          </span>{" "}
          {error}
        </p>
      ) : null}
      {entries !== null && shown.length === 0 ? (
        hasFilters ? (
          <div className="hh-empty-state">
            <p className="hh-heading-md">No Rounds match</p>
            <p className="hh-body-sm">Nothing in the log fits these filters and this search.</p>
            <button type="button" className="hh-button" onClick={clearFilters}>
              <Icon name="x" /> Clear filters
            </button>
          </div>
        ) : (
          <div className="hh-empty-state">
            <p className="hh-heading-md">No answered Rounds yet.</p>
          </div>
        )
      ) : q !== undefined ? (
        <section className="hh-stack" aria-labelledby="log-s-h">
          <h2 className="hh-heading-md" id="log-s-h">
            Search results · “{q}” <span className="hh-mono">· {shown.length}</span>
          </h2>
          <p className="hh-body-sm">Ranked by relevance, not by day. Filters still combine with search.</p>
          <LogTable label={`Search results for ${q}`} entries={shown} />
        </section>
      ) : (
        groupByDay(shown).map(([day, dayEntries]) => (
          <section key={day} className="hh-stack" aria-label={dayHeading(day)}>
            <h2 className="hh-heading-md">
              {dayHeading(day)} <span className="hh-mono">· {dayEntries.length}</span>
            </h2>
            <LogTable label={dayHeading(day)} entries={dayEntries} />
          </section>
        ))
      )}
    </section>
  );
}
