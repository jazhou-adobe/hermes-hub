import type { BuildArtifact, Server } from "bun";
import { join } from "node:path";
import { HTTP_STATUS, HubError } from "../errors.ts";
import { CLONE_ROOT } from "../paths.ts";
import type { Engine, HubEvent } from "./engine.ts";
import devCommandCenter from "../../web/index.html";

const HEARTBEAT_MS = 15_000;
const CSP = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'";
const JSON_TYPE = /^application\/json\s*(;|$)/i;

function problem(err: HubError): Response {
  const status = HTTP_STATUS[err.code] ?? 500;
  return new Response(
    JSON.stringify({
      type: `https://hermes-hub.local/errors/${err.code}`,
      title: err.code,
      status,
      detail: err.message,
      code: err.code,
      ...err.extra,
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

/**
 * Browser guard (security spec): Host allowlist against DNS rebinding, Origin and Fetch-Metadata
 * against cross-site requests, and JSON-only state changes. Requests without an Origin (CLI, shim,
 * curl) pass the Origin check.
 */
function guard(req: Request, port: number): void {
  const local = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!local.includes(req.headers.get("host") ?? "")) throw new HubError("forbidden", "Host not allowed");
  const origin = req.headers.get("origin");
  if (origin !== null && !local.some((h) => origin === `http://${h}`)) throw new HubError("forbidden", "cross-origin request refused");
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new HubError("forbidden", "cross-site request refused");
  if (req.method !== "GET" && req.method !== "HEAD" && !JSON_TYPE.test(req.headers.get("content-type") ?? "")) {
    throw new HubError("forbidden", "state-changing requests must be application/json");
  }
}

type Handler<P extends string> = (req: Bun.BunRequest<P>, server: Server<undefined>) => Response | Promise<Response>;

/** Runs the guard, maps HubErrors to RFC 9457 problems (anything else is a 500), and adds nosniff. */
function handle<P extends string>(fn: Handler<P>): Handler<P> {
  return async (req, server) => {
    let res: Response;
    try {
      guard(req, server.port!);
      res = await fn(req, server);
    } catch (err) {
      if (!(err instanceof HubError)) console.error(err);
      res = problem(err instanceof HubError ? err : new HubError("internal", "internal error"));
    }
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  };
}

async function jsonBody(req: Request, code: string): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HubError(code, "the body must be JSON");
  }
}

function forbidAdvisor(req: Request): void {
  if (req.headers.has("Hermes-Advisor")) throw new HubError("advisor_cannot_ask", "an Advisor run cannot ask the Human");
}

/** A Server-Sent Events response fed by `start`, with a comment heartbeat. */
function sse(req: Request, server: Server<undefined>, start: (send: (event: string, data: unknown) => void) => () => void) {
  server.timeout(req, 0);
  let stop = () => {};
  const stream = new ReadableStream<string>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const heartbeat = setInterval(() => controller.enqueue(": heartbeat\n\n"), HEARTBEAT_MS);
      const unsubscribe = start(send);
      stop = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        stop();
        controller.close();
      });
    },
    cancel: () => stop(),
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

/**
 * The Command Center, bundled from source at start. Serving the bundle ourselves (rather than as a
 * route-level HTML import) lets the browser guard and the CSP cover every UI response.
 */
async function buildCommandCenter(): Promise<{ index: BuildArtifact; assets: Map<string, BuildArtifact> }> {
  const build = await Bun.build({
    entrypoints: [join(CLONE_ROOT, "web/index.html")],
    minify: true,
    publicPath: "/assets/",
    naming: { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!build.success) throw new AggregateError(build.logs, "the Command Center failed to build");
  const index = build.outputs.find((o) => o.path.endsWith(".html"))!;
  const assets = new Map(build.outputs.filter((o) => o !== index).map((o) => [o.path.replace(/^\.\//, ""), o]));
  return { index, assets };
}

export async function startServer(engine: Engine, port: number): Promise<Server<undefined>> {
  const session = (req: Request) => engine.sessionFor(req.headers.get("Hermes-Session"));
  const development = process.env.NODE_ENV === "development";

  let ui: Record<string, unknown>;
  if (development) {
    // Bun's HTML import with hot reload; it resolves bundled asset URLs against the cwd.
    // The guard and CSP do not cover these UI routes in development.
    process.chdir(CLONE_ROOT);
    ui = { "/": devCommandCenter, "/rounds/:id": devCommandCenter };
  } else {
    const { index, assets } = await buildCommandCenter();
    const page = handle(() => new Response(index, { headers: { "Content-Type": index.type, "Content-Security-Policy": CSP } }));
    ui = {
      "/": { GET: page },
      "/rounds/:id": { GET: page },
      "/assets/:file": {
        GET: handle<"/assets/:file">((req) => {
          const asset = assets.get(req.params.file);
          if (!asset) throw new HubError("not_found", "no such asset");
          return new Response(asset, { headers: { "Content-Type": asset.type, "Cache-Control": "public, max-age=31536000, immutable" } });
        }),
      },
    };
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    development,
    routes: {
      ...ui,

      // Agent API (transports spec)
      "/v1/hub": { GET: handle(() => Response.json(engine.hubInfo())) },
      "/v1/sessions": {
        POST: handle(async (req) => {
          forbidAdvisor(req);
          return Response.json(engine.upsertSession(await jsonBody(req, "invalid_round")));
        }),
      },
      "/v1/rounds": {
        POST: handle(async (req) => {
          forbidAdvisor(req);
          const s = session(req);
          const text = await req.text();
          let doc: unknown;
          try {
            doc = JSON.parse(text);
          } catch {
            throw new HubError("invalid_round", "the body must be JSON");
          }
          const { replay, ...res } = engine.submit(s, doc, Buffer.byteLength(text));
          return Response.json(res, { status: replay ? 200 : 201 });
        }),
      },
      "/v1/rounds/:id": {
        GET: handle<"/v1/rounds/:id">(async (req, server) => {
          const s = session(req);
          const wait = new URL(req.url).searchParams.get("wait");
          if (wait === null) return Response.json(engine.get(s, req.params.id));
          server.timeout(req, 0);
          const seconds = Math.min(55, Math.max(1, Number(wait) || 1));
          return Response.json(await engine.wait(s, req.params.id, seconds, req.signal));
        }),
      },
      "/v1/rounds/:id/cancel": {
        POST: handle<"/v1/rounds/:id/cancel">((req) => Response.json(engine.cancel(session(req), req.params.id))),
      },
      "/v1/inbox": {
        GET: handle((req) => {
          const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 50));
          return Response.json({ answers: engine.inbox(session(req), limit) });
        }),
      },

      // Command Center endpoints (internal; never documented to Agents)
      "/cc/rounds": { GET: handle(() => Response.json({ rounds: engine.feed() })) },
      "/cc/rounds/:id/draft": {
        PUT: handle<"/cc/rounds/:id/draft">(async (req) => {
          engine.saveDraft(req.params.id, await jsonBody(req, "invalid_answer"));
          return Response.json({ ok: true });
        }),
      },
      "/cc/rounds/:id/send": {
        POST: handle<"/cc/rounds/:id/send">(async (req) =>
          Response.json(engine.send(req.params.id, await jsonBody(req, "invalid_answer"))),
        ),
      },
      "/cc/rounds/:id/dismiss": {
        POST: handle<"/cc/rounds/:id/dismiss">(async (req) =>
          Response.json(engine.dismiss(req.params.id, await jsonBody(req, "invalid_answer"))),
        ),
      },
      "/cc/rounds/:id/redirect": {
        POST: handle<"/cc/rounds/:id/redirect">(async (req) =>
          Response.json(engine.redirect(req.params.id, await jsonBody(req, "invalid_answer"))),
        ),
      },
      "/cc/rounds/:id/remove": {
        POST: handle<"/cc/rounds/:id/remove">((req) => {
          engine.removeFromFeed(req.params.id);
          return Response.json({ ok: true });
        }),
      },
      "/cc/events": {
        GET: handle((req, server) =>
          sse(req, server, (send) => {
            send("hello", { server_time: new Date().toISOString() });
            return engine.subscribe((e: HubEvent) => send(e.type, e));
          }),
        ),
      },
    },
    fetch: handle(() => {
      throw new HubError("not_found", "no such endpoint");
    }),
  });
}
