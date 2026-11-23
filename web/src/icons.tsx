/** The icon set the Feed preview uses (web/preview/index.html), drawn as stroked 24 px paths. */
const PATHS = {
  check: "M4 12.5l5 5L20 6.5",
  x: "M6 6l12 12M18 6L6 18",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3.5 2",
  "chevron-down": "M6 9l6 6l6-6",
  "chevron-right": "M9 6l6 6l-6 6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  code: "M9 7l-5 5l5 5M15 7l5 5l-5 5",
  diff: "M6 4v10M1 9h10M14 17h9M17 4h4v4",
  keyboard: "M3 6h18v12H3zM7 10h1M11 10h1M15 10h1M7 14h10",
  alert: "M12 3l10 18H2zM12 10v5M12 18v.5",
  user: "M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  settings: "M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  send: "M4 12l16-8l-6 16l-3-7z",
  lock: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
  refresh: "M20 6v5h-5M4 18v-5h5M18.5 11A7 7 0 0 0 6 7.5M5.5 13A7 7 0 0 0 18 16.5",
  bay: "M3 4h18v4H3zM3 10h18v4H3zM3 16h18v4H3z",
  "arrow-right": "M4 12h16M14 6l6 6l-6 6",
  "arrow-left": "M20 12H4M10 6l-6 6l6 6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="hh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
