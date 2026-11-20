import { useEffect, useState } from "react";

/** A tiny History-API router: just enough to switch between the Feed and the answered log. */
function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
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
