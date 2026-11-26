import { useSyncExternalStore } from "react";
import type { AdvisorConfig } from "../../src/config.ts";
import type { AgentView, FeedRoundView, HubEvent } from "../../src/hub/engine.ts";
import { DEFAULT_SETTINGS, type HubSettings } from "../../src/settings.ts";
import { agentRoster, feedRounds, fetchConfig, fetchSettings } from "./api.ts";
import { describeValue, plural } from "./format.ts";
import { browserNotify, playTone, sendPermission } from "./notify.ts";
import { navigate } from "./router.ts";
import { effectivePolicy } from "../../src/schema/policy.ts";

export type Connection = "connecting" | "live" | "reconnecting" | "offline";

export interface Toast {
  id: number;
  kind: "new" | "lock" | "suggestion";
  roundId: string;
  text: string;
}

export interface State {
  rounds: FeedRoundView[];
  agents: AgentView[];
  advisors: AdvisorConfig[];
  settings: HubSettings;
  connection: Connection;
  /** When the stream last became live, and when the Feed last heard from the Hub. */
  liveSince: string | null;
  lastUpdate: string | null;
  /** Seconds until the next reconnect attempt while reconnecting or offline. */
  retryIn: number | null;
  /** The first snapshot has loaded. */
  loaded: boolean;
  /** The polite live region's text; `n` changes so the same words are announced again. */
  announcement: { n: number; text: string };
  toasts: Toast[];
  /** A Round the Feed should scroll to and focus (toast Open, Replaced-by links). */
  jumpTo: string | null;
  /** Bumped on every event that touches a Round, for views that re-fetch it (Round detail). */
  touched: { id: string; n: number } | null;
}

let state: State = {
  rounds: [],
  agents: [],
  advisors: [],
  settings: DEFAULT_SETTINGS,
  connection: "connecting",
  liveSince: null,
  lastUpdate: null,
  retryIn: null,
  loaded: false,
  announcement: { n: 0, text: "" },
  toasts: [],
  jumpTo: null,
  touched: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): State {
  return state;
}

/** Selectors must return values already in the state (stable references). */
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

// ── Clock: timers count down from the Hub's deadlines, corrected by its clock offset ─────────

let offsetMs = 0;

/** The Hub's "now" in epoch ms (the stream's hello carries the server time). */
export function hubNow(): number {
  return Date.now() + offsetMs;
}

let tick = hubNow();
const tickListeners = new Set<() => void>();
setInterval(() => {
  tick = hubNow();
  for (const l of tickListeners) l();
  checkLockWarnings();
}, 1000);

/** The Hub's time, re-rendering once a second (countdowns, Lock soon). */
export function useNow(): number {
  return useSyncExternalStore(
    (l) => {
      tickListeners.add(l);
      return () => tickListeners.delete(l);
    },
    () => tick,
  );
}

// ── Announcements and toasts ───────────────────────────────────────────────────────────────

export function announce(text: string): void {
  set({ announcement: { n: state.announcement.n + 1, text } });
}

let toastId = 0;
const MAX_TOASTS = 4;

function pushToast(kind: Toast["kind"], roundId: string, text: string): void {
  if (!state.settings.toasts) return;
  set({ toasts: [...state.toasts, { id: ++toastId, kind, roundId, text }].slice(-MAX_TOASTS) });
}

export function dismissToast(id: number): void {
  set({ toasts: state.toasts.filter((t) => t.id !== id) });
}

/** Opens a Round: in the Feed when it is there, else at its own URL. */
export function openRound(id: string): void {
  if (state.rounds.some((r) => r.id === id)) {
    navigate("/");
    set({ jumpTo: id });
  } else {
    navigate(`/rounds/${id}`);
  }
}

export function clearJump(): void {
  set({ jumpTo: null });
}

function notifyNewRound(view: FeedRoundView): void {
  const text = `${view.session.callsign} · ${view.round.title}`;
  pushToast("new", view.id, text);
  const pending = state.rounds.filter((r) => r.status === "pending").length;
  announce(`New Round from ${view.session.callsign}: ${view.round.title}. ${plural(pending, "pending Round")}.`);
  browserNotify(state.settings, `New Round · ${view.session.callsign}`, view.round.title, () => openRound(view.id));
  playTone(state.settings);
}

/** Warned `round:question:deadline` keys, so each Lock warns once. */
const warned = new Set<string>();
const LOCK_WARNING_MS = 15_000;

function checkLockWarnings(): void {
  if (!state.loaded) return;
  const now = hubNow();
  for (const view of state.rounds) {
    if (view.status !== "pending") continue;
    for (const [qid, deadline] of Object.entries(view.deadlines)) {
      const left = Date.parse(deadline) - now;
      const key = `${view.id}:${qid}:${deadline}`;
      if (left <= 0 || left > LOCK_WARNING_MS || warned.has(key)) continue;
      warned.add(key);
      const index = view.round.questions.findIndex((q) => q.id === qid);
      const q = view.round.questions[index]!;
      const policy = effectivePolicy(view.round, q);
      const what =
        policy.on_timeout === "apply_recommended"
          ? `policy applies recommended: ${describeValue(q, q.kind === "single" || q.kind === "multi" ? { selected: q.recommended } : q.kind === "text" ? { text: q.recommended } : { decision: q.recommended, edited: false })}`
          : "policy cancels it";
      const prompt = q.prompt.length > 40 ? `${q.prompt.slice(0, 40)}…` : q.prompt;
      const text = `${view.session.callsign} · Q${index + 1} “${prompt}” · ${what}`;
      pushToast("lock", view.id, text);
      announce(`Lock in 15 seconds. ${text}`);
      browserNotify(state.settings, `Lock in 15 s · ${view.session.callsign}`, `Q${index + 1} “${prompt}” · ${what}`, () => openRound(view.id));
    }
  }
}

// ── Feed order: arrival order, a Superseding Round in its predecessor's slot ──────────────

/** Puts `view` in the Feed: replaced in place if present, else inserted by its queue position. */
function place(rounds: FeedRoundView[], view: FeedRoundView): FeedRoundView[] {
  const at = rounds.findIndex((r) => r.id === view.id);
  if (at >= 0) return rounds.map((r, i) => (i === at ? view : r));
  let insert = rounds.length;
  while (insert > 0 && rounds[insert - 1]!.position > view.position) insert--;
  return [...rounds.slice(0, insert), view, ...rounds.slice(insert)];
}

// ── The Human-scoped SSE stream ────────────────────────────────────────────────────────────

let source: EventSource | null = null;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
/** The Feed as it was when the stream dropped, to announce what changed while offline. */
let beforeDrop: FeedRoundView[] | null = null;
/** Failed attempts before the state reads Offline rather than Reconnecting. */
const OFFLINE_AFTER = 3;

function touched(id: string): State["touched"] {
  return { id, n: (state.touched?.n ?? 0) + 1 };
}

async function refreshAgents(): Promise<void> {
  try {
    set({ agents: await agentRoster() });
  } catch {
    // The next event or reconnect refreshes the roster.
  }
}

export async function refreshConfig(): Promise<void> {
  try {
    set({ advisors: (await fetchConfig()).advisors });
  } catch {
    // Keep the advisors we had.
  }
}

async function sync(): Promise<void> {
  const [rounds, settings] = await Promise.all([feedRounds(), fetchSettings(), refreshAgents(), refreshConfig()]);
  const before = beforeDrop;
  beforeDrop = null;
  const now = new Date(hubNow()).toISOString();
  set({ rounds, settings, connection: "live", liveSince: now, lastUpdate: now, retryIn: null, loaded: true });
  sendPermission();
  if (before) {
    const known = new Set(before.map((r) => r.id));
    const wasPending = new Set(before.filter((r) => r.status === "pending").map((r) => r.id));
    const fresh = rounds.filter((r) => r.status === "pending" && !known.has(r.id)).length;
    const expired = rounds.filter((r) => r.status === "expired" && wasPending.has(r.id)).length;
    announce(`Live · ${plural(fresh, "new Round")} · ${expired} expired while offline`);
  }
}

function scheduleRetry(): void {
  attempts += 1;
  const seconds = Math.min(15, 2 ** (attempts - 1));
  if (beforeDrop === null && state.loaded) beforeDrop = state.rounds;
  set({ connection: attempts >= OFFLINE_AFTER || !navigator.onLine ? "offline" : "reconnecting", retryIn: seconds });
  clearTimeout(retryTimer);
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => set({ retryIn: Math.max(0, (state.retryIn ?? 1) - 1) }), 1000);
  retryTimer = setTimeout(open, seconds * 1000);
}

function open(): void {
  clearTimeout(retryTimer);
  clearInterval(countdownTimer);
  source?.close();
  const events = new EventSource("/cc/events");
  source = events;
  const on = (type: string, handler: (data: unknown) => void) =>
    events.addEventListener(type, (e) => {
      set({ lastUpdate: new Date(hubNow()).toISOString() });
      handler(JSON.parse((e as MessageEvent).data));
    });

  on("hello", (data) => {
    const { server_time } = data as { server_time: string };
    offsetMs = Date.parse(server_time) - Date.now();
    attempts = 0;
    sync().catch(() => {
      events.close();
      scheduleRetry();
    });
  });
  on("round.created", (data) => {
    const { view } = data as Extract<HubEvent, { type: "round.created" }>;
    set({ rounds: place(state.rounds, view), touched: touched(view.id) });
    notifyNewRound(view);
    void refreshAgents(); // a new Round changes the roster's pending counts
  });
  on("round.superseded", (data) => {
    const { view } = data as Extract<HubEvent, { type: "round.superseded" }>;
    set({ rounds: place(state.rounds, view), touched: touched(view.id) });
    notifyNewRound(view);
    void refreshAgents();
  });
  on("round.locked", (data) => {
    const { view } = data as Extract<HubEvent, { type: "round.locked" }>;
    set({ rounds: place(state.rounds, view), touched: touched(view.id) });
  });
  on("round.ended", (data) => {
    const event = data as Extract<HubEvent, { type: "round.ended" }>;
    set({
      rounds: event.view ? place(state.rounds, event.view) : state.rounds.filter((r) => r.id !== event.round_id),
      touched: touched(event.round_id),
    });
    void refreshAgents();
  });
  on("round.removed", (data) => {
    const { round_id } = data as Extract<HubEvent, { type: "round.removed" }>;
    set({ rounds: state.rounds.filter((r) => r.id !== round_id), touched: touched(round_id) });
  });
  on("draft.saved", (data) => {
    const { round_id, draft } = data as Extract<HubEvent, { type: "draft.saved" }>;
    set({ rounds: state.rounds.map((r) => (r.id === round_id ? { ...r, draft } : r)), touched: touched(round_id) });
  });
  on("session.forgotten", () => void refreshAgents());
  // Delegation (Advisors): a run refreshes the Round in place, whatever its status.
  on("advisor.started", (data) => {
    const { view } = data as Extract<HubEvent, { type: "advisor.started" }>;
    set({ rounds: state.rounds.map((r) => (r.id === view.id ? view : r)), touched: touched(view.id) });
  });
  on("advisor.ended", (data) => {
    const { view } = data as Extract<HubEvent, { type: "advisor.ended" }>;
    set({ rounds: state.rounds.map((r) => (r.id === view.id ? view : r)), touched: touched(view.id) });
    const run = view.advisor_runs[0];
    if (run?.status === "succeeded" && run.suggestion && view.status === "pending") {
      const text = `${view.session.callsign} · ${run.advisor_name} returned a Suggestion`;
      pushToast("suggestion", view.id, text);
      announce(`Suggestion ready. ${text}.`);
      browserNotify(state.settings, `Suggestion ready · ${view.session.callsign}`, `${run.advisor_name} returned a Suggestion`, () => openRound(view.id));
    }
  });
  on("settings.changed", (data) => {
    const { settings } = data as Extract<HubEvent, { type: "settings.changed" }>;
    set(settings.toasts ? { settings } : { settings, toasts: [] });
  });
  events.onerror = () => {
    events.close();
    if (source === events) scheduleRetry();
  };
}

/** "Reconnect now": skips the wait before the next attempt. */
export function reconnectNow(): void {
  attempts = Math.max(0, attempts - 1);
  set({ connection: "reconnecting", retryIn: null });
  open();
}

/** A settings change from this tab, applied at once (the Hub echoes it to other tabs). */
export function applySettings(settings: HubSettings): void {
  set(settings.toasts ? { settings } : { settings, toasts: [] });
}

export function connect(): void {
  window.addEventListener("offline", () => set({ connection: "offline" }));
  window.addEventListener("online", () => {
    if (state.connection !== "live") reconnectNow();
  });
  // A page leaving (reload, navigation, back/forward cache) closes its stream at once, so old
  // documents never hold one of the browser's six connections to the Hub.
  window.addEventListener("pagehide", () => {
    clearTimeout(retryTimer);
    clearInterval(countdownTimer);
    source?.close();
    source = null;
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) reconnectNow();
  });
  open();
}
