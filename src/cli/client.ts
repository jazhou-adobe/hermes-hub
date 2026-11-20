import { HubError } from "../errors.ts";
import type { Answer } from "../schema/types.ts";
import { validateAnswer } from "../schema/validate.ts";
import { detectSession, type IdentityFlags } from "./identity.ts";

const WAIT_SECONDS = 25;
const UNREACHABLE_LIMIT_MS = 5 * 60_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The Agent side of the HTTP API. Every failure surfaces as a HubError carrying the shared code. */
export class HubClient {
  private token: string | undefined;

  constructor(readonly baseUrl: string) {}

  private async request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
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
      });
    } catch {
      throw new HubError(
        "hub_unavailable",
        `cannot reach the Hub at ${this.baseUrl}. Start it with \`hermes hub\`; a sandboxed Agent needs the Hub Skill's sandbox setup`,
      );
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new HubError("internal", `the Hub sent HTTP ${res.status} without a JSON body`);
    }
    if (!isRecord(data)) throw new HubError("internal", `the Hub sent HTTP ${res.status} with a non-object body`);
    if (!res.ok) {
      const { code, detail, type: _type, title: _title, status: _status, ...extra } = data;
      throw new HubError(typeof code === "string" ? code : "internal", typeof detail === "string" ? detail : `HTTP ${res.status}`, extra);
    }
    return data;
  }

  /** `POST /v1/sessions`; the token lives in memory only. */
  async openSession(flags: IdentityFlags): Promise<void> {
    const res = await this.request("POST", "/v1/sessions", detectSession(flags));
    if (typeof res.token !== "string") throw new HubError("internal", "session response without a token");
    this.token = res.token;
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

  /**
   * Long-polls until the Round ends. A lost connection is retried with backoff (the Round is safe in
   * the Hub); `hub_unavailable` only after 5 minutes without reaching it.
   */
  async waitForAnswer(roundId: string): Promise<Answer> {
    let unreachableSince: number | undefined;
    let backoffMs = 500;
    for (;;) {
      let res: Record<string, unknown>;
      try {
        res = await this.request("GET", `/v1/rounds/${encodeURIComponent(roundId)}?wait=${WAIT_SECONDS}`);
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
      if (res.status !== "pending") return asAnswer(res);
    }
  }
}

function asAnswer(doc: unknown): Answer {
  const issues = validateAnswer(doc);
  if (issues.length) throw new HubError("internal", `the Hub returned an invalid Answer: ${JSON.stringify(issues)}`);
  return doc as Answer; // validated against hermes.answer/v1 above
}
