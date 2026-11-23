import { HubError } from "../errors.ts";
import type { Answer, PendingStatus } from "../schema/types.ts";
import { validateAnswer, type SessionRequest } from "../schema/validate.ts";

const WAIT_SECONDS = 25;
const UNREACHABLE_LIMIT_MS = 5 * 60_000;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `hub_unavailable` (transports spec): the message sends the Agent to the Skill's sandbox advice, `hermes doctor`. */
function hubUnavailable(baseUrl: string): HubError {
  return new HubError(
    "hub_unavailable",
    `cannot reach the Hub at ${baseUrl}. Ask the Human to start it with \`hermes hub\`; from a sandbox, ask them to run \`hermes doctor\` for the setting that lets hermes reach it`,
  );
}

/** The Agent side of the HTTP API. Every failure surfaces as a HubError carrying the shared code. */
export class HubClient {
  private token: string | undefined;

  constructor(readonly baseUrl: string) {}

  /** `signal` aborts the request; its reason is rethrown as is, never as `hub_unavailable`. */
  private async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(this.token ? { "Hermes-Session": this.token } : {}),
          // Advisor runs may not ask (delegation spec); the Hub refuses them by this header.
          ...(process.env.HERMES_ADVISOR ? { "Hermes-Advisor": process.env.HERMES_ADVISOR } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw hubUnavailable(this.baseUrl);
    }
    if (!res.ok) throw await this.toHubError(res);
    let data: unknown;
    try {
      data = await res.json();
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new HubError("internal", `the Hub sent HTTP ${res.status} without a JSON body`);
    }
    if (!isRecord(data)) throw new HubError("internal", `the Hub sent HTTP ${res.status} with a non-object body`);
    return data;
  }

  /** Converts a failed response's RFC 9457 problem body into a HubError carrying the stable `code`. */
  private async toHubError(res: Response): Promise<HubError> {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return new HubError("internal", `the Hub sent HTTP ${res.status} without a JSON body`);
    }
    if (!isRecord(data)) return new HubError("internal", `the Hub sent HTTP ${res.status} with a non-object body`);
    const { code, detail, type: _type, title: _title, status: _status, ...extra } = data;
    return new HubError(typeof code === "string" ? code : "internal", typeof detail === "string" ? detail : `HTTP ${res.status}`, extra);
  }

  /** `POST /v1/sessions` with a detected identity (`detectSession`); the token lives in memory only. */
  async openSession(session: SessionRequest): Promise<void> {
    const res = await this.request("POST", "/v1/sessions", session);
    if (typeof res.token !== "string") throw new HubError("internal", "session response without a token");
    this.token = res.token;
  }

  /** `GET /v1/hub`: the Hub's version (it also lists the schemas and limits). */
  async hubVersion(): Promise<string> {
    const res = await this.request("GET", "/v1/hub");
    return typeof res.version === "string" ? res.version : "unknown";
  }

  async submit(round: unknown, supersedes?: string): Promise<{ round_id: string; url: string }> {
    if (supersedes !== undefined) {
      if (typeof round !== "object" || round === null || Array.isArray(round)) {
        throw new HubError("invalid_round", "the Round must be a JSON object");
      }
      round = { ...round, supersedes };
    }
    const res = await this.request("POST", "/v1/rounds", round);
    if (typeof res.round_id !== "string" || typeof res.url !== "string") {
      throw new HubError("internal", "submit response without round_id and url");
    }
    return { round_id: res.round_id, url: res.url };
  }

  async cancel(roundId: string): Promise<Answer> {
    return asAnswer(await this.request("POST", `/v1/rounds/${encodeURIComponent(roundId)}/cancel`, {}));
  }

  async inbox(limit = 50): Promise<Answer[]> {
    const res = await this.request("GET", `/v1/inbox?limit=${limit}`);
    if (!Array.isArray(res.answers)) throw new HubError("internal", "inbox response without answers");
    return res.answers.map(asAnswer);
  }

  /** get, or wait when `waitSeconds` is given (1–55 s, the Hub's window): pending status or the Answer. */
  async round(roundId: string, waitSeconds?: number, signal?: AbortSignal): Promise<Answer | PendingStatus> {
    const query = waitSeconds === undefined ? "" : `?wait=${waitSeconds}`;
    const res = await this.request("GET", `/v1/rounds/${encodeURIComponent(roundId)}${query}`, undefined, signal);
    if (res.status !== "pending") return asAnswer(res);
    return { status: "pending", next_deadline: typeof res.next_deadline === "string" ? res.next_deadline : null };
  }

  /**
   * Long-polls until the Round ends. A lost connection is retried with backoff (the Round is safe in
   * the Hub); `hub_unavailable` only after 5 minutes without reaching it.
   */
  async waitForAnswer(roundId: string): Promise<Answer> {
    let unreachableSince: number | undefined;
    let backoffMs = 500;
    for (;;) {
      let res: Answer | PendingStatus;
      try {
        res = await this.round(roundId, WAIT_SECONDS);
      } catch (err) {
        if (!(err instanceof HubError && err.code === "hub_unavailable")) throw err;
        unreachableSince ??= Date.now();
        if (Date.now() - unreachableSince > UNREACHABLE_LIMIT_MS) throw err;
        await Bun.sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 10_000);
        continue;
      }
      unreachableSince = undefined;
      backoffMs = 500;
      if (!("status" in res)) return res;
    }
  }

  /**
   * events: streams the caller's Round endings and hands each one to `onAnswer`, in order. Resolves
   * once the connection closes; the caller decides whether to reconnect.
   */
  async watch(onAnswer: (answer: Answer) => void, signal?: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/events`, {
        headers: { ...(this.token ? { "Hermes-Session": this.token } : {}) },
        signal,
      });
    } catch {
      throw hubUnavailable(this.baseUrl);
    }
    if (!res.ok) throw await this.toHubError(res);
    if (!res.body) throw new HubError("internal", "the Hub sent /v1/events without a body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event: string | undefined;
        let data: string | undefined;
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (event === "round.ended" && data !== undefined) onAnswer(asAnswer(JSON.parse(data)));
      }
    }
  }
}

function asAnswer(doc: unknown): Answer {
  const issues = validateAnswer(doc);
  if (issues.length) throw new HubError("internal", `the Hub returned an invalid Answer: ${JSON.stringify(issues)}`);
  return doc as Answer; // validated against hermes.answer/v1 above
}
