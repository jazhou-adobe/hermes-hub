/**
 * The Command Center's live settings (hub-operations spec: "Live in the Command Center: stored in the
 * database"). Shared by the Hub and the browser bundle, so this module has no Node or Bun imports.
 */

export const THEMES = ["hermes-flight-director", "hermes-dark", "hermes-light"] as const;
export type Theme = (typeof THEMES)[number];

/** Flight Director colour options; "" is the default, Console slate (no `data-palette`). */
export const PALETTES = ["", "night-watch", "day-shift", "original"] as const;
export type Palette = (typeof PALETTES)[number];

export interface QuietHours {
  enabled: boolean;
  /** Local wall-clock time, `HH:MM`. */
  from: string;
  to: string;
}

export interface HubSettings {
  /** The mute switch: off silences browser and macOS notifications. */
  notifications: boolean;
  /** The in-page toasts (New Round, Lock in 15 s, Suggestion ready). The live region still announces. */
  toasts: boolean;
  quiet_hours: QuietHours;
  /** One short tone in the Command Center tab on a new Round. Off by default. */
  sound: boolean;
  theme: Theme;
  palette: Palette;
  /** Single-key shortcuts (j/k, 1–9, a/r, n, d, e, v, ?). `⌘↵` always works. */
  shortcuts: boolean;
}

export const DEFAULT_SETTINGS: HubSettings = {
  notifications: true,
  toasts: true,
  quiet_hours: { enabled: false, from: "22:00", to: "07:00" },
  sound: false,
  theme: "hermes-flight-director",
  palette: "",
  shortcuts: true,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Applies a partial update to `current`, or returns an error message. Unknown keys and wrong types
 * are refused, never ignored, so a typo in a client never silently drops a setting.
 */
export function mergeSettings(current: HubSettings, patch: unknown): HubSettings | string {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return "the body must be an object";
  const next: HubSettings = { ...current, quiet_hours: { ...current.quiet_hours } };
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case "notifications":
      case "toasts":
      case "sound":
      case "shortcuts":
        if (typeof value !== "boolean") return `${key} must be true or false`;
        next[key] = value;
        break;
      case "theme":
        if (!(THEMES as readonly unknown[]).includes(value)) return `theme must be one of ${THEMES.join(", ")}`;
        next.theme = value as Theme;
        break;
      case "palette":
        if (!(PALETTES as readonly unknown[]).includes(value)) return `palette must be one of ${PALETTES.filter(Boolean).join(", ")} or ""`;
        next.palette = value as Palette;
        break;
      case "quiet_hours": {
        if (!value || typeof value !== "object" || Array.isArray(value)) return "quiet_hours must be an object";
        for (const [k, v] of Object.entries(value)) {
          if (k === "enabled") {
            if (typeof v !== "boolean") return "quiet_hours.enabled must be true or false";
            next.quiet_hours.enabled = v;
          } else if (k === "from" || k === "to") {
            if (typeof v !== "string" || !TIME.test(v)) return `quiet_hours.${k} must be HH:MM`;
            next.quiet_hours[k] = v;
          } else {
            return `unknown setting quiet_hours.${k}`;
          }
        }
        break;
      }
      default:
        return `unknown setting ${key}`;
    }
  }
  return next;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** True while `at` (local time) falls in the quiet hours; a range like 22:00–07:00 wraps past midnight. */
export function inQuietHours(q: QuietHours, at: Date): boolean {
  if (!q.enabled) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  const from = minutes(q.from);
  const to = minutes(q.to);
  if (from === to) return true; // a full day
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Whether a notification may be shown or posted now: not muted and outside the quiet hours. */
export function notificationsAllowed(s: HubSettings, at: Date): boolean {
  return s.notifications && !inQuietHours(s.quiet_hours, at);
}
