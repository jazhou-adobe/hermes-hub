import { useEffect, useState } from "react";

/** A tiny History-API router for the five Command Center routes: /, /rounds/:id, /log, /agents, /settings. */
export type Route =
  | { name: "feed" }
  | { name: "round"; id: string }
  | { name: "log" }
  | { name: "agents" }
  | { name: "settings" }
  | { name: "not-found" };

function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function parseRoute(path: string): Route {
  const p = normalize(path);
  if (p === "/") return { name: "feed" };
  if (p === "/log") return { name: "log" };
  if (p === "/agents") return { name: "agents" };
  if (p === "/settings") return { name: "settings" };
  const round = /^\/rounds\/([^/]+)$/.exec(p);
  if (round) return { name: "round", id: decodeURIComponent(round[1]!) };
  return { name: "not-found" };
}

let current = normalize(location.pathname);
const listeners = new Set<() => void>();

function set(path: string): void {
  current = normalize(path);
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", () => set(location.pathname));

export function navigate(path: string): void {
  if (normalize(path) === current) return;
  history.pushState({}, "", path);
  set(path);
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const listener = () => setPath(current);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return path;
}

/** A click handler for in-app links: plain left clicks navigate in place; modified clicks behave as usual. */
export function linkClick(to: string) {
  return (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number; preventDefault(): void }) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
}
