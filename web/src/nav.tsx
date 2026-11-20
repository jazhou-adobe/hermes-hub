import type { MouseEvent, ReactNode } from "react";
import { navigate, usePath } from "./router.ts";

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const path = usePath();
  return (
    <a
      href={to}
      aria-current={path === to ? "page" : undefined}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Nav() {
  return (
    <nav className="nav">
      <NavLink to="/">Feed</NavLink>
      <NavLink to="/log">Log</NavLink>
    </nav>
  );
}
