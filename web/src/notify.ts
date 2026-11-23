import { notificationsAllowed, type HubSettings } from "../../src/settings.ts";
import { reportPermission } from "./api.ts";

export type Permission = "granted" | "denied" | "default" | "unsupported";

export function browserPermission(): Permission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Tells the Hub this tab's permission, so it posts the macOS fallback when the browser refused (hub-operations spec). */
export function sendPermission(): void {
  const p = browserPermission();
  void reportPermission(p === "unsupported" ? "denied" : p).catch(() => {});
}

export async function requestPermission(): Promise<Permission> {
  if (typeof Notification === "undefined") return "unsupported";
  const result = await Notification.requestPermission();
  sendPermission();
  return result;
}

/** The tab is in front of the Human: browser notifications are suppressed then (the toast still shows). */
function tabInFront(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** A browser notification, unless muted, in quiet hours, unsupported, refused, or the tab is in front. */
export function browserNotify(settings: HubSettings, title: string, body: string, onOpen: () => void): void {
  if (browserPermission() !== "granted" || tabInFront()) return;
  if (!notificationsAllowed(settings, new Date())) return;
  const n = new Notification(title, { body, tag: `${title}:${body}` });
  n.onclick = () => {
    window.focus();
    onOpen();
    n.close();
  };
}

let audio: AudioContext | undefined;

/** One short tone on a new Round (hub-operations spec: optional, off by default; quiet hours silence it). */
export function playTone(settings: HubSettings): void {
  if (!settings.sound || !notificationsAllowed(settings, new Date())) return;
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.2);
  } catch {
    // Audio may be blocked until the Human interacts with the page; the toast still shows.
  }
}
