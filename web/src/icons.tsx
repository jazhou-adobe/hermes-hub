import PATHS from "../design-system/preview/hermes-icons.json";

/** The design system's line icons (preview/hermes-icons.json), stroked by .hh-icon. Decorative: every icon sits beside a text label. */
export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="hh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
