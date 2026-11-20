import { useSyncExternalStore } from "react";
import type { FeedRoundView, HubEvent } from "../../src/hub/engine.ts";
import { feedRounds } from "./api.ts";

export interface State {
  rounds: FeedRoundView[];
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

function upsert(view: FeedRoundView): FeedRoundView[] {
  const rest = state.rounds.filter((r) => r.id !== view.id);
  return view.status === "pending" || view.answer === null ? [...rest, view] : rest;
}

/** Replaces a Round already in the Feed with a fresher view; a Round not present is left alone. */
function replaceInPlace(view: FeedRoundView): FeedRoundView[] {
  return state.rounds.map((r) => (r.id === view.id ? view : r));
}

/** Snapshot on every (re)connect, then patch in place from the Human-scoped SSE stream. */
export function connect(): void {
  const events = new EventSource("/cc/events");
  events.addEventListener("hello", async () => {
    try {
      set({ rounds: await feedRounds(), connection: "live" });
    } catch {
      set({ connection: "lost" });
    }
  });
  const onView = (e: MessageEvent) => {
    const event: Extract<HubEvent, { view: FeedRoundView }> = JSON.parse(e.data);
    set({ rounds: upsert(event.view) });
  };
  events.addEventListener("round.created", onView);
  events.addEventListener("round.locked", onView);
  events.addEventListener("round.superseded", onView);
  events.addEventListener("round.ended", (e) => {
    const event: Extract<HubEvent, { type: "round.ended" }> = JSON.parse(e.data);
    set({ rounds: event.view ? upsert(event.view) : state.rounds.filter((r) => r.id !== event.round_id) });
  });
  events.addEventListener("round.removed", (e) => {
    const event: Extract<HubEvent, { type: "round.removed" }> = JSON.parse(e.data);
    set({ rounds: state.rounds.filter((r) => r.id !== event.round_id) });
  });
  events.addEventListener("draft.saved", (e) => {
    const event: Extract<HubEvent, { type: "draft.saved" }> = JSON.parse(e.data);
    set({ rounds: state.rounds.map((r) => (r.id === event.round_id ? { ...r, draft: event.draft } : r)) });
  });
  // Delegation (Advisors): a started or ended run refreshes the Round in place, keeping an
  // ended-in-place Round visible regardless of its Outcome (unlike `upsert`, used for pending-only views).
  const onAdvisorView = (e: MessageEvent) => {
    const event: Extract<HubEvent, { type: "advisor.started" | "advisor.ended" }> = JSON.parse(e.data);
    set({ rounds: replaceInPlace(event.view) });
  };
  events.addEventListener("advisor.started", onAdvisorView);
  events.addEventListener("advisor.ended", onAdvisorView);
  events.onerror = () => set({ connection: "lost" });
}
