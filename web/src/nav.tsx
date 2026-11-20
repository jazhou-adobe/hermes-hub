import { navigate, usePath } from "./router.ts";

const LINKS: [string, string][] = [
  ["/", "Feed"],
  ["/agents", "Agents"],
];

export function Nav() {
  const path = usePath();
  return (
    <nav className="nav">
      {LINKS.map(([href, label]) => (
        <a
          key={href}
          href={href}
          aria-current={path === href ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(href);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
