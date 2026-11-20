import type { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type AutoAskRule, type HubConfig } from "../config.ts";
import { HubError } from "../errors.ts";
import { canonicalJson, effectivePolicy, hubChecks, oversizedAttachment } from "../schema/checks.ts";
import type { Answer, Outcome, PendingStatus, QuestionValue, Round } from "../schema/types.ts";
import {
  isDismissInput,
  isDraft,
  isRedirectInput,
  isSendInput,
  isSessionRequest,
  validateRound,
  validationIssues,
  type Draft,
  type SessionRequest,
} from "../schema/validate.ts";
import { VERSION } from "../version.ts";
import {
  buildPrompt,
  capOutput,
  draftHasValue,
  extractLastJsonObject,
  parseSuggestion,
  type AdvisorRunView,
  type Suggestion,
} from "./advisors.ts";
import { answerQuestions, lockValue, parseHumanValue, type Locks } from "./answers.ts";
import { callsign, project } from "./callsign.ts";
import { noopLogger, type Logger } from "./log.ts";

export type { AdvisorRunView, Suggestion } from "./advisors.ts";

export interface SessionRow {
  id: string;
  token: string;
  kind: string;
  session_key: string;
  label: string | null;
  cwd: string | null;
}

interface RoundRow {
  id: string;
  session_id: string;
  status: "pending" | Outcome;
  round: string;
  answer: string | null;
  received_at: string;
  decided_at: string | null;
  delivered_at: string | null;
  position: number;
  idempotency_key: string | null;
  body_hash: string | null;
  locks: string;
  draft: string | null;
  feed_removed_at: string | null;
  /** The Round's current valid Suggestion (delegation spec), JSON; cleared when the Round ends. */
  suggestion: string | null;
}

interface AdvisorRunRow {
  id: string;
  round_id: string;
  advisor_name: string;
  trigger: "manual" | "auto";
  brief: string | null;
  started_at: string;
  ended_at: string | null;
  status: AdvisorRunView["status"];
  raw_output: string | null;
  suggestion: string | null;
}

/** A Round as the Command Center sees it: pending, or ended in place (expired, cancelled, superseded). */
export interface FeedRoundView {
  id: string;
  status: "pending" | Outcome;
  position: number;
  received_at: string;
  session: { id: string; kind: string; callsign: string };
  round: Round;
  locks: Locks;
  /** Absolute deadlines of open Questions, by Question id. */
  deadlines: Record<string, string>;
  draft: Draft | null;
  answer: Answer | null;
  /** Advisor runs for this Round, most recent first (delegation spec: History). */
  advisor_runs: AdvisorRunView[];
  /** The Round's current valid Suggestion, if any (delegation spec). */
  suggestion: Suggestion | null;
}

export type HubEvent =
  | { type: "round.created"; view: FeedRoundView }
  | { type: "round.locked"; view: FeedRoundView }
  /** `view` is set when the Round stays in the Feed (ended in place); null when it leaves for the log. */
  | { type: "round.ended"; round_id: string; answer: Answer; view: FeedRoundView | null }
  /** A new Round took the place of `replaces`. */
  | { type: "round.superseded"; replaces: string; view: FeedRoundView }
  | { type: "round.removed"; round_id: string }
  | { type: "draft.saved"; round_id: string; draft: Draft }
  /** An Advisor run started on this Round (delegation spec); `view.advisor_runs[0]` is the new run. */
  | { type: "advisor.started"; view: FeedRoundView }
  /** An Advisor run ended (succeeded, failed, timed out or was cancelled). */
  | { type: "advisor.ended"; view: FeedRoundView };

/** Filters for the answered log; present fields combine with AND (answered-log spec). */
export interface LogFilter {
  outcome?: Outcome;
  session_id?: string;
  callsign?: string;
  project?: string;
  /** `decided_at >= from` */
  from?: string;
  /** `decided_at <= to` */
  to?: string;
  /** Free-text query over `log_fts`. */
  q?: string;
  limit?: number;
}

export interface LogMeta {
  round_id: string;
  callsign: string;
  project: string | null;
  received_at: string;
  delivered_at: string | null;
  superseded_by?: string;
}

/** One ended Round as the answered log shows it: `{round, answer, meta}` plus the Draft snapshot
 * and, for a free-text search, the matched snippet with `<mark>` highlights. */
export interface LogEntry {
  round: Round;
  answer: Answer;
  meta: LogMeta;
  draft: Draft | null;
  snippet?: string;
}

/** Round content never reaches the log (logs spec): just ids, event names, callsigns, outcomes. */
function logFieldsFor(e: HubEvent): Record<string, unknown> {
  switch (e.type) {
    case "round.created":
    case "round.locked":
      return { round_id: e.view.id, session_id: e.view.session.id, callsign: e.view.session.callsign };
    case "round.ended":
      return { round_id: e.round_id, outcome: e.answer.outcome };
    case "round.superseded":
      return { round_id: e.view.id, replaces: e.replaces };
    case "round.removed":
      return { round_id: e.round_id };
    case "draft.saved":
      return { round_id: e.round_id };
    case "advisor.started":
    case "advisor.ended":
      return { round_id: e.view.id, callsign: e.view.session.callsign };
  }
}

export interface Clock {
  now(): number;
}

const systemClock: Clock = { now: () => Date.now() };
const SUPPORTED_SCHEMAS = ["hermes.round/v1"];
const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** Re-check deadlines at least this often, so a far-off timer never overflows. */
const MAX_TIMER_MS = 60 * 60_000;
/** Outcomes the Human chose: the Round leaves the Feed at once. The others end in place. */
const LEAVES_FEED: Record<Outcome, boolean> = {
  answered: true,
  dismissed: true,
  redirected: true,
  expired: false,
  cancelled: false,
};
/** Grace period between SIGTERM and SIGKILL, for both a timeout and a Cancel (delegation spec). */
const SIGKILL_GRACE_MS = 5000;

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let id = prefix;
  for (const b of bytes) id += ID_ALPHABET[b & 31];
  return id;
}

/** A tracked, still-running Advisor process; at most one per Round (delegation spec). */
interface RunningAdvisor {
  run_id: string;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  /** Set when Cancel or the Round ending asked this run to stop. */
  cancelled: boolean;
  /** Set when its own `timeout_seconds` fired first. */
  timedOut: boolean;
  timeoutTimer: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
}

/** The Round engine: every door (HTTP, MCP, CLI) maps onto these operations. */
export class Engine {
  private readonly listeners = new Set<(e: HubEvent) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The one running Advisor process per Round, if any (delegation spec). */
  private readonly runningAdvisors = new Map<string, RunningAdvisor>();

  constructor(
    private readonly db: Database,
    private readonly baseUrl: string,
    private readonly clock: Clock = systemClock,
    private config: HubConfig = DEFAULT_CONFIG,
    private readonly logger: Logger = noopLogger,
  ) {}

  /** Applies a hot-reloaded `config.toml` (the caller, `src/hub/run.ts`, keeps the bound port). */
  setConfig(config: HubConfig): void {
    this.config = config;
  }

  private get limits() {
    return this.config.limits;
  }

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  subscribe(listener: (e: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(events: HubEvent[]): void {
    for (const event of events) {
      this.logger.log("info", event.type, logFieldsFor(event));
      for (const listener of this.listeners) listener(event);
    }
  }

  /** Fires overdue policies (after a restart, in deadline order), then keeps a timer on the next deadline. */
  start(): void {
    this.fireDue();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  hubInfo() {
    const row = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'hub_id'").get();
    return { hub_id: row!.value, version: VERSION, schemas: SUPPORTED_SCHEMAS, limits: this.limits };
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  /** `POST /v1/sessions`: idempotent on (kind, session key); latest label, cwd and git win. */
  upsertSession(body: unknown): { session_id: string; token: string; callsign: string } {
    if (!isSessionRequest(body)) {
      throw new HubError("invalid_round", "invalid session request", { errors: validationIssues(isSessionRequest.errors) });
    }
    const req: SessionRequest = body;
    const t = this.now();
    const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
    const row = this.db
      .query<SessionRow, Record<string, string | null>>(
        `INSERT INTO sessions (id, token, kind, session_key, label, cwd, git, host, client_version, detection, signals, created_at, last_seen)
         VALUES ($id, $token, $kind, $session_key, $label, $cwd, $git, $host, $client_version, $detection, $signals, $t, $t)
         ON CONFLICT (kind, session_key) DO UPDATE SET
           label = excluded.label, cwd = excluded.cwd, git = excluded.git, host = excluded.host,
           client_version = excluded.client_version, detection = excluded.detection, signals = excluded.signals,
           last_seen = excluded.last_seen
         RETURNING id, token, kind, session_key, label, cwd`,
      )
      .get({
        id: newId("s_"),
        token: `hhs_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`,
        kind: req.kind,
        session_key: req.session_key,
        label: req.label ?? null,
        cwd: req.cwd ?? null,
        git: json(req.git),
        host: req.host ?? null,
        client_version: req.client_version ?? null,
        detection: json(req.detection),
        signals: json(req.signals),
        t,
      })!;
    return { session_id: row.id, token: row.token, callsign: callsign(row) };
  }

  /** Resolves the `Hermes-Session` token and marks the session seen. */
  sessionFor(token: string | null): SessionRow {
    const row = token
      ? this.db
          .query<SessionRow, [string, string]>(
            "UPDATE sessions SET last_seen = ? WHERE token = ? RETURNING id, token, kind, session_key, label, cwd",
          )
          .get(this.now(), token)
      : null;
    if (!row) throw new HubError("unknown_session", "missing or unknown Hermes-Session token; call POST /v1/sessions");
    return row;
  }

  // ── Agent operations ────────────────────────────────────────────────────

  /**
   * submit: validate, apply idempotency and `supersedes`, check the flood cap, persist.
   * `bodyBytes` is the size of the submitted document as received.
   */
  submit(
    session: SessionRow,
    doc: unknown,
    bodyBytes: number,
  ): { round_id: string; url: string; status: "pending" | Outcome; replay: boolean } {
    if (bodyBytes > this.limits.round_bytes) {
      throw new HubError("too_large", `the Round is over ${this.limits.round_bytes} bytes`, { limit: this.limits.round_bytes, pointer: "" });
    }
    const schema = doc && typeof doc === "object" && "schema" in doc ? doc.schema : undefined;
    if (typeof schema === "string" && /^hermes\.round\/v\d+$/.test(schema) && !SUPPORTED_SCHEMAS.includes(schema)) {
      throw new HubError("unsupported_schema", `unsupported schema ${schema}`, { supported: SUPPORTED_SCHEMAS });
    }
    const schemaErrors = validateRound(doc);
    if (schemaErrors.length) throw new HubError("invalid_round", "the Round does not match hermes.round/v1", { errors: schemaErrors });
    const round = doc as Round; // validated against the schema above
    const errors = hubChecks(round);
    if (errors.length) throw new HubError("invalid_round", "the Round failed the Hub's checks", { errors });
    const oversized = oversizedAttachment(round, this.limits);
    if (oversized !== undefined) {
      throw new HubError("too_large", `attachment ${oversized} is over ${this.limits.attachment_bytes} bytes`, {
        limit: this.limits.attachment_bytes,
        pointer: oversized,
      });
    }

    const bodyHash = new Bun.CryptoHasher("sha256").update(canonicalJson(round)).digest("hex");
    if (round.idempotency_key !== undefined) {
      const existing = this.db
        .query<RoundRow, [string, string]>("SELECT * FROM rounds WHERE session_id = ? AND idempotency_key = ?")
        .get(session.id, round.idempotency_key);
      if (existing) {
        if (existing.body_hash !== bodyHash) {
          throw new HubError("idempotency_conflict", "this idempotency_key was used with a different Round", {
            round_id: existing.id,
          });
        }
        return { round_id: existing.id, url: this.roundUrl(existing.id), status: existing.status, replay: true };
      }
    }

    const id = newId("r_");
    const events: HubEvent[] = [];
    this.db.transaction(() => {
      let position = this.clock.now();
      let draft: Draft | null = null;
      if (round.supersedes !== undefined) {
        const old = this.ownRound(session, round.supersedes);
        if (old.status !== "pending") {
          throw new HubError("round_ended", `Round ${old.id} has already ended; collect its Answer`, {
            round_id: old.id,
            outcome: old.status,
          });
        }
        position = old.position;
        draft = carryDraft(JSON.parse(old.round), parseDraft(old.draft), round);
        events.push(this.end(old, "cancelled", { cancelled_by: "agent", superseded_by: id }));
      }
      const pending = this.db
        .query<{ n: number; oldest: string | null }, [string]>(
          `SELECT count(*) AS n, (SELECT id FROM rounds WHERE session_id = ?1 AND status = 'pending' ORDER BY received_at, rowid LIMIT 1) AS oldest
           FROM rounds WHERE session_id = ?1 AND status = 'pending'`,
        )
        .get(session.id)!;
      if (pending.n >= this.limits.pending_per_session) {
        throw new HubError("flood_cap", `this session already has ${pending.n} pending Rounds`, {
          limit: this.limits.pending_per_session,
          oldest_round_id: pending.oldest,
        });
      }
      const received_at = this.now();
      this.db
        .query(
          `INSERT INTO rounds (id, session_id, status, round, received_at, position, idempotency_key, body_hash, draft)
           VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, session.id, JSON.stringify(round), received_at, position, round.idempotency_key ?? null, bodyHash, draft && JSON.stringify(draft));
      const insertDeadline = this.db.query("INSERT INTO question_deadlines (round_id, question_id, deadline) VALUES (?, ?, ?)");
      for (const q of round.questions) {
        const policy = effectivePolicy(round, q);
        if (policy.on_timeout === "wait") continue;
        insertDeadline.run(id, q.id, new Date(Date.parse(received_at) + policy.after_seconds * 1000).toISOString());
      }
      const view = this.view(id)!;
      events.push(round.supersedes === undefined ? { type: "round.created", view } : { type: "round.superseded", replaces: round.supersedes, view });
    })();
    this.emit(events);
    this.schedule();
    const rule = this.matchAutoAsk(session);
    if (rule) {
      try {
        this.askAdvisor(id, rule.advisor, rule.brief, "auto");
      } catch (err) {
        console.error(`hermes hub: auto-ask rule for Advisor "${rule.advisor}" failed to start on Round ${id}:`, err);
      }
    }
    return { round_id: id, url: this.roundUrl(id), status: "pending", replay: false };
  }

  /** get: pending status with the next deadline, or the Answer once ended. The first Answer returned marks delivery. */
  get(session: SessionRow, id: string): Answer | PendingStatus {
    const row = this.ownRound(session, id);
    if (row.status === "pending") return { status: "pending", next_deadline: this.nextDeadline(id) };
    return this.deliver(row);
  }

  /** wait: like get, but holds until the Round ends or `seconds` pass. */
  wait(session: SessionRow, id: string, seconds: number, signal?: AbortSignal): Promise<Answer | PendingStatus> {
    const first = this.get(session, id);
    if (!("status" in first)) return Promise.resolve(first);
    const { promise, resolve } = Promise.withResolvers<Answer | PendingStatus>();
    const finish = () => {
      clearTimeout(timer);
      off();
      signal?.removeEventListener("abort", finish);
      resolve(this.get(session, id));
    };
    const timer = setTimeout(finish, seconds * 1000);
    const off = this.subscribe((e) => {
      if (e.type === "round.ended" && e.round_id === id) finish();
    });
    signal?.addEventListener("abort", finish);
    return promise;
  }

  /** cancel: the Agent cancels its own pending Round. */
  cancel(session: SessionRow, id: string): Answer {
    const row = this.ownRound(session, id);
    if (row.status !== "pending") {
      throw new HubError("round_ended", `Round ${id} has already ended`, { round_id: id, outcome: row.status });
    }
    const event = this.db.transaction(() => this.end(row, "cancelled", { cancelled_by: "agent" }))();
    this.emit([event]);
    this.schedule();
    return this.deliver(this.row(id)!);
  }

  /** inbox: the session's ended, undelivered Answers, oldest first. Returning them marks delivery. */
  inbox(session: SessionRow, limit: number): Answer[] {
    return this.db
      .query<RoundRow, [string, number]>(
        `SELECT * FROM rounds WHERE session_id = ? AND status <> 'pending' AND delivered_at IS NULL
         ORDER BY decided_at, rowid LIMIT ?`,
      )
      .all(session.id, limit)
      .map((row) => this.deliver(row));
  }

  // ── Command Center (the Human) ──────────────────────────────────────────

  /** The Feed: Pending Rounds and Rounds ended in place, in queue order. */
  feed(): FeedRoundView[] {
    return this.db
      .query<{ id: string }, []>(
        "SELECT id FROM rounds WHERE status = 'pending' OR feed_removed_at IS NULL ORDER BY position, rowid",
      )
      .all()
      .map((r) => this.view(r.id)!);
  }

  saveDraft(id: string, draft: unknown): void {
    if (!isDraft(draft)) throw new HubError("invalid_answer", "malformed Draft", { errors: validationIssues(isDraft.errors) });
    this.pendingRow(id);
    this.db.query("UPDATE rounds SET draft = ? WHERE id = ?").run(JSON.stringify(draft), id);
    this.emit([{ type: "draft.saved", round_id: id, draft }]);
  }

  /** Send: every required open Question needs a value; Locked values stay. Immediate and immutable. */
  send(id: string, input: unknown): Answer {
    if (!isSendInput(input)) {
      throw new HubError("invalid_answer", "malformed send request", { errors: validationIssues(isSendInput.errors) });
    }
    const row = this.pendingRow(id);
    const round: Round = JSON.parse(row.round);
    const locks: Locks = JSON.parse(row.locks);
    const suggestion: Suggestion | null = row.suggestion ? JSON.parse(row.suggestion) : null;
    const known = new Set(round.questions.map((q) => q.id));
    const errors = Object.keys(input.questions)
      .filter((qid) => !known.has(qid))
      .map((qid) => ({ pointer: `/questions/${qid}`, message: "unknown Question" }));
    const human: Record<string, { value: QuestionValue; note?: string; suggested_by?: string }> = {};
    for (const q of round.questions) {
      if (locks[q.id]) continue;
      const given = input.questions[q.id];
      const value = parseHumanValue(q, given?.value);
      if (typeof value === "string") {
        errors.push({ pointer: `/questions/${q.id}/value`, message: value });
        continue;
      }
      if (value === null && q.required !== false) errors.push({ pointer: `/questions/${q.id}`, message: "required" });
      // suggested_by (delegation spec): the Human sent this Advisor's Suggestion unchanged; set_by stays human.
      const suggested = suggestion?.questions[q.id];
      const suggested_by =
        value !== null && suggested !== undefined && canonicalJson(value) === canonicalJson(suggested.value) ? suggestion!.advisor : undefined;
      human[q.id] = { value, ...(given?.note ? { note: given.note } : {}), ...(suggested_by ? { suggested_by } : {}) };
    }
    if (errors.length) throw new HubError("invalid_answer", "the Answer is incomplete or invalid", { errors });
    return this.humanEnd(row, "answered", { ...(input.note ? { note: input.note } : {}) }, human, true);
  }

  dismiss(id: string, input: unknown): Answer {
    if (!isDismissInput(input)) throw new HubError("invalid_answer", "malformed dismiss request");
    return this.humanEnd(this.pendingRow(id), "dismissed", input.note ? { note: input.note } : {});
  }

  redirect(id: string, input: unknown): Answer {
    if (!isRedirectInput(input)) throw new HubError("invalid_answer", "Redirect needs a message");
    return this.humanEnd(this.pendingRow(id), "redirected", { message: input.message, ...(input.note ? { note: input.note } : {}) });
  }

  /** Remove an ended-in-place Round from the Feed (it stays in the log). */
  removeFromFeed(id: string): void {
    const row = this.row(id);
    if (!row) throw new HubError("not_found", `no Round ${id}`);
    if (row.status === "pending") throw new HubError("round_pending", `Round ${id} is still pending`);
    this.db.query("UPDATE rounds SET feed_removed_at = coalesce(feed_removed_at, ?) WHERE id = ?").run(this.now(), id);
    this.emit([{ type: "round.removed", round_id: id }]);
  }

  // ── Delegation (Advisors) ────────────────────────────────────────────────

  /** Configured Advisor names, for the Human's "Ask advisor" picker. */
  advisorNames(): string[] {
    return this.config.advisors.map((a) => a.name);
  }

  /**
   * Starts an Advisor run on `roundId` (delegation spec): cancels any run already active on this
   * Round, spawns the Advisor's command with the prompt on stdin, and applies its timeout. Returns the
   * new run at once; it finishes in the background and is reported via `advisor.ended`.
   */
  askAdvisor(roundId: string, advisorName: string, brief: string | undefined, trigger: "manual" | "auto"): AdvisorRunView {
    const row = this.pendingRow(roundId);
    const advisor = this.config.advisors.find((a) => a.name === advisorName);
    if (!advisor) throw new HubError("advisor_not_found", `no Advisor "${advisorName}" in config.toml`);
    this.killRunning(roundId); // one run per Round at a time; a new request cancels the running one

    const round: Round = JSON.parse(row.round);
    const session = this.db.query<{ cwd: string | null }, [string]>("SELECT cwd FROM sessions WHERE id = ?").get(row.session_id);
    const cwd = session?.cwd && existsSync(session.cwd) ? session.cwd : mkdtempSync(join(tmpdir(), "hermes-advisor-"));

    const runId = newId("adv_");
    const started_at = this.now();
    this.db
      .query(
        `INSERT INTO advisor_runs (id, round_id, advisor_name, trigger, brief, started_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'running')`,
      )
      .run(runId, roundId, advisorName, trigger, brief ?? null, started_at);

    const proc = Bun.spawn(advisor.command, {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HERMES_ADVISOR: runId },
    });
    proc.stdin.write(buildPrompt(round, brief));
    void proc.stdin.end();

    const running: RunningAdvisor = { run_id: runId, proc, cancelled: false, timedOut: false, timeoutTimer: undefined as never };
    running.timeoutTimer = setTimeout(() => {
      running.timedOut = true;
      proc.kill("SIGTERM");
      running.killTimer = setTimeout(() => proc.kill("SIGKILL"), SIGKILL_GRACE_MS);
    }, advisor.timeout_seconds * 1000);
    this.runningAdvisors.set(roundId, running);

    void this.finishAdvisorRun(roundId, runId, advisorName, round, running);

    this.emit([{ type: "advisor.started", view: this.view(roundId)! }]);
    return this.advisorRunView(runId)!;
  }

  /** Cancel: SIGTERM, then SIGKILL after 5s, the Advisor process running on this Round, if any. */
  cancelAdvisor(roundId: string): void {
    if (!this.row(roundId)) throw new HubError("not_found", `no Round ${roundId}`);
    this.killRunning(roundId);
  }

  /** Signals the running Advisor (if any) to stop; its own completion handler records the final status. */
  private killRunning(roundId: string): void {
    const running = this.runningAdvisors.get(roundId);
    if (!running) return;
    running.cancelled = true;
    running.proc.kill("SIGTERM");
    running.killTimer ??= setTimeout(() => running.proc.kill("SIGKILL"), SIGKILL_GRACE_MS);
  }

  /** Auto-ask (delegation spec): matches on kind + project (git root, or cwd), label optionally narrows it. */
  private matchAutoAsk(session: SessionRow): AutoAskRule | undefined {
    if (this.config.autoAsk.length === 0) return undefined;
    const project = this.projectFor(session.id);
    return this.config.autoAsk.find(
      (r) => r.kind === session.kind && r.project === project && (r.label === undefined || r.label === session.label),
    );
  }

  private projectFor(sessionId: string): string | null {
    const row = this.db.query<{ cwd: string | null; git: string | null }, [string]>("SELECT cwd, git FROM sessions WHERE id = ?").get(sessionId);
    if (!row) return null;
    const git = row.git ? (JSON.parse(row.git) as { root?: string } | null) : null;
    return git?.root ?? row.cwd ?? null;
  }

  /** Awaits the spawned process, records its outcome, and merges a valid Suggestion into the Draft. */
  private async finishAdvisorRun(
    roundId: string,
    runId: string,
    advisorName: string,
    round: Round,
    running: RunningAdvisor,
  ): Promise<void> {
    const [stdout, exitCode] = await Promise.all([
      new Response(running.proc.stdout).text(),
      new Response(running.proc.stderr).text().catch(() => ""),
      running.proc.exited,
    ]).then(([out, , code]) => [out, code] as const);
    clearTimeout(running.timeoutTimer);
    clearTimeout(running.killTimer);
    if (this.runningAdvisors.get(roundId) === running) this.runningAdvisors.delete(roundId);

    let status: AdvisorRunView["status"];
    let suggestion: Suggestion | null = null;
    if (running.timedOut) {
      status = "timed_out";
    } else if (running.cancelled) {
      status = "cancelled";
    } else if (exitCode === 0) {
      const parsed = parseSuggestion(round, extractLastJsonObject(stdout));
      if (parsed) {
        status = "succeeded";
        suggestion = {
          advisor: advisorName,
          run_id: runId,
          ...(parsed.summary ? { summary: parsed.summary } : {}),
          questions: parsed.questions,
          ...(parsed.skipped.length ? { skipped: parsed.skipped } : {}),
        };
      } else {
        status = "failed";
      }
    } else {
      status = "failed";
    }

    const ended_at = this.now();
    const rawOutput = capOutput(stdout);
    this.db
      .query("UPDATE advisor_runs SET ended_at = ?, status = ?, raw_output = ?, suggestion = ? WHERE id = ?")
      .run(ended_at, status, rawOutput, suggestion ? JSON.stringify(suggestion) : null, runId);

    const row = this.row(roundId);
    if (row && row.status === "pending" && suggestion) this.mergeSuggestion(roundId, row, suggestion);
    if (row) this.emit([{ type: "advisor.ended", view: this.view(roundId)! }]);
  }

  /** Fills empty, open Questions in the Draft with the Suggestion's values; Locked and already-set ones are untouched. */
  private mergeSuggestion(roundId: string, row: RoundRow, suggestion: Suggestion): void {
    const locks: Locks = JSON.parse(row.locks);
    const draft = parseDraft(row.draft) ?? {};
    const draftQuestions = { ...(draft.questions ?? {}) };
    let changed = false;
    for (const [qid, s] of Object.entries(suggestion.questions)) {
      if (locks[qid]) continue; // a firing policy ignores the Suggestion
      if (draftHasValue(draftQuestions[qid]?.value)) continue; // the Human already set it; offered inline instead
      draftQuestions[qid] = { value: s.value };
      changed = true;
    }
    if (changed) {
      const nextDraft: Draft = { ...draft, questions: draftQuestions };
      this.db.query("UPDATE rounds SET suggestion = ?, draft = ? WHERE id = ?").run(JSON.stringify(suggestion), JSON.stringify(nextDraft), roundId);
    } else {
      this.db.query("UPDATE rounds SET suggestion = ? WHERE id = ?").run(JSON.stringify(suggestion), roundId);
    }
  }

  private advisorRunView(id: string): AdvisorRunView | null {
    const row = this.db.query<AdvisorRunRow, [string]>("SELECT * FROM advisor_runs WHERE id = ?").get(id);
    return row ? toAdvisorRunView(row) : null;
  }

  // ── Answered log (Command Center) ────────────────────────────────────────

  /** The answered log: every ended Round, newest first, with the filters combined by AND. */
  log(filter: LogFilter = {}): LogEntry[] {
    const clauses: string[] = ["r.status <> 'pending'"];
    const params: string[] = [];
    if (filter.outcome !== undefined) {
      clauses.push("r.status = ?");
      params.push(filter.outcome);
    }
    if (filter.session_id !== undefined) {
      clauses.push("r.session_id = ?");
      params.push(filter.session_id);
    }
    if (filter.project !== undefined) {
      clauses.push("coalesce(json_extract(s.git, '$.root'), s.cwd) = ?");
      params.push(filter.project);
    }
    if (filter.from !== undefined) {
      clauses.push("r.decided_at >= ?");
      params.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push("r.decided_at <= ?");
      params.push(filter.to);
    }

    type LogRow = RoundRow & { kind: string; session_key: string; label: string | null; cwd: string | null; git: string | null; snippet: string | null };
    let rows: LogRow[];
    if (filter.q !== undefined) {
      clauses.push("log_fts MATCH ?");
      params.push(filter.q);
      rows = this.db
        .query<LogRow, string[]>(
          `SELECT r.*, s.kind, s.session_key, s.label, s.cwd, s.git, snippet(log_fts, 1, '<mark>', '</mark>', '…', 16) AS snippet
           FROM rounds r JOIN sessions s ON s.id = r.session_id JOIN log_fts ON log_fts.round_id = r.id
           WHERE ${clauses.join(" AND ")} ORDER BY bm25(log_fts)`,
        )
        .all(...params);
    } else {
      rows = this.db
        .query<LogRow, string[]>(
          `SELECT r.*, s.kind, s.session_key, s.label, s.cwd, s.git, NULL AS snippet
           FROM rounds r JOIN sessions s ON s.id = r.session_id
           WHERE ${clauses.join(" AND ")} ORDER BY r.decided_at DESC, r.rowid DESC`,
        )
        .all(...params);
    }
    let entries = rows.map((r) => this.toLogEntry(r));
    if (filter.callsign !== undefined) entries = entries.filter((e) => e.meta.callsign === filter.callsign);
    return filter.limit !== undefined ? entries.slice(0, filter.limit) : entries;
  }

  /** The filtered log as `{round, answer, meta}` documents, for Export JSON. */
  exportLog(filter: LogFilter = {}): { round: Round; answer: Answer; meta: LogMeta }[] {
    return this.log(filter).map(({ round, answer, meta }) => ({ round, answer, meta }));
  }

  /** The database file's size on disk, for Settings → Storage. 0 for an in-memory database. */
  dbSizeBytes(): number {
    try {
      return statSync(this.db.filename).size;
    } catch {
      return 0;
    }
  }

  // ── Policies ────────────────────────────────────────────────────────────

  /**
   * Locks every Question whose deadline has passed, in deadline order, and expires Rounds left with
   * no open Question. Strict: a policy never waits for, nor sends, the Human's Draft.
   */
  fireDue(): void {
    const events: HubEvent[] = [];
    this.db.transaction(() => {
      const due = this.db
        .query<{ round_id: string; question_id: string }, [string]>(
          `SELECT d.round_id, d.question_id FROM question_deadlines d JOIN rounds r ON r.id = d.round_id
           WHERE r.status = 'pending' AND d.deadline <= ? ORDER BY d.deadline, d.rowid`,
        )
        .all(this.now());
      for (const { round_id, question_id } of due) {
        const row = this.row(round_id)!;
        if (row.status !== "pending") continue; // expired earlier in this batch
        const round: Round = JSON.parse(row.round);
        const locks: Locks = JSON.parse(row.locks);
        const q = round.questions.find((x) => x.id === question_id)!;
        locks[q.id] = { value: lockValue(q, effectivePolicy(round, q)), locked_at: this.now() };
        this.db.query("UPDATE rounds SET locks = ? WHERE id = ?").run(JSON.stringify(locks), round_id);
        this.db.query("DELETE FROM question_deadlines WHERE round_id = ? AND question_id = ?").run(round_id, question_id);
        const open = round.questions.some((x) => !locks[x.id]);
        events.push(open ? { type: "round.locked", view: this.view(round_id)! } : this.end(this.row(round_id)!, "expired", {}));
      }
    })();
    this.emit(events);
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    const next = this.db
      .query<{ deadline: string }, []>(
        `SELECT min(d.deadline) AS deadline FROM question_deadlines d JOIN rounds r ON r.id = d.round_id WHERE r.status = 'pending'`,
      )
      .get()?.deadline;
    if (!next) return;
    const delay = Math.min(Math.max(0, Date.parse(next) - this.clock.now()), MAX_TIMER_MS);
    this.timer = setTimeout(() => this.fireDue(), delay);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private roundUrl(id: string): string {
    return `${this.baseUrl}/rounds/${id}`;
  }

  private row(id: string): RoundRow | null {
    return this.db.query<RoundRow, [string]>("SELECT * FROM rounds WHERE id = ?").get(id);
  }

  private ownRound(session: SessionRow, id: string): RoundRow {
    const row = this.row(id);
    if (!row || row.session_id !== session.id) throw new HubError("not_found", `no Round ${id} for this session`);
    return row;
  }

  private pendingRow(id: string): RoundRow {
    const row = this.row(id);
    if (!row) throw new HubError("not_found", `no Round ${id}`);
    if (row.status !== "pending") {
      throw new HubError("round_ended", `Round ${id} has already ended`, { round_id: id, outcome: row.status });
    }
    return row;
  }

  private nextDeadline(id: string): string | null {
    return (
      this.db.query<{ d: string | null }, [string]>("SELECT min(deadline) AS d FROM question_deadlines WHERE round_id = ?").get(id)?.d ??
      null
    );
  }

  private deliver(row: RoundRow): Answer {
    if (!row.delivered_at) this.db.query("UPDATE rounds SET delivered_at = ? WHERE id = ?").run(this.now(), row.id);
    return JSON.parse(row.answer!);
  }

  private humanEnd(
    row: RoundRow,
    outcome: "answered" | "dismissed" | "redirected",
    extras: Partial<Answer>,
    human?: Record<string, { value: QuestionValue; note?: string; suggested_by?: string }>,
    clearDraft = false,
  ): Answer {
    const event = this.db.transaction(() => {
      if (clearDraft) this.db.query("UPDATE rounds SET draft = NULL WHERE id = ?").run(row.id);
      return this.end(row, outcome, extras, human);
    })();
    this.emit([event]);
    this.schedule();
    return event.answer;
  }

  /** Ends a pending Round with exactly one Outcome. Call inside a transaction; emit the event after it commits. */
  private end(
    row: RoundRow,
    outcome: Outcome,
    extras: Partial<Answer>,
    human?: Record<string, { value: QuestionValue; note?: string; suggested_by?: string }>,
  ): Extract<HubEvent, { type: "round.ended" }> {
    this.killRunning(row.id); // a run never outlives the Round (delegation spec)
    const round: Round = JSON.parse(row.round);
    const decided_at = this.now();
    const answer: Answer = {
      schema: "hermes.answer/v1",
      round_id: row.id,
      outcome,
      ...extras,
      questions: answerQuestions(round, JSON.parse(row.locks), human),
      decided_at,
    };
    const removed = LEAVES_FEED[outcome] ? decided_at : null;
    this.db
      .query("UPDATE rounds SET status = ?, answer = ?, decided_at = ?, feed_removed_at = ?, suggestion = NULL WHERE id = ? AND status = 'pending'")
      .run(outcome, JSON.stringify(answer), decided_at, removed, row.id);
    this.db.query("DELETE FROM question_deadlines WHERE round_id = ?").run(row.id);
    this.db.query("INSERT INTO log_fts (round_id, text) VALUES (?, ?)").run(row.id, logSearchText(round, answer));
    return { type: "round.ended", round_id: row.id, answer, view: removed ? null : this.view(row.id) };
  }

  private view(id: string): FeedRoundView | null {
    const r = this.db
      .query<RoundRow & { kind: string; session_key: string; label: string | null; cwd: string | null }, [string]>(
        "SELECT r.*, s.kind, s.session_key, s.label, s.cwd FROM rounds r JOIN sessions s ON s.id = r.session_id WHERE r.id = ?",
      )
      .get(id);
    if (!r) return null;
    const deadlines = this.db
      .query<{ question_id: string; deadline: string }, [string]>("SELECT question_id, deadline FROM question_deadlines WHERE round_id = ?")
      .all(id);
    const advisorRuns = this.db
      .query<AdvisorRunRow, [string]>("SELECT * FROM advisor_runs WHERE round_id = ? ORDER BY started_at DESC, rowid DESC")
      .all(id)
      .map(toAdvisorRunView);
    return {
      id: r.id,
      status: r.status,
      position: r.position,
      received_at: r.received_at,
      session: { id: r.session_id, kind: r.kind, callsign: callsign(r) },
      round: JSON.parse(r.round),
      locks: JSON.parse(r.locks),
      deadlines: Object.fromEntries(deadlines.map((d) => [d.question_id, d.deadline])),
      draft: parseDraft(r.draft),
      answer: r.answer ? JSON.parse(r.answer) : null,
      advisor_runs: advisorRuns,
      suggestion: r.suggestion ? JSON.parse(r.suggestion) : null,
    };
  }

  private toLogEntry(r: RoundRow & { kind: string; session_key: string; label: string | null; cwd: string | null; git: string | null; snippet: string | null }): LogEntry {
    const answer: Answer = JSON.parse(r.answer!);
    return {
      round: JSON.parse(r.round),
      answer,
      draft: parseDraft(r.draft),
      meta: {
        round_id: r.id,
        callsign: callsign(r),
        project: project(r),
        received_at: r.received_at,
        delivered_at: r.delivered_at,
        ...(answer.superseded_by !== undefined ? { superseded_by: answer.superseded_by } : {}),
      },
      ...(r.snippet !== null ? { snippet: r.snippet } : {}),
    };
  }
}

function parseDraft(text: string | null): Draft | null {
  return text ? JSON.parse(text) : null;
}

/** On Supersede, the Draft carries over for Questions whose id and kind match. */
function carryDraft(oldRound: Round, draft: Draft | null, next: Round): Draft | null {
  if (!draft?.questions) return null;
  const oldKinds = new Map(oldRound.questions.map((q) => [q.id, q.kind]));
  const questions = Object.fromEntries(
    next.questions.filter((q) => oldKinds.get(q.id) === q.kind && draft.questions![q.id]).map((q) => [q.id, draft.questions![q.id]!]),
  );
  return Object.keys(questions).length ? { questions } : null;
}

function toAdvisorRunView(row: AdvisorRunRow): AdvisorRunView {
  return {
    id: row.id,
    advisor_name: row.advisor_name,
    trigger: row.trigger,
    brief: row.brief,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status,
    raw_output: row.raw_output,
    suggestion: row.suggestion ? JSON.parse(row.suggestion) : null,
  };
}

/** Builds the free-text index for a Round once it ends (answered-log spec): title, context, each
 * Question's prompt/detail, option labels/details, free-text answers, the Human's notes and the
 * redirect message. Attachments are never indexed. */
function logSearchText(round: Round, answer: Answer): string {
  const parts: string[] = [round.title];
  if (round.context) parts.push(round.context);
  for (const q of round.questions) {
    parts.push(q.prompt);
    if (q.detail) parts.push(q.detail);
    if (q.kind === "single" || q.kind === "multi") {
      for (const o of q.options) {
        parts.push(o.label);
        if (o.detail) parts.push(o.detail);
      }
    }
    const qa = answer.questions[q.id];
    if (!qa) continue;
    if (qa.note) parts.push(qa.note);
    const v = qa.value;
    if (!v) continue;
    if ("text" in v) {
      parts.push(v.text);
    } else if ("selected" in v) {
      if (q.kind === "single" && typeof v.selected === "string") {
        const opt = q.options.find((o) => o.id === v.selected);
        if (opt) parts.push(opt.label);
      } else if (q.kind === "multi" && Array.isArray(v.selected)) {
        for (const id of v.selected) {
          const opt = q.options.find((o) => o.id === id);
          if (opt) parts.push(opt.label);
        }
      }
      if ("other" in v && v.other) parts.push(v.other);
    } else if ("other" in v) {
      parts.push(v.other);
    }
  }
  if (answer.note) parts.push(answer.note);
  if (answer.message) parts.push(answer.message);
  return parts.join("\n");
}
