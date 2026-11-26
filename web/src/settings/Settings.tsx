import { useEffect, useState } from "react";
import type { HubSettings, Palette, Theme } from "../../../src/settings.ts";
import { fetchConfig, saveSettings, type ConfigView } from "../api.ts";
import { copy } from "../feed/Round.tsx";
import { hhmm } from "../format.ts";
import { Icon } from "../icons.tsx";
import { KeyMapTable } from "../keys.tsx";
import { formatBytes } from "../log/markdown.ts";
import { browserPermission, requestPermission, type Permission } from "../notify.ts";
import { announce, applySettings, useStore } from "../store.ts";

function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: string }) {
  const hintId = hint ? `hint-${label.replace(/\W+/g, "-").toLowerCase()}` : undefined;
  return (
    <div className="hh-field">
      <button type="button" role="switch" aria-checked={checked} className="hh-switch" aria-describedby={hintId} onClick={() => onChange(!checked)}>
        <span className="hh-switch-track" aria-hidden="true">
          <span className="hh-switch-thumb"></span>
        </span>
        <span className="hh-body-sm">{label}</span>
        <span className="hh-switch-state" aria-hidden="true">
          {checked ? "On" : "Off"}
        </span>
      </button>
      {hint ? (
        <p className="hh-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const PERMISSION: Record<Permission, { word: string; tone: string }> = {
  granted: { word: "Granted", tone: "success" },
  denied: { word: "Denied", tone: "destructive" },
  default: { word: "Not asked yet", tone: "warning" },
  unsupported: { word: "Not supported", tone: "expired" },
};

function seconds(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1000} s`;
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [permission, setPermission] = useState<Permission>(browserPermission());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((c) => !cancelled && setConfig(c))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  function update(patch: Partial<HubSettings>) {
    const previous = settings;
    applySettings({ ...settings, ...patch, quiet_hours: { ...settings.quiet_hours, ...patch.quiet_hours } });
    saveSettings(patch)
      .then((saved) => {
        applySettings(saved);
        setError(null);
      })
      .catch((err: unknown) => {
        applySettings(previous);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  const storage = config?.storage;
  const share = storage && storage.db_bytes > 0 ? Math.min(1, storage.attachment_bytes / storage.db_bytes) : 0;
  const status = config?.status;

  return (
    <section className="hh-page" aria-labelledby="settings-h">
      <div className="hh-page-head">
        <h1 className="hh-heading-lg" id="settings-h">
          Settings
        </h1>
      </div>
      {error ? (
        <p className="hh-error" role="alert">
          <span className="hh-badge" data-tone="destructive">
            Error
          </span>{" "}
          {error}
        </p>
      ) : null}
      <div className="hh-settings">
        <nav className="hh-side-nav hh-panel" aria-label="Settings sections">
          <a href="#set-config">
            <Icon name="file" /> config.toml
          </a>
          <a href="#set-notify">
            <Icon name="alert" /> Notifications and keys
          </a>
          <a href="#set-appearance">
            <Icon name="settings" /> Appearance
          </a>
          <a href="#set-storage">
            <Icon name="bay" /> Storage
          </a>
        </nav>
        <div className="hh-settings-panels">
          <section className="hh-card hh-stack" id="set-config" aria-labelledby="set-config-h">
            <h2 className="hh-heading-md" id="set-config-h">
              From config.toml · read-only
            </h2>
            {!config ? (
              <p className="hh-body-sm" aria-busy="true">
                Loading…
              </p>
            ) : (
              <>
                <div className="hh-config-source">
                  {status?.error ? (
                    <span className="hh-badge" data-tone="destructive">
                      <Icon name="alert" /> Config error
                    </span>
                  ) : (
                    <span className="hh-badge" data-tone="success">
                      <Icon name="check" /> Loaded
                    </span>
                  )}
                  {status?.path ? (
                    <>
                      <span className="hh-mono">{status.path}</span>
                      <button type="button" className="hh-button" data-variant="ghost" data-size="sm" aria-label="Copy config path" onClick={() => copy(status.path!, "Config path")}>
                        <Icon name="copy" /> Copy
                      </button>
                    </>
                  ) : (
                    <span className="hh-body-sm">Defaults (no config file)</span>
                  )}
                  {status?.loaded_at ? <span className="hh-mono-sm">reloaded {hhmm(status.loaded_at)}</span> : null}
                  {status?.restart_needed ? (
                    <span className="hh-badge" data-tone="warning">
                      <Icon name="refresh" /> Restart needed
                    </span>
                  ) : null}
                </div>
                <p className="hh-body-sm hh-measure">
                  Edit the file as text; the Hub reloads it when it changes. This page only shows what is loaded. Port and data folder changes print
                  “restart needed”.
                </p>
                {status?.error ? (
                  <div className="hh-alert" data-tone="destructive" role="alert">
                    <span className="hh-badge" data-tone="destructive">
                      <Icon name="alert" /> Config error
                    </span>
                    <strong>{status.error}</strong>
                    <div className="hh-body-sm">
                      The config loaded{status.loaded_at ? ` at ${hhmm(status.loaded_at)}` : ""} stays active. Fix the file; it reloads when you save. The
                      same error is in the Hub log.
                    </div>
                  </div>
                ) : null}
                <dl className="hh-dl">
                  <dt>Port</dt>
                  <dd className="hh-mono-sm">{config.port}</dd>
                  <dt>Log level</dt>
                  <dd className="hh-mono-sm">{config.log_level}</dd>
                  <dt>Flood cap</dt>
                  <dd className="hh-mono-sm">{config.limits.pending_per_session} Pending Rounds per session</dd>
                  <dt>Attachment caps</dt>
                  <dd className="hh-mono-sm">
                    {formatBytes(config.limits.attachment_bytes)} each · {formatBytes(config.limits.round_bytes)} per Round
                  </dd>
                  <dt>Live / Idle</dt>
                  <dd className="hh-mono-sm">
                    Live within {seconds(config.limits.live_ms)} · Idle within {seconds(config.limits.idle_ms)}
                  </dd>
                  <dt>Backups</dt>
                  <dd className="hh-mono-sm">keep {config.backups.keep}</dd>
                </dl>
              </>
            )}
          </section>

          <section className="hh-card hh-stack" aria-labelledby="set-adv-h">
            <h2 className="hh-heading-md" id="set-adv-h">
              Advisors <span className="hh-mono">· {config?.advisors.length ?? 0}</span>
            </h2>
            {config && config.advisors.length === 0 ? (
              <p className="hh-body-sm hh-measure">
                None. Add <span className="hh-mono-sm">[[advisor]] name, command = [...], timeout_seconds</span> tables to config.toml.
              </p>
            ) : (
              <div className="hh-table-wrap" data-density="compact" role="region" tabIndex={0} aria-label="Advisors">
                <table className="hh-table">
                  <caption className="hh-visually-hidden">Advisors from config.toml</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Command (argument list)</th>
                      <th scope="col">Timeout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config?.advisors.map((a) => (
                      <tr key={a.name}>
                        <td className="hh-mono">{a.name}</td>
                        <td className="hh-mono-sm">{JSON.stringify(a.command).replaceAll(",", ", ")}</td>
                        <td data-numeric>{a.timeout_seconds} s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="hh-card hh-stack" aria-labelledby="set-rules-h">
            <h2 className="hh-heading-md" id="set-rules-h">
              Auto-ask rules <span className="hh-mono">· {config?.auto_ask.length ?? 0}</span>
            </h2>
            <p className="hh-body-sm hh-measure">
              A rule matches kind and project, and optionally a label. It starts its Advisor as soon as a matching Round arrives. None by default.
            </p>
            {config && config.auto_ask.length > 0 ? (
              <div className="hh-table-wrap" data-density="compact" role="region" tabIndex={0} aria-label="Auto-ask rules">
                <table className="hh-table">
                  <caption className="hh-visually-hidden">Auto-ask rules from config.toml</caption>
                  <thead>
                    <tr>
                      <th scope="col">Kind</th>
                      <th scope="col">Project</th>
                      <th scope="col">Label</th>
                      <th scope="col">Advisor</th>
                      <th scope="col">Standing brief</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.auto_ask.map((r, i) => (
                      <tr key={i}>
                        <td className="hh-mono-sm">{r.kind}</td>
                        <td className="hh-mono-sm">{r.project}</td>
                        <td className="hh-mono-sm">{r.label ?? "any"}</td>
                        <td className="hh-mono">{r.advisor}</td>
                        <td>{r.brief ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="hh-card hh-stack" id="set-notify" aria-labelledby="set-notify-h">
            <h2 className="hh-heading-md" id="set-notify-h">
              Notifications and keys
            </h2>
            <div className="hh-row">
              <span className="hh-label">Browser permission</span>
              <span className="hh-badge" data-tone={PERMISSION[permission].tone}>
                {permission === "granted" ? <Icon name="check" /> : null} {PERMISSION[permission].word}
              </span>
              <span className="hh-body-sm">Shown while this tab is hidden. In-page toasts have their own switch below.</span>
              {permission === "default" ? (
                <button
                  type="button"
                  className="hh-button"
                  data-size="sm"
                  onClick={() =>
                    void requestPermission().then((p) => {
                      setPermission(p);
                      announce(`Browser notifications ${PERMISSION[p].word.toLowerCase()}`);
                    })
                  }
                >
                  Allow browser notifications
                </button>
              ) : null}
            </div>
            {config ? (
              <p className="hh-body-sm hh-measure">
                {config.macos_fallback
                  ? "When no Command Center tab is open, or the browser denied notifications, the Hub posts a macOS notification instead (title and callsign)."
                  : "This Hub is not on macOS, so there is no notification when no Command Center tab is open."}
              </p>
            ) : null}
            <Switch
              label="Notifications"
              checked={settings.notifications}
              onChange={(on) => update({ notifications: on })}
              hint="New Round, a Lock in 15 s, and a Suggestion ready. Agent gone and policy outcomes show in the Feed and log only."
            />
            <Switch
              label="In-page toasts"
              checked={settings.toasts}
              onChange={(on) => update({ toasts: on })}
              hint="The strip with Open at the top of this page. Off hides it; the Feed and screen-reader announcements still update."
            />
            <Switch
              label="Quiet hours"
              checked={settings.quiet_hours.enabled}
              onChange={(on) => update({ quiet_hours: { ...settings.quiet_hours, enabled: on } })}
              hint="Silences browser and macOS notifications and the sound. Rounds still arrive and show in the Feed."
            />
            <div className="hh-field-pair">
              <div className="hh-field">
                <label className="hh-label" htmlFor="qh-from">
                  From
                </label>
                <input
                  id="qh-from"
                  className="hh-input hh-mono"
                  type="time"
                  value={settings.quiet_hours.from}
                  onChange={(e) => e.target.value && update({ quiet_hours: { ...settings.quiet_hours, from: e.target.value } })}
                />
              </div>
              <div className="hh-field">
                <label className="hh-label" htmlFor="qh-to">
                  To
                </label>
                <input
                  id="qh-to"
                  className="hh-input hh-mono"
                  type="time"
                  value={settings.quiet_hours.to}
                  onChange={(e) => e.target.value && update({ quiet_hours: { ...settings.quiet_hours, to: e.target.value } })}
                />
              </div>
            </div>
            <Switch label="Sound" checked={settings.sound} onChange={(on) => update({ sound: on })} hint="Off by default. Plays one short tone in this tab on a new Round." />
            <Switch
              label="Single-key shortcuts"
              checked={settings.shortcuts}
              onChange={(on) => update({ shortcuts: on })}
              hint="Keys never fire inside a text field, except ⌘↵, which always sends."
            />
            <KeyMapTable caption="Key map" />
          </section>

          <section className="hh-card hh-stack" id="set-appearance" aria-labelledby="set-appearance-h">
            <h2 className="hh-heading-md" id="set-appearance-h">
              Appearance
            </h2>
            <div className="hh-field-pair">
              <div className="hh-field">
                <label className="hh-label" htmlFor="theme-select">
                  Theme
                </label>
                <select id="theme-select" className="hh-select" value={settings.theme} onChange={(e) => update({ theme: e.target.value as Theme })}>
                  <option value="hermes-flight-director">Flight Director 2169</option>
                  <option value="hermes-dark">Dark</option>
                  <option value="hermes-light">Light</option>
                </select>
              </div>
              <div className="hh-field">
                <label className="hh-label" htmlFor="palette-select">
                  Colour option
                </label>
                <select
                  id="palette-select"
                  className="hh-select"
                  aria-describedby="palette-hint"
                  value={settings.palette}
                  disabled={settings.theme !== "hermes-flight-director"}
                  onChange={(e) => update({ palette: e.target.value as Palette })}
                >
                  <option value="">Console slate (default)</option>
                  <option value="night-watch">Night watch</option>
                  <option value="day-shift">Day shift</option>
                  <option value="original">Original</option>
                </select>
                <p className="hh-hint" id="palette-hint">
                  Applies to Flight Director 2169 only.
                </p>
              </div>
            </div>
          </section>

          <section className="hh-card hh-stack" id="set-storage" aria-labelledby="set-storage-h">
            <h2 className="hh-heading-md" id="set-storage-h">
              Storage
            </h2>
            {storage ? (
              <div className="hh-progress">
                <div className="hh-progress-head">
                  <span className="hh-label" id="stor-l">
                    Attachments share of the database
                  </span>
                  <span className="hh-mono-sm">
                    {formatBytes(storage.attachment_bytes)} of {formatBytes(storage.db_bytes)}
                  </span>
                </div>
                <div
                  className="hh-progress-track"
                  role="progressbar"
                  aria-labelledby="stor-l"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share * 100)}
                  aria-valuetext={`${Math.round(share * 100)} percent: ${formatBytes(storage.attachment_bytes)} of ${formatBytes(storage.db_bytes)}`}
                >
                  <div className="hh-progress-fill" style={{ "--progress-value": String(share) } as React.CSSProperties}></div>
                </div>
              </div>
            ) : null}
            <p className="hh-body-sm hh-measure">
              {storage ? `${storage.rounds} Rounds stored. ` : ""}Rounds, Answers, Attachments, Drafts and Advisor runs are kept forever in this phase.
              {storage?.db_path ? (
                <>
                  {" "}The database is <span className="hh-mono-sm">{storage.db_path}</span>.
                </>
              ) : null}
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
