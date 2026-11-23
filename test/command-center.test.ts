import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { migrate } from "../src/db/db.ts";
import { Engine, type Clock, type HubEvent, type SessionRow } from "../src/hub/engine.ts";
import { Notifier, osascriptFor, type HubNotification } from "../src/hub/notify.ts";
import { startServer } from "../src/hub/server.ts";
import type { Round } from "../src/schema/types.ts";
import { DEFAULT_SETTINGS, inQuietHours, mergeSettings } from "../src/settings.ts";

class FakeClock implements Clock {
  private ms = Date.parse("2026-11-20T12:00:00.000Z");
  now(): number {
    return this.ms;
  }
  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

function newEngine(): { engine: Engine; clock: FakeClock } {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const clock = new FakeClock();
  const engine = new Engine(db, "http://127.0.0.1:4747", clock);
  return { engine, clock };
}

function session(engine: Engine, label: string): SessionRow {
  const res = engine.upsertSession({ kind: "claude-code", session_key: label, label, cwd: `/Users/me/${label}`, git: { root: `/Users/me/${label}`, branch: "main" } });
  return engine.sessionFor(res.token);
}

function round(overrides: Partial<Round> = {}): Round {
  return {
    schema: "hermes.round/v1",
    title: "Pick one",
    questions: [{ id: "q", kind: "single", prompt: "Which?", recommended: "a", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }],
    ...overrides,
  };
}

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

const servers: Server<undefined>[] = [];
const notifiers: Notifier[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const n of notifiers.splice(0)) n.stop();
});

async function up(notifier?: (engine: Engine) => Notifier): Promise<{ url: string; engine: Engine }> {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  const port = freePort();
  const url = `http://127.0.0.1:${port}`;
  const engine = new Engine(db, url);
  const n = notifier?.(engine);
  if (n) notifiers.push(n);
  const server = await startServer(engine, port, undefined, n);
  servers.push(server);
  return { url, engine };
}

const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("live settings (hub-operations spec: stored in the database)", () => {
  test("defaults until changed; a partial update persists and is broadcast", () => {
    const { engine } = newEngine();
    expect(engine.settings()).toEqual(DEFAULT_SETTINGS);
    expect(engine.settings().sound).toBe(false); // sound is off by default
    const events: HubEvent[] = [];
    engine.subscribe((e) => events.push(e));
    const next = engine.updateSettings({ sound: true, quiet_hours: { enabled: true, from: "19:00" } });
    expect(next.sound).toBe(true);
    expect(next.quiet_hours).toEqual({ enabled: true, from: "19:00", to: "07:00" });
    expect(engine.settings()).toEqual(next);
    expect(events).toEqual([{ type: "settings.changed", settings: next }]);
  });

  test("unknown keys and bad values are refused, never ignored", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { volume: 3 })).toBe("unknown setting volume");
    expect(mergeSettings(DEFAULT_SETTINGS, { theme: "neon" })).toContain("theme must be one of");
    expect(mergeSettings(DEFAULT_SETTINGS, { quiet_hours: { from: "25:00" } })).toBe("quiet_hours.from must be HH:MM");
    expect(mergeSettings(DEFAULT_SETTINGS, { shortcuts: "no" })).toBe("shortcuts must be true or false");
  });

  test("quiet hours wrap past midnight", () => {
    const q = { enabled: true, from: "19:00", to: "08:00" };
    const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m);
    expect(inQuietHours(q, at(19))).toBe(true);
    expect(inQuietHours(q, at(2))).toBe(true);
    expect(inQuietHours(q, at(7, 59))).toBe(true);
    expect(inQuietHours(q, at(8))).toBe(false);
    expect(inQuietHours(q, at(12))).toBe(false);
    expect(inQuietHours({ ...q, enabled: false }, at(2))).toBe(false);
    expect(inQuietHours({ enabled: true, from: "09:00", to: "17:00" }, at(12))).toBe(true);
  });
});

describe("Command Center endpoints", () => {
  test("/settings is served as the Command Center page with the CSP", async () => {
    const { url } = await up();
    const res = await fetch(`${url}/settings`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await res.text()).toContain('data-theme="hermes-flight-director"');
  });

  test("GET/PUT /cc/settings round-trips, and a bad patch is a 422 problem", async () => {
    const { url } = await up();
    expect(await (await fetch(`${url}/cc/settings`)).json()).toEqual(DEFAULT_SETTINGS);
    const put = await fetch(`${url}/cc/settings`, { method: "PUT", ...json({ shortcuts: false, palette: "night-watch" }) });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ shortcuts: false, palette: "night-watch" });
    const bad = await fetch(`${url}/cc/settings`, { method: "PUT", ...json({ sound: "loud" }) });
    expect(bad.status).toBe(422);
    expect((await bad.json()).code).toBe("invalid_settings");
  });

  test("GET /cc/rounds/:id returns any Round with its delivery and Feed state", async () => {
    const { url, engine } = await up();
    const s = engine.sessionFor(engine.upsertSession({ kind: "script", session_key: "k", label: "ops", cwd: "/srv/ops" }).token);
    const { round_id } = engine.submit(s, round(), 100);
    const pending = await (await fetch(`${url}/cc/rounds/${round_id}`)).json();
    expect(pending).toMatchObject({ in_feed: true, decided_at: null, view: { id: round_id, status: "pending", session: { project: "/srv/ops" } } });
    engine.send(round_id, { questions: { q: { value: { selected: "b" } } } });
    const answered = await (await fetch(`${url}/cc/rounds/${round_id}`)).json();
    expect(answered).toMatchObject({ in_feed: false, delivered_at: null, view: { status: "answered" } });
    expect((await fetch(`${url}/cc/rounds/r_nope`)).status).toBe(404);
  });

  test("GET /cc/config shows config.toml read-only, with storage", async () => {
    const { url, engine } = await up();
    engine.setConfigSource("/tmp/hermes/config.toml");
    const s = engine.sessionFor(engine.upsertSession({ kind: "script", session_key: "k" }).token);
    engine.submit(s, round({ attachments: [{ kind: "code", content: "x".repeat(100) }] }), 200);
    const body = await (await fetch(`${url}/cc/config`)).json();
    expect(body).toMatchObject({ port: 4747, log_level: "info", advisors: [], auto_ask: [], status: { path: "/tmp/hermes/config.toml", error: null } });
    expect(body.storage).toMatchObject({ attachment_bytes: 100, rounds: 1 });
    engine.configFailed("config.toml: port must be an integer from 1 to 65535");
    expect((await (await fetch(`${url}/cc/config`)).json()).status.error).toContain("port must be");
  });
});

describe("macOS fallback notifications (hub-operations spec)", () => {
  function setup() {
    const { engine, clock } = newEngine();
    const posted: HubNotification[] = [];
    const notifier = new Notifier(engine, (n) => posted.push(n), clock);
    notifier.start();
    notifiers.push(notifier);
    return { engine, clock, posted, notifier, s: session(engine, "api") };
  }

  test("posts a new Round when no Command Center tab is open", () => {
    const { engine, posted, s } = setup();
    engine.submit(s, round({ title: "Ship it?" }), 100);
    expect(posted).toEqual([{ title: "New Round", subtitle: "CLAUDE·api", message: "Ship it?" }]);
  });

  test("stays quiet while a tab is open, unless the browser denied notifications", () => {
    const { engine, posted, s, notifier } = setup();
    const close = notifier.clientOpened();
    notifier.setBrowserPermission("granted");
    engine.submit(s, round({ title: "One" }), 100);
    expect(posted).toEqual([]);
    notifier.setBrowserPermission("denied");
    engine.submit(s, round({ title: "Two" }), 100);
    expect(posted.map((p) => p.message)).toEqual(["Two"]);
    notifier.setBrowserPermission("granted");
    close();
    engine.submit(s, round({ title: "Three" }), 100);
    expect(posted.map((p) => p.message)).toEqual(["Two", "Three"]);
  });

  test("mute and quiet hours suppress it; Rounds still arrive", () => {
    const { engine, posted, s } = setup();
    engine.updateSettings({ notifications: false });
    engine.submit(s, round(), 100);
    engine.updateSettings({ notifications: true, quiet_hours: { enabled: true, from: "00:00", to: "00:00" } }); // all day
    engine.submit(s, round(), 100);
    expect(posted).toEqual([]);
    expect(engine.feed()).toHaveLength(2);
  });

  test("warns 15 s before a Lock, once per deadline", () => {
    const { engine, clock, posted, notifier, s } = setup();
    engine.submit(s, round({ title: "Soon", policy: { on_timeout: "apply_recommended", after_seconds: 60 } }), 100);
    posted.length = 0;
    clock.advance(40);
    notifier.checkLocks();
    expect(posted).toEqual([]);
    clock.advance(6); // 14 s left
    notifier.checkLocks();
    notifier.checkLocks();
    expect(posted).toEqual([{ title: "Lock in 15 s", subtitle: "CLAUDE·api", message: "Q1 “Which?” · policy applies recommended" }]);
  });

  test("the AppleScript quotes its strings", () => {
    expect(osascriptFor({ title: "New Round", subtitle: "CLAUDE·api", message: 'Say "hi" \\ bye' })).toBe(
      'display notification "Say \\"hi\\" \\\\ bye" with title "Hermes Hub · New Round" subtitle "CLAUDE·api"',
    );
  });
});

describe("Feed views", () => {
  test("carry the session's project and branch for the Feed's filter chips", () => {
    const { engine } = newEngine();
    const s = session(engine, "billing-ui");
    engine.submit(s, round(), 100);
    expect(engine.feed()[0]!.session).toMatchObject({ project: "/Users/me/billing-ui", branch: "main", callsign: "CLAUDE·billing-ui" });
    expect(engine.roster()[0]).toMatchObject({ project: "/Users/me/billing-ui", git: { branch: "main" } });
  });
});
