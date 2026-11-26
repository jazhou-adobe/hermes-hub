import { useRef, useState, type KeyboardEvent } from "react";
import type { AgentView, FeedRoundView } from "../../../src/hub/engine.ts";
import { forgetAgent } from "../api.ts";
import { Callsign, copy } from "../feed/Round.tsx";
import { countdown, hhmm, hhmmss, KIND_BADGE, KIND_NAMES, nextDeadline, plural, projectLabel } from "../format.ts";
import { Icon } from "../icons.tsx";
import { linkClick } from "../router.ts";
import { announce, openRound, useNow, useStore } from "../store.ts";

function AgentState({ agent }: { agent: AgentView }) {
  return (
    <span className="hh-agent-state">
      {agent.liveness === "live" ? (
        <span className="hh-connection" data-state="live">
          <span className="hh-connection-lamp" aria-hidden="true"></span>
          <span>Live</span>
        </span>
      ) : agent.liveness === "idle" ? (
        <span className="hh-badge">
          <Icon name="clock" /> Idle
        </span>
      ) : (
        <span className="hh-badge" data-tone="expired">
          <Icon name="x" /> Gone
        </span>
      )}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <button type="button" className="hh-button" data-variant="ghost" data-size="sm" aria-label={label} onClick={() => copy(text, label.replace(/^Copy /, ""))}>
      <Icon name="copy" /> Copy
    </button>
  );
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

function AgentCard({ agent, onForget }: { agent: AgentView; onForget: (a: AgentView) => void }) {
  const [why, setWhy] = useState(false);
  const where = [agent.host, agent.cwd, agent.git?.branch].filter(Boolean).join(" · ");
  const d = agent.detection;
  return (
    <li className="hh-agent-card" data-state={agent.liveness}>
      <div className="hh-agent-card-head">
        <Callsign name={agent.callsign} />
        <AgentState agent={agent} />
      </div>
      <dl className="hh-dl">
        <dt>Client</dt>
        <dd>{KIND_NAMES[agent.kind] ?? agent.kind}</dd>
        <dt>Pending</dt>
        <dd className="hh-mono-sm">
          {agent.pending_count > 0 ? (
            <a className="hh-link" href="/" onClick={linkClick("/")}>
              {agent.pending_count} pending
            </a>
          ) : (
            "0 pending"
          )}
        </dd>
        <dt>Last seen</dt>
        <dd className="hh-mono-sm">{hhmmss(agent.last_seen)}</dd>
        {where ? (
          <>
            <dt>Where</dt>
            <dd className="hh-mono-sm">{where}</dd>
          </>
        ) : null}
        <dt>Session</dt>
        <dd>
          <span className="hh-row">
            <span className="hh-mono-sm">{short(agent.session_key)}</span>
            <CopyButton text={agent.session_key} label={`Copy session id of ${agent.callsign}`} />
          </span>
        </dd>
        <dt>Resume</dt>
        <dd>
          {agent.resume ? (
            <span className="hh-row">
              <code className="hh-mono-sm">{agent.resume}</code>
              <CopyButton text={agent.resume} label={`Copy resume handle of ${agent.callsign}`} />
            </span>
          ) : (
            <span className="hh-body-sm">None for this client</span>
          )}
        </dd>
      </dl>
      <details className="hh-detection">
        <summary className="hh-detection-summary">Detection details</summary>
        <dl className="hh-dl">
          <dt>Label</dt>
          <dd>
            {agent.label ? (
              <>
                <span className="hh-mono-sm">{agent.label}</span> · declared by the Agent; display text only
              </>
            ) : (
              "None declared; the callsign uses the working folder"
            )}
          </dd>
          <dt>Callsign</dt>
          <dd>
            <span className="hh-mono-sm">{agent.callsign}</span>
          </dd>
          {/·[0-9a-f]{4}$/.test(agent.callsign) ? (
            <>
              <dt>Why {agent.callsign.slice(-5)}</dt>
              <dd>Another Live or Idle session has the same callsign, so each gets a short tag. A callsign has a suffix only when it would clash.</dd>
            </>
          ) : null}
          <dt>Client kind</dt>
          <dd>
            {KIND_NAMES[agent.kind] ?? agent.kind}
            {d ? (
              <>
                {" "}
                · from <span className="hh-mono-sm">{d.source}</span> (step {d.step})
              </>
            ) : null}
          </dd>
          <dt>Confidence</dt>
          <dd>
            {!d ? (
              <span className="hh-body-sm">Not reported</span>
            ) : d.documented ? (
              <span className="hh-badge" data-tone="success">
                <Icon name="check" /> Documented signal
              </span>
            ) : (
              <>
                <span className="hh-badge" data-tone="warning">
                  <Icon name="alert" /> Undocumented signal
                </span>
                <div className="hh-popover-anchor">
                  <button
                    type="button"
                    className="hh-button"
                    data-variant="ghost"
                    data-size="sm"
                    aria-expanded={why}
                    aria-controls={`why-${agent.id}`}
                    onClick={() => setWhy(!why)}
                  >
                    Why may this be wrong?
                  </button>
                  <div className="hh-popover" id={`why-${agent.id}`} role="group" aria-label="Why the detected kind may be wrong" hidden={!why}>
                    <p className="hh-body-sm">
                      The client does not document this marker. It was found in its source or through observation, and another client can set the same
                      marker. If this kind looks wrong, run <span className="hh-mono-sm">hermes-hub doctor</span> or set <span className="hh-mono-sm">--kind</span>.
                    </p>
                  </div>
                </div>
              </>
            )}
          </dd>
          <dt>Session id</dt>
          <dd>
            <span className="hh-row">
              <code className="hh-mono-sm">{agent.session_key}</code>
              <CopyButton text={agent.session_key} label={`Copy full session id of ${agent.callsign}`} />
            </span>
          </dd>
          {agent.cwd ? (
            <>
              <dt>Working dir</dt>
              <dd className="hh-mono-sm">{agent.cwd}</dd>
            </>
          ) : null}
          {agent.git ? (
            <>
              <dt>Git</dt>
              <dd className="hh-mono-sm">{[agent.git.branch, agent.git.head?.slice(0, 8)].filter(Boolean).join(" · ") || agent.git.root}</dd>
            </>
          ) : null}
          {agent.host ? (
            <>
              <dt>Host</dt>
              <dd>{agent.host}</dd>
            </>
          ) : null}
        </dl>
      </details>
      <div className="hh-row">
        <button type="button" className="hh-button" data-size="sm" aria-haspopup="dialog" aria-label={`Forget ${agent.callsign}`} onClick={() => onForget(agent)}>
          <Icon name="trash" /> Forget
        </button>
      </div>
    </li>
  );
}

function LaneStrip({ view, selected, onSelect, now }: { view: FeedRoundView; selected: boolean; onSelect: () => void; now: number }) {
  const next = nextDeadline(view);
  const policy = view.round.policy?.on_timeout ?? "wait";
  const policyWord = policy === "wait" ? "keeps waiting" : policy === "cancel" ? "cancels" : "applies recommended";
  const total = next === null ? 0 : next - Date.parse(view.received_at);
  const fraction = next === null || total <= 0 ? 1 : Math.max(0, Math.min(1, (next - now) / total));
  return (
    <li className="hh-strip" data-status="pending" data-selected={selected ? "true" : undefined}>
      <div className="hh-strip-tab">
        <span>Pending</span>
        <span className="hh-mono-sm">
          {policyWord} · {next === null ? "No deadline" : `${countdown(next - now)} to next Lock`}
        </span>
      </div>
      <div className="hh-strip-paper">
        <button type="button" className="hh-strip-head" aria-controls="lane-drawer" aria-expanded={selected} onClick={onSelect}>
          <span className="hh-strip-cell" data-cell="callsign">
            <span className="hh-mono-sm">{view.id}</span>
          </span>
          <span className="hh-strip-cell" data-cell="title">
            <span className="hh-strip-header hh-strip-title">{view.round.title}</span>
            <span className="hh-strip-policy">{policyWord}</span>
          </span>
          <span className="hh-strip-cell" data-cell="meta">
            <span className="hh-mono-sm">{selected ? "Open" : "Closed"}</span>
          </span>
        </button>
      </div>
      <span
        className="hh-policy-timer"
        aria-hidden="true"
        data-policy={next === null ? "wait" : "apply-recommended"}
        style={{ "--timer-fraction": String(fraction) } as React.CSSProperties}
      >
        <span className="hh-policy-timer-fill"></span>
      </span>
    </li>
  );
}

function Lanes({ agents, rounds }: { agents: AgentView[]; rounds: FeedRoundView[] }) {
  const now = useNow();
  const [selected, setSelected] = useState<string | null>(null);
  const view = rounds.find((r) => r.id === selected && r.status === "pending");
  return (
    <>
      <p className="hh-body-sm hh-measure">
        One lane per Agent session, with its Pending Rounds. Selecting a strip opens the Round in the drawer beside the lanes; Open in Feed jumps to it in
        the Feed.
      </p>
      <div className="hh-lanes-layout">
        <ul className="hh-lanes" aria-label="Lanes">
          {agents.map((a) => {
            const lane = rounds.filter((r) => r.session.id === a.id && r.status === "pending");
            return (
              <li key={a.id} className="hh-shelf hh-lane" aria-label={`Lane ${a.callsign}`}>
                <div className="hh-lane-head">
                  <Callsign name={a.callsign} />
                  <AgentState agent={a} />
                  <span className="hh-mono">{lane.length} pending</span>
                  <span className="hh-mono-sm">Last seen {hhmmss(a.last_seen)}</span>
                  {a.git?.branch ? <span className="hh-mono-sm">{a.git.branch}</span> : null}
                </div>
                <ul className="hh-strip-bay-list hh-lane-list" aria-label={`Pending Rounds of ${a.callsign}`}>
                  {lane.length ? (
                    lane.map((r) => <LaneStrip key={r.id} view={r} now={now} selected={r.id === selected} onSelect={() => setSelected(r.id === selected ? null : r.id)} />)
                  ) : (
                    <li className="hh-strip-bay-slot hh-lane-slot">
                      <p className="hh-body-sm">
                        No pending Rounds · {a.callsign} is {a.liveness === "live" ? "Live" : a.liveness === "idle" ? "Idle" : "Gone"}
                      </p>
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
        <aside className="hh-drawer" id="lane-drawer" aria-labelledby="drawer-h">
          <div className="hh-overlay-head">
            <h2 className="hh-heading-md" id="drawer-h">
              Round drawer
            </h2>
            {view ? (
              <button type="button" className="hh-icon-button" data-variant="ghost" data-size="sm" aria-label="Close Round drawer" onClick={() => setSelected(null)}>
                <Icon name="x" />
              </button>
            ) : null}
          </div>
          <div className="hh-overlay-body hh-stack">
            {view ? (
              <>
                <div className="hh-row">
                  <Callsign name={view.session.callsign} />
                  <span className="hh-mono-sm">{view.id}</span>
                  <span className="hh-badge" data-tone="pending">
                    Pending
                  </span>
                </div>
                <p className="hh-strip-header">{view.round.title}</p>
                {Object.keys(view.locks).length ? (
                  <span className="hh-badge" data-tone="warning">
                    <Icon name="lock" /> {Object.keys(view.locks).length} of {view.round.questions.length} locked · Round stays pending
                  </span>
                ) : null}
                <ol className="hh-strip-summary">
                  {view.round.questions.map((q, i) => (
                    <li key={q.id}>
                      <span className="hh-mono-sm">Q{i + 1}</span>
                      <span className="hh-body-sm">
                        <strong>{KIND_BADGE[q.kind]}.</strong> {q.prompt}
                        {view.locks[q.id] ? ` · Locked ${hhmm(view.locks[q.id]!.locked_at)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="hh-body-sm">Select a strip to see its Round here.</p>
            )}
          </div>
          {view ? (
            <div className="hh-overlay-foot">
              <a className="hh-button" href={`/rounds/${view.id}`} onClick={linkClick(`/rounds/${view.id}`)}>
                Open Round detail
              </a>
              <a
                className="hh-button"
                data-variant="primary"
                href={`/#${view.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  openRound(view.id);
                }}
              >
                <Icon name="arrow-right" /> Open in Feed
              </a>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

/** Roster and Lanes (agent-identity and command-center specs), with the Forget alert dialog. */
export function Agents() {
  const agents = useStore((s) => s.agents);
  const rounds = useStore((s) => s.rounds);
  const [tab, setTab] = useState<"roster" | "lanes">("roster");
  const [forgetting, setForgetting] = useState<AgentView | null>(null);
  const [forgotten, setForgotten] = useState<{ callsign: string; at: string; rounds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const tabs = useRef<Record<"roster" | "lanes", HTMLButtonElement | null>>({ roster: null, lanes: null });

  function askForget(agent: AgentView) {
    opener.current = document.activeElement as HTMLElement;
    setForgetting(agent);
    dialog.current?.showModal();
    keep.current?.focus(); // focus starts on the safe action
  }

  function close() {
    dialog.current?.close();
    setForgetting(null);
    opener.current?.focus();
  }

  function confirm() {
    const agent = forgetting;
    if (!agent) return;
    const pendingIds = rounds.filter((r) => r.session.id === agent.id && r.status === "pending").map((r) => r.id);
    dialog.current?.close();
    setForgetting(null);
    forgetAgent(agent.id)
      .then(() => {
        setForgotten({ callsign: agent.callsign, at: new Date().toISOString(), rounds: pendingIds });
        announce(`${agent.callsign} forgotten`);
        document.getElementById("agents-h")?.focus();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  function onTabKey(e: KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? "roster" : e.key === "End" ? "lanes" : tab === "roster" ? "lanes" : "roster";
    setTab(next);
    tabs.current[next]?.focus();
  }

  const pendingOf = forgetting ? rounds.filter((r) => r.session.id === forgetting.id && r.status === "pending").length : 0;
  return (
    <section className="hh-page" aria-labelledby="agents-h">
      <div className="hh-page-head">
        <h1 className="hh-heading-lg" id="agents-h" tabIndex={-1}>
          Agents <span className="hh-mono">· {agents.length}</span>
        </h1>
      </div>
      <div className="hh-tabs" role="tablist" aria-label="Agents views">
        {(["roster", "lanes"] as const).map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabs.current[t] = el;
            }}
            type="button"
            className="hh-tab"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={onTabKey}
          >
            {t === "roster" ? "Roster" : "Lanes"}
          </button>
        ))}
      </div>
      <div className="hh-tab-panel hh-stack" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "roster" ? (
          <>
            {forgotten ? (
              <div className="hh-alert" data-tone="info" role="status">
                <span className="hh-badge" data-tone="info">
                  <Icon name="check" /> Forgotten
                </span>
                <strong>
                  {forgotten.callsign} forgotten at {hhmm(forgotten.at)}
                </strong>
                <div className="hh-body-sm">
                  It is hidden from this roster until it next calls the Hub.
                  {forgotten.rounds.length ? ` Its ${plural(forgotten.rounds.length, "pending Round")} ${forgotten.rounds.length === 1 ? "was" : "were"} cancelled and stay${forgotten.rounds.length === 1 ? "s" : ""} in the Feed and the log.` : ""}
                </div>
              </div>
            ) : null}
            {error ? (
              <p className="hh-error" role="alert">
                <span className="hh-badge" data-tone="destructive">
                  Error
                </span>{" "}
                {error}
              </p>
            ) : null}
            {agents.length === 0 ? (
              <div className="hh-empty-state">
                <p className="hh-heading-md">No Agents yet.</p>
                <p className="hh-body-sm">A session appears here the first time it calls the Hub.</p>
              </div>
            ) : (
              <ul className="hh-agent-roster" aria-label={`Agents · ${agents.length}`} data-density="compact">
                {agents.map((a) => (
                  <AgentCard key={a.id} agent={a} onForget={askForget} />
                ))}
              </ul>
            )}
          </>
        ) : (
          <Lanes agents={agents} rounds={rounds} />
        )}
      </div>
      <dialog
        ref={dialog}
        className="hh-dialog"
        role="alertdialog"
        aria-labelledby="forget-h"
        aria-describedby="forget-d"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="hh-overlay-head">
          <h2 className="hh-heading-md" id="forget-h">
            Forget {forgetting?.callsign}?
          </h2>
          <button type="button" className="hh-icon-button" data-variant="ghost" aria-label="Close" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        <div className="hh-overlay-body">
          <p className="hh-body" id="forget-d">
            {pendingOf ? `Its ${plural(pendingOf, "pending Round")} ${pendingOf === 1 ? "is" : "are"} cancelled and stay${pendingOf === 1 ? "s" : ""} in the log as cancelled by you. ` : ""}
            The session is hidden from the roster until it next calls the Hub.
          </p>
        </div>
        <div className="hh-overlay-foot">
          <button ref={keep} type="button" className="hh-button" onClick={close}>
            Keep {forgetting?.callsign}
          </button>
          <button type="button" className="hh-button" data-variant="destructive" onClick={confirm}>
            <Icon name="trash" /> Forget {forgetting?.callsign}
          </button>
        </div>
      </dialog>
    </section>
  );
}
