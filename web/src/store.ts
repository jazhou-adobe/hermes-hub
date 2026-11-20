import { useSyncExternalStore } from "react";
import type { AgentView, FeedRoundView, HubEvent } from "../../src/hub/engine.ts";
import { agentRoster, feedRounds } from "./api.ts";

export interface State {
  rounds: FeedRoundView[];
  agents: AgentView[];
  connection: "connecting" | "live" | "lost";
}

let state: State = { rounds: [], agents: [], connection: "connecting" };
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Selectors must return values already in the state (stable references). */
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

async function refreshAgents(): Promise<void> {
  set({ agents: await agentRoster() });
}

function upsert(view: FeedRoundView): FeedRoundView[] {
  const rest = state.rounds.filter((r) => r.id !== view.id);
  return view.status === "pending" || view.answer === null ? [...rest, view] : rest;
}

/** Snapshot on every (re)connect, then patch in place from the Human-scoped SSE stream. */
export function connect(): void {
  const events = new EventSource("/cc/events");
  events.addEventListener("hello", async () => {
    try {
      const [rounds] = await Promise.all([feedRounds(), refreshAgents()]);
      set({ rounds, connection: "live" });
    } catch {
      set({ connection: "lost" });
    }
  });
  const onView = (e: MessageEvent) => {
    const event: Extract<HubEvent, { view: FeedRoundView }> = JSON.parse(e.data);
    set({ rounds: upsert(event.view) });
  };
  events.addEventListener("round.created", (e) => {
    onView(e);
    void refreshAgents(); // a new Round changes the roster's pending counts
  });
  events.addEventListener("round.locked", onView);
  events.addEventListener("round.superseded", onView);
  events.addEventListener("round.ended", (e) => {
    const event: Extract<HubEvent, { type: "round.ended" }> = JSON.parse(e.data);
    set({ rounds: event.view ? upsert(event.view) : state.rounds.filter((r) => r.id !== event.round_id) });
    void refreshAgents();
  });
  events.addEventListener("round.removed", (e) => {
    const event: Extract<HubEvent, { type: "round.removed" }> = JSON.parse(e.data);
    set({ rounds: state.rounds.filter((r) => r.id !== event.round_id) });
  });
  events.addEventListener("draft.saved", (e) => {
    const event: Extract<HubEvent, { type: "draft.saved" }> = JSON.parse(e.data);
    set({ rounds: state.rounds.map((r) => (r.id === event.round_id ? { ...r, draft: event.draft } : r)) });
  });
  events.addEventListener("session.forgotten", () => void refreshAgents());
  events.onerror = () => set({ connection: "lost" });
}
