import { useSyncExternalStore } from "react";
import type { HubEvent, PendingRoundView } from "../../src/hub/engine.ts";
import { pendingRounds } from "./api.ts";

export interface State {
  rounds: PendingRoundView[];
  connection: "connecting" | "live" | "lost";
}

let state: State = { rounds: [], connection: "connecting" };
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

/** Snapshot on every (re)connect, then patch in place from the Human-scoped SSE stream. */
export function connect(): void {
  const events = new EventSource("/cc/events");
  events.addEventListener("hello", async () => {
    try {
      set({ rounds: await pendingRounds(), connection: "live" });
    } catch {
      set({ connection: "lost" });
    }
  });
  events.addEventListener("round.created", (e) => {
    const event: Extract<HubEvent, { type: "round.created" }> = JSON.parse(e.data);
    if (!state.rounds.some((r) => r.id === event.round.id)) set({ rounds: [...state.rounds, event.round] });
  });
  events.addEventListener("round.ended", (e) => {
    const event: Extract<HubEvent, { type: "round.ended" }> = JSON.parse(e.data);
    set({ rounds: state.rounds.filter((r) => r.id !== event.round_id) });
  });
  events.onerror = () => set({ connection: "lost" });
}
