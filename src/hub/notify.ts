import { effectivePolicy } from "../schema/policy.ts";
import { notificationsAllowed } from "../settings.ts";
import type { Clock, Engine, FeedRoundView, HubEvent } from "./engine.ts";
import { noopLogger, type Logger } from "./log.ts";

/** How long before a Lock the Human is warned (command-center spec: "a Round's next Lock is 15 s away"). */
export const LOCK_WARNING_MS = 15_000;
/** Re-check far-off warnings at least this often, so a long timer never overflows. */
const MAX_TIMER_MS = 60 * 60_000;

export type BrowserPermission = "granted" | "denied" | "default";

export interface HubNotification {
  /** The event, in words: "New Round", "Lock in 15 s", "Suggestion ready". */
  title: string;
  /** The callsign of the Agent that asked. */
  subtitle: string;
  message: string;
}

export type PostNotification = (n: HubNotification) => void;

const systemClock: Clock = { now: () => Date.now() };

/**
 * The macOS fallback (hub-operations spec): when no Command Center tab is open, or the browser
 * denied notifications, the Hub posts the notifications the tab would have shown. Mute and quiet
 * hours apply here too. Agent gone and policy outcomes never notify.
 */
export class Notifier {
  private clients = 0;
  private permission: BrowserPermission | null = null;
  /** `round:question:deadline` keys already warned, so a warning fires once per deadline. */
  private readonly warned = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly engine: Engine,
    private readonly post: PostNotification,
    private readonly clock: Clock = systemClock,
    private readonly logger: Logger = noopLogger,
  ) {}

  start(): void {
    this.unsubscribe = this.engine.subscribe((e) => this.onEvent(e));
    this.checkLocks();
  }

  stop(): void {
    this.unsubscribe?.();
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** A Command Center stream opened; call the returned function when it closes. */
  clientOpened(): () => void {
    this.clients += 1;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.clients -= 1;
    };
  }

  /** The tab's `Notification.permission`, reported when it connects and whenever it changes. */
  setBrowserPermission(permission: BrowserPermission): void {
    this.permission = permission;
  }

  /** Whether the Hub posts notifications itself right now. */
  fallbackActive(): boolean {
    return this.clients === 0 || this.permission === "denied";
  }

  private notify(n: HubNotification): void {
    if (!this.fallbackActive()) return;
    if (!notificationsAllowed(this.engine.settings(), new Date(this.clock.now()))) return;
    try {
      this.post(n);
      this.logger.log("info", "notification.posted", { title: n.title });
    } catch (err) {
      this.logger.log("error", "notification.failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private onEvent(e: HubEvent): void {
    switch (e.type) {
      case "round.created":
      case "round.superseded":
        this.notify({ title: "New Round", subtitle: e.view.session.callsign, message: e.view.round.title });
        this.checkLocks();
        break;
      case "advisor.ended": {
        const run = e.view.advisor_runs[0];
        if (run?.status === "succeeded" && run.suggestion) {
          this.notify({ title: "Suggestion ready", subtitle: e.view.session.callsign, message: `${run.advisor_name} returned a Suggestion` });
        }
        break;
      }
      case "round.locked":
      case "round.ended":
      case "session.forgotten":
        this.checkLocks();
        break;
      default:
        break;
    }
  }

  /** Warns for every open Question whose Lock is 15 s or less away, then waits for the next one. */
  checkLocks(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.clock.now();
    const live = new Set<string>();
    let next = Infinity;
    for (const view of this.engine.feed()) {
      if (view.status !== "pending") continue;
      for (const [qid, deadline] of Object.entries(view.deadlines)) {
        const key = `${view.id}:${qid}:${deadline}`;
        live.add(key);
        const at = Date.parse(deadline);
        if (at <= now) continue;
        if (at - now <= LOCK_WARNING_MS) {
          if (!this.warned.has(key)) {
            this.warned.add(key);
            this.notify(lockWarning(view, qid));
          }
        } else {
          next = Math.min(next, at - LOCK_WARNING_MS - now);
        }
      }
    }
    for (const key of this.warned) if (!live.has(key)) this.warned.delete(key);
    if (next !== Infinity) this.timer = setTimeout(() => this.checkLocks(), Math.min(next, MAX_TIMER_MS));
  }
}

/** "Q1 “Which paper sizes…” · policy applies recommended" (the toast's wording, command-center spec). */
function lockWarning(view: FeedRoundView, qid: string): HubNotification {
  const index = view.round.questions.findIndex((q) => q.id === qid);
  const q = view.round.questions[index]!;
  const prompt = q.prompt.length > 40 ? `${q.prompt.slice(0, 40)}…` : q.prompt;
  const policy = effectivePolicy(view.round, q);
  const action = policy.on_timeout === "apply_recommended" ? "policy applies recommended" : "policy cancels it";
  return { title: "Lock in 15 s", subtitle: view.session.callsign, message: `Q${index + 1} “${prompt}” · ${action}` };
}

/** An AppleScript string literal. */
function appleString(s: string): string {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The `display notification` script for one notification (title and callsign, hub-operations spec). */
export function osascriptFor(n: HubNotification): string {
  return `display notification ${appleString(n.message)} with title ${appleString(`Hermes Hub · ${n.title}`)} subtitle ${appleString(n.subtitle)}`;
}

/** Posts through `osascript` on macOS; null elsewhere (there is no fallback on other systems). */
export function osascriptPoster(): PostNotification | null {
  if (process.platform !== "darwin") return null;
  return (n) => {
    Bun.spawn(["osascript", "-e", osascriptFor(n)], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  };
}
