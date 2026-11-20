import type { Database } from "bun:sqlite";
import { HubError } from "../errors.ts";
import type { Answer, PendingStatus, QuestionAnswer, QuestionValue, Round, SingleQuestion } from "../schema/types.ts";
import {
  isSendInput,
  isSessionRequest,
  validateRound,
  validationIssues,
  type SessionRequest,
} from "../schema/validate.ts";
import { VERSION } from "../version.ts";
import { callsign } from "./callsign.ts";

interface SessionRow {
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
  status: string;
  round: string;
  answer: string | null;
  received_at: string;
  delivered_at: string | null;
}

/** A Pending Round as the Command Center sees it. */
export interface PendingRoundView {
  id: string;
  received_at: string;
  session: { id: string; kind: string; callsign: string };
  round: Round;
}

export type HubEvent =
  | { type: "round.created"; round: PendingRoundView }
  | { type: "round.ended"; round_id: string; answer: Answer };

const SUPPORTED_SCHEMAS = ["hermes.round/v1"];
const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let id = prefix;
  for (const b of bytes) id += ID_ALPHABET[b & 31];
  return id;
}

const now = () => new Date().toISOString();

/** The Round engine: every door (HTTP, MCP, CLI) maps onto these operations. */
export class Engine {
  private readonly listeners = new Set<(e: HubEvent) => void>();

  constructor(
    private readonly db: Database,
    private readonly baseUrl: string,
  ) {}

  subscribe(listener: (e: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: HubEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  hubInfo() {
    const row = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'hub_id'").get();
    return { hub_id: row!.value, version: VERSION, schemas: SUPPORTED_SCHEMAS, limits: {} };
  }

  /** `POST /v1/sessions`: idempotent on (kind, session key); latest label, cwd and git win. */
  upsertSession(body: unknown): { session_id: string; token: string; callsign: string } {
    if (!isSessionRequest(body)) {
      throw new HubError("invalid_round", "invalid session request", { errors: validationIssues(isSessionRequest.errors) });
    }
    const req: SessionRequest = body;
    const t = now();
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
          .get(now(), token)
      : null;
    if (!row) throw new HubError("unknown_session", "missing or unknown Hermes-Session token; call POST /v1/sessions");
    return row;
  }

  submit(session: SessionRow, doc: unknown): { round_id: string; url: string; status: "pending" } {
    const schema = doc && typeof doc === "object" && "schema" in doc ? doc.schema : undefined;
    if (typeof schema === "string" && /^hermes\.round\/v\d+$/.test(schema) && !SUPPORTED_SCHEMAS.includes(schema)) {
      throw new HubError("unsupported_schema", `unsupported schema ${schema}`, { supported: SUPPORTED_SCHEMAS });
    }
    const errors = validateRound(doc);
    if (errors.length) throw new HubError("invalid_round", "the Round does not match hermes.round/v1", { errors });
    const round = doc as Round; // validated against the schema above
    const unsupported = round.questions.flatMap((q, i) =>
      q.kind === "single"
        ? []
        : [{ pointer: `/questions/${i}/kind`, message: `kind "${q.kind}" is not supported by this Hub build yet` }],
    );
    if (unsupported.length) throw new HubError("invalid_round", "unsupported Question kind", { errors: unsupported });

    const id = newId("r_");
    const received_at = now();
    this.db
      .query("INSERT INTO rounds (id, session_id, status, round, received_at) VALUES (?, ?, 'pending', ?, ?)")
      .run(id, session.id, JSON.stringify(round), received_at);
    this.emit({
      type: "round.created",
      round: { id, received_at, session: { id: session.id, kind: session.kind, callsign: callsign(session) }, round },
    });
    return { round_id: id, url: `${this.baseUrl}/rounds/${id}`, status: "pending" };
  }

  private ownRound(session: SessionRow, id: string): RoundRow {
    const row = this.db
      .query<RoundRow, [string, string]>("SELECT * FROM rounds WHERE id = ? AND session_id = ?")
      .get(id, session.id);
    if (!row) throw new HubError("not_found", `no Round ${id} for this session`);
    return row;
  }

  /** get: pending status, or the Answer once ended. The first Answer returned marks delivery. */
  get(session: SessionRow, id: string): Answer | PendingStatus {
    const row = this.ownRound(session, id);
    if (row.status === "pending") return { status: "pending", next_deadline: null };
    if (!row.delivered_at) this.db.query("UPDATE rounds SET delivered_at = ? WHERE id = ?").run(now(), id);
    return JSON.parse(row.answer!) as Answer;
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

  /** Pending Rounds for the Command Center, in arrival order. */
  pending(): PendingRoundView[] {
    return this.db
      .query<RoundRow & { kind: string; session_key: string; label: string | null; cwd: string | null }, []>(
        `SELECT r.*, s.kind, s.session_key, s.label, s.cwd FROM rounds r JOIN sessions s ON s.id = r.session_id
         WHERE r.status = 'pending' ORDER BY r.received_at, r.rowid`,
      )
      .all()
      .map((r) => ({
        id: r.id,
        received_at: r.received_at,
        session: { id: r.session_id, kind: r.kind, callsign: callsign(r) },
        round: JSON.parse(r.round) as Round,
      }));
  }

  /** The Human sends a Round: outcome `answered`, delivered immediately, immutable. */
  send(id: string, input: unknown): Answer {
    if (!isSendInput(input)) {
      throw new HubError("invalid_answer", "malformed send request", { errors: validationIssues(isSendInput.errors) });
    }
    const row = this.db.query<RoundRow, [string]>("SELECT * FROM rounds WHERE id = ?").get(id);
    if (!row) throw new HubError("not_found", `no Round ${id}`);
    if (row.status !== "pending") {
      throw new HubError("round_ended", `Round ${id} has already ended`, { round_id: id, outcome: row.status });
    }
    const round = JSON.parse(row.round) as Round;
    const known = new Set(round.questions.map((q) => q.id));
    const errors = Object.keys(input.questions)
      .filter((qid) => !known.has(qid))
      .map((qid) => ({ pointer: `/questions/${qid}`, message: "unknown Question" }));

    const questions: Record<string, QuestionAnswer> = {};
    for (const q of round.questions) {
      const given = input.questions[q.id];
      if (given === undefined || given.value === null) {
        if (q.required !== false) errors.push({ pointer: `/questions/${q.id}`, message: "required" });
        questions[q.id] = { value: null, set_by: "none" };
        continue;
      }
      const value = q.kind === "single" ? singleValue(q, given.value) : undefined;
      if (!value) {
        errors.push({ pointer: `/questions/${q.id}/value`, message: "not a valid choice" });
        continue;
      }
      questions[q.id] = { value, set_by: "human", ...(given.note ? { note: given.note } : {}) };
    }
    if (errors.length) throw new HubError("invalid_answer", "the Answer is incomplete or invalid", { errors });

    const answer: Answer = {
      schema: "hermes.answer/v1",
      round_id: id,
      outcome: "answered",
      ...(input.note ? { note: input.note } : {}),
      questions,
      decided_at: now(),
    };
    this.db
      .query("UPDATE rounds SET status = 'answered', answer = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(JSON.stringify(answer), answer.decided_at, id);
    this.emit({ type: "round.ended", round_id: id, answer });
    return answer;
  }
}

function singleValue(q: SingleQuestion, value: unknown): QuestionValue | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("selected" in value && typeof value.selected === "string" && q.options.some((o) => o.id === value.selected)) {
    return { selected: value.selected };
  }
  if (q.allow_other && "other" in value && typeof value.other === "string" && value.other.trim()) {
    return { other: value.other };
  }
  return undefined;
}
