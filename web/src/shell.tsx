import { useEffect, type ReactNode } from "react";
import { Agents } from "./agents/Agents.tsx";
import { RoundDetailPage } from "./detail/RoundDetail.tsx";
import { Feed } from "./feed/Feed.tsx";
import { hhmm } from "./format.ts";
import { Icon, type IconName } from "./icons.tsx";
import { KeyMapDialog, showKeyMap } from "./keys.tsx";
import { Log } from "./log/Log.tsx";
import { linkClick, parseRoute, usePath } from "./router.ts";
import { Settings } from "./settings/Settings.tsx";
import { dismissToast, openRound, useStore, type Toast } from "./store.ts";

const TOAST_BADGE: Record<Toast["kind"], { word: string; tone: string }> = {
  new: { word: "New Round", tone: "pending" },
  lock: { word: "Lock in 15 s", tone: "warning" },
  suggestion: { word: "Suggestion ready", tone: "info" },
};

function ConnectionValue() {
  const connection = useStore((s) => s.connection);
  const liveSince = useStore((s) => s.liveSince);
  const retryIn = useStore((s) => s.retryIn);
  const lastUpdate = useStore((s) => s.lastUpdate);
  const word = { connecting: "Connecting", live: "Live", reconnecting: "Reconnecting", offline: "Offline" }[connection];
  const detail =
    connection === "live" && liveSince
      ? `since ${hhmm(liveSince)}`
      : connection === "reconnecting" && retryIn !== null
        ? `retry in ${retryIn} s`
        : connection === "offline" && lastUpdate
          ? `last update ${hhmm(lastUpdate)}`
          : "";
  return (
    <span className="hh-connection" data-state={connection === "connecting" ? "reconnecting" : connection}>
      <span className="hh-connection-lamp" aria-hidden="true"></span>
      {connection === "offline" ? <Icon name="x" /> : null}
      <span>{word}</span>
      {detail ? <span className="hh-connection-detail">{detail}</span> : null}
    </span>
  );
}

function NavLink({ to, icon, current, children }: { to: string; icon: IconName; current: boolean; children: ReactNode }) {
  return (
    <a href={to} aria-current={current ? "page" : undefined} onClick={linkClick(to)}>
      <Icon name={icon} /> {children}
    </a>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <section className="hh-toast-region" data-placement="top" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className="hh-toast">
          <span className="hh-badge" data-tone={TOAST_BADGE[t.kind].tone}>
            {TOAST_BADGE[t.kind].word}
          </span>
          <span className="hh-body-sm">{t.text}</span>
          <button
            type="button"
            className="hh-button"
            data-size="sm"
            onClick={() => {
              dismissToast(t.id);
              openRound(t.roundId);
            }}
          >
            <Icon name="arrow-right" /> Open
          </button>
          <button type="button" className="hh-button" data-variant="ghost" data-size="sm" onClick={() => dismissToast(t.id)}>
            Dismiss<span className="hh-visually-hidden"> notification</span>
          </button>
        </div>
      ))}
    </section>
  );
}

function LiveRegion() {
  const announcement = useStore((s) => s.announcement);
  return (
    <div className="hh-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {announcement.text ? <span key={announcement.n}>{announcement.text}</span> : null}
    </div>
  );
}

const TITLES: Record<string, string> = {
  feed: "Feed",
  round: "Round detail",
  log: "Answered log",
  agents: "Agents",
  settings: "Settings",
  "not-found": "Not found",
};

export function App() {
  const route = parseRoute(usePath());
  const pending = useStore((s) => s.rounds.filter((r) => r.status === "pending").length);
  const agents = useStore((s) => s.agents.length);
  const theme = useStore((s) => s.settings.theme);
  const palette = useStore((s) => s.settings.palette);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    if (theme === "hermes-flight-director" && palette) root.dataset.palette = palette;
    else delete root.dataset.palette;
  }, [theme, palette]);

  useEffect(() => {
    document.title = `${pending ? `(${pending}) ` : ""}${TITLES[route.name]} · Hermes Hub`;
  }, [pending, route.name]);

  return (
    <>
      <a className="hh-skip-link" href="#main">
        Skip to content
      </a>
      <header className="hh-app-bar">
        <span className="hh-app-bar-brand">Hub · {location.host}</span>
        <span className="hh-live-value" data-live={pending > 0 ? "true" : undefined}>
          Pending · {pending}
        </span>
        <span className="hh-app-bar-spacer"></span>
        <ConnectionValue />
        <span className="hh-tooltip-anchor">
          <button type="button" className="hh-icon-button" data-variant="ghost" aria-label="Keyboard shortcuts" aria-describedby="tip-keys" onClick={showKeyMap}>
            <Icon name="keyboard" />
          </button>
          <span className="hh-tooltip" role="tooltip" id="tip-keys">
            Keyboard shortcuts · ?
          </span>
        </span>
        <span className="hh-tooltip-anchor">
          <a className="hh-icon-button" data-variant="ghost" href="/settings" aria-label="Settings" aria-describedby="tip-set" onClick={linkClick("/settings")}>
            <Icon name="settings" />
          </a>
          <span className="hh-tooltip" role="tooltip" id="tip-set">
            Settings
          </span>
        </span>
      </header>
      <div className="hh-app-shell">
        <nav className="hh-side-nav hh-app-shell-nav" aria-label="Command Center">
          <NavLink to="/" icon="bay" current={route.name === "feed"}>
            Feed
            <span className="hh-side-nav-count">
              {pending}
              <span className="hh-visually-hidden"> pending</span>
            </span>
          </NavLink>
          <NavLink to="/log" icon="check" current={route.name === "log"}>
            Answered log
          </NavLink>
          <NavLink to="/agents" icon="user" current={route.name === "agents"}>
            Agents
            <span className="hh-side-nav-count">
              {agents}
              <span className="hh-visually-hidden"> sessions</span>
            </span>
          </NavLink>
          <NavLink to="/settings" icon="settings" current={route.name === "settings"}>
            Settings
          </NavLink>
        </nav>
        <main id="main" className="hh-app-shell-main" tabIndex={-1}>
          {route.name === "feed" ? (
            <Feed />
          ) : route.name === "round" ? (
            <RoundDetailPage key={route.id} id={route.id} />
          ) : route.name === "log" ? (
            <Log />
          ) : route.name === "agents" ? (
            <Agents />
          ) : route.name === "settings" ? (
            <Settings />
          ) : (
            <section className="hh-page" aria-labelledby="nf-h">
              <h1 className="hh-heading-lg" id="nf-h">
                Not found
              </h1>
              <p className="hh-body">This Command Center has no page here.</p>
              <p>
                <a className="hh-link" href="/" onClick={linkClick("/")}>
                  Open the Feed
                </a>
              </p>
            </section>
          )}
        </main>
      </div>
      <Toasts />
      <LiveRegion />
      <KeyMapDialog />
    </>
  );
}
