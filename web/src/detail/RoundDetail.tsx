import { useEffect, useState } from "react";
import type { AdvisorRunView, FeedRoundView, RoundDetail } from "../../../src/hub/engine.ts";
import type { Answer } from "../../../src/schema/types.ts";
import { roundDetail } from "../api.ts";
import { describeValue, hhmmss, KIND_BADGE, OUTCOME_WORDS, plural, projectLabel } from "../format.ts";
import { Icon, type IconName } from "../icons.tsx";
import { entryMarkdown, formatSetter } from "../log/markdown.ts";
import { Markdown } from "../markdown.tsx";
import { linkClick } from "../router.ts";
import { useStore } from "../store.ts";
import { Callsign, copy, EndedRound, PendingRound, RoundStrip } from "../feed/Round.tsx";
import { draftValues, isAnswered } from "../feed/values.ts";

const RUN_STATUS: Record<AdvisorRunView["status"], { word: string; tone: string; icon: IconName }> = {
  running: { word: "Running", tone: "info", icon: "clock" },
  succeeded: { word: "Succeeded", tone: "success", icon: "check" },
  failed: { word: "Unparsed", tone: "warning", icon: "alert" },
  timed_out: { word: "Timed out", tone: "warning", icon: "clock" },
  cancelled: { word: "Cancelled", tone: "expired", icon: "x" },
};

function runResult(run: AdvisorRunView): string {
  switch (run.status) {
    case "running":
      return "Working. Deadlines keep running.";
    case "succeeded":
      return `Suggestion parsed for ${plural(Object.keys(run.suggestion?.questions ?? {}).length, "Question")}.${run.suggestion?.summary ? ` ${run.suggestion.summary}` : ""}`;
    case "failed":
      return "The reply had no hermes.suggestion/v1 object. Shown as a plain briefing; nothing was filled.";
    case "timed_out":
      return "Advisor stopped at its timeout. No Suggestion; deadlines kept running.";
    case "cancelled":
      return "Cancelled before it returned.";
  }
}

/** History rows from what the Hub records: received, Advisor runs, Locks, the Outcome, delivery. */
function history(detail: RoundDetail): { at: string; text: string }[] {
  const { view } = detail;
  const rows: { at: string; text: string }[] = [{ at: view.received_at, text: `Round received from ${view.session.callsign}.` }];
  for (const run of view.advisor_runs) {
    rows.push({ at: run.started_at, text: `${run.trigger === "auto" ? "Auto-ask rule started" : "You asked"} ${run.advisor_name}.` });
    if (run.ended_at) rows.push({ at: run.ended_at, text: `${run.advisor_name}: ${RUN_STATUS[run.status].word.toLowerCase()}.` });
  }
  view.round.questions.forEach((q, i) => {
    const lock = view.locks[q.id];
    if (lock) rows.push({ at: lock.locked_at, text: `Q${i + 1} locked: Policy ${lock.value === null ? "cancelled" : `applied recommended (${describeValue(q, lock.value)})`}.` });
  });
  const answer = view.answer;
  if (answer) {
    const by =
      answer.outcome === "answered" || answer.outcome === "dismissed" || answer.outcome === "redirected"
        ? "You ended the Round"
        : answer.superseded_by
          ? `Replaced by ${answer.superseded_by}`
          : answer.cancelled_by === "human"
            ? "Cancelled by Forget"
            : answer.cancelled_by === "agent"
              ? `Cancelled by ${view.session.callsign}`
              : "Its last open Question locked";
    rows.push({ at: answer.decided_at, text: `${by}. Outcome: ${answer.outcome}.` });
  }
  if (detail.delivered_at) rows.push({ at: detail.delivered_at, text: `Delivered: ${view.session.callsign} picked up the Answer.` });
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/** An answered (or otherwise ended, removed) Round: values and who set them. */
function AnsweredRound({ detail }: { detail: RoundDetail }) {
  const { view } = detail;
  const answer = view.answer as Answer;
  const draft = draftValues(view.draft);
  return (
    <RoundStrip view={view} as="div" className="pv-detail-strip">
      <article className="hh-round" aria-labelledby="d-h">
        <div className="hh-round-head">
          <div className="hh-row">
            <Callsign name={view.session.callsign} />
            <span className="hh-mono-sm">
              {projectLabel(view.session.project)}
              {view.session.branch ? ` · ${view.session.branch}` : ""}
            </span>
            <span className="hh-badge" data-tone={answer.outcome === "expired" || answer.outcome === "cancelled" ? "expired" : "answered"}>
              <Icon name="check" /> {OUTCOME_WORDS[answer.outcome]}
            </span>
            {detail.delivered_at ? (
              <span className="hh-badge" data-tone="success">
                <Icon name="send" /> Delivered {hhmmss(detail.delivered_at)}
              </span>
            ) : (
              <span className="hh-badge" data-tone="warning">
                <Icon name="alert" /> Not picked up
              </span>
            )}
          </div>
          <h2 className="hh-strip-header" id="d-h">
            {view.round.title}
          </h2>
          {view.round.context ? <Markdown className="hh-body hh-measure" text={view.round.context} /> : null}
          <div className="hh-row">
            <span className="hh-mono">{view.id}</span>
            <button type="button" className="hh-button" data-variant="ghost" data-size="sm" aria-label={`Copy id ${view.id}`} onClick={() => copy(view.id, "Round id")}>
              <Icon name="file" /> Copy id
            </button>
            <button
              type="button"
              className="hh-button"
              data-size="sm"
              onClick={() =>
                copy(
                  entryMarkdown({
                    round: view.round,
                    answer,
                    draft: view.draft,
                    meta: { round_id: view.id, callsign: view.session.callsign, project: view.session.project, received_at: view.received_at, delivered_at: detail.delivered_at },
                  }),
                  "Markdown",
                )
              }
            >
              <Icon name="file" /> Copy as Markdown
            </button>
            <span className="hh-mono-sm">
              Created {hhmmss(view.received_at)} · {answer.outcome} {hhmmss(answer.decided_at)}
            </span>
          </div>
          {view.round.links?.length ? (
            <p className="hh-row">
              {view.round.links.map((l) => (
                <a key={l.url} className="hh-link" href={l.url} target="_blank" rel="noreferrer">
                  {l.label ?? l.url}
                  <span className="hh-visually-hidden"> opens in a new tab</span>
                </a>
              ))}
            </p>
          ) : null}
        </div>
        <ol className="hh-round-questions">
          {view.round.questions.map((q, i) => {
            const qa = answer.questions[q.id];
            const lock = view.locks[q.id];
            return (
              <li className="hh-question" key={q.id} id={`d-${view.id}-${q.id}`}>
                <div className="hh-question-call">
                  <div className="hh-question-meta">
                    <span className="hh-mono-sm">
                      Q{i + 1} of {view.round.questions.length}
                    </span>
                    <span className="hh-badge">{KIND_BADGE[q.kind]}</span>
                    <span className="hh-answer-state">
                      {qa?.set_by === "none" ? "Not answered" : <><Icon name="check" /> Answered</>}
                    </span>
                  </div>
                  <p className="hh-question-prompt">{q.prompt}</p>
                </div>
                <dl className="hh-dl pv-paper-dl">
                  <dt>Value</dt>
                  <dd>{describeValue(q, qa?.value)}</dd>
                  <dt>Set by</dt>
                  <dd>
                    {formatSetter(qa)}
                    {lock ? ` · locked ${hhmmss(lock.locked_at)}` : ""}
                  </dd>
                  {lock && isAnswered(draft[q.id]) ? (
                    <>
                      <dt>Draft</dt>
                      <dd>
                        <span className="hh-badge" data-tone="expired">
                          Not sent
                        </span>{" "}
                        You had chosen {describeValue(q, draft[q.id])}.
                      </dd>
                    </>
                  ) : null}
                  {qa?.note ? (
                    <>
                      <dt>Note</dt>
                      <dd>{qa.note}</dd>
                    </>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ol>
        {answer.message || answer.note ? (
          <div className="pv-round-note">
            <p className="hh-label">{answer.outcome === "redirected" ? "Do this instead" : "Round note"}</p>
            <p className="hh-body">{answer.message ?? answer.note}</p>
          </div>
        ) : null}
      </article>
    </RoundStrip>
  );
}

export function RoundDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<RoundDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useStore((s) => s.rounds.find((r) => r.id === id));
  const touched = useStore((s) => (s.touched?.id === id ? s.touched.n : 0));
  const advisors = useStore((s) => s.advisors);
  const connection = useStore((s) => s.connection);

  useEffect(() => {
    let cancelled = false;
    roundDetail(id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, touched]);

  const view: FeedRoundView | undefined = live ?? detail?.view;
  const fromFeed = view && (view.status === "pending" || detail?.in_feed);

  return (
    <section className="pv-surface" aria-labelledby="detail-h">
      <nav className="hh-breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <a className="hh-link" href={fromFeed ? "/" : "/log"} onClick={linkClick(fromFeed ? "/" : "/log")}>
              {fromFeed ? "Feed" : "Answered log"}
            </a>
          </li>
          <li>
            <span aria-current="page">{id}</span>
          </li>
        </ol>
      </nav>
      <div className="pv-page-head">
        <h1 className="hh-heading-lg" id="detail-h">
          Round detail
        </h1>
        <p className="hh-mono pv-route">/rounds/{id}</p>
      </div>
      {error && !view ? (
        <section className="hh-card hh-stack" aria-labelledby="d-nf-h">
          <h2 className="hh-heading-md" id="d-nf-h">
            Not found
          </h2>
          <p className="hh-body">No Round {id} on this Hub.</p>
          <p>
            <a className="hh-link" href="/log" onClick={linkClick("/log")}>
              Open answered log
            </a>
          </p>
        </section>
      ) : !view ? (
        <div aria-busy="true" className="hh-stack">
          <p className="hh-body-sm">Loading the Round…</p>
          <span className="hh-skeleton pv-skel"></span>
        </div>
      ) : (
        <>
          {view.status === "pending" ? (
            <PendingRound key={view.id} view={view} advisors={advisors} inView offline={connection === "offline"} as="div" className="pv-detail-strip" />
          ) : live ? (
            <EndedRound view={view} as="div" className="pv-detail-strip" />
          ) : detail ? (
            <AnsweredRound detail={{ ...detail, view }} />
          ) : null}
          {detail ? (
            <section className="hh-shelf hh-stack" aria-labelledby="d-hist-h">
              <h2 className="hh-heading-md" id="d-hist-h">
                History <span className="hh-mono">· {history({ ...detail, view }).length}</span>
              </h2>
              <ul className="hh-list">
                {history({ ...detail, view }).map((row, i) => (
                  <li className="hh-list-row" key={i}>
                    <span className="hh-mono">{hhmmss(row.at)}</span>
                    <span className="hh-list-row-main">{row.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {view.advisor_runs.length ? (
            <section className="hh-panel hh-stack" aria-labelledby="d-adv-h">
              <h2 className="hh-heading-md" id="d-adv-h">
                Advisor runs <span className="hh-mono">· {view.advisor_runs.length}</span>
              </h2>
              <div className="hh-table-wrap" data-density="compact" role="region" tabIndex={0} aria-label="Advisor run history">
                <table className="hh-table">
                  <caption className="hh-visually-hidden">Advisor runs for {view.id}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Advisor</th>
                      <th scope="col">Started by</th>
                      <th scope="col">Start</th>
                      <th scope="col">End</th>
                      <th scope="col">Status</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.advisor_runs.map((run) => (
                      <tr key={run.id}>
                        <td className="hh-mono">{run.advisor_name}</td>
                        <td>
                          {run.trigger === "auto" ? "Auto-ask rule" : "You"}
                          {run.brief ? ` · brief: “${run.brief}”` : ""}
                        </td>
                        <td className="hh-mono">{hhmmss(run.started_at)}</td>
                        <td className="hh-mono">{run.ended_at ? hhmmss(run.ended_at) : "—"}</td>
                        <td>
                          <span className="hh-badge" data-tone={RUN_STATUS[run.status].tone}>
                            <Icon name={RUN_STATUS[run.status].icon} /> {RUN_STATUS[run.status].word}
                          </span>
                        </td>
                        <td>{runResult(run)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
