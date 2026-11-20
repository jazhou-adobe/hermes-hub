import type { Server } from "bun";
import { HTTP_STATUS, HubError } from "../errors.ts";
import type { Engine, HubEvent } from "./engine.ts";
import commandCenter from "../../web/index.html";

const HEARTBEAT_MS = 15_000;

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

type Handler<P extends string> = (req: Bun.BunRequest<P>, server: Server<undefined>) => Response | Promise<Response>;

/** Maps thrown HubErrors to RFC 9457 problems; anything else is a 500. */
function handle<P extends string>(fn: Handler<P>): Handler<P> {
  return async (req, server) => {
    try {
      return await fn(req, server);
    } catch (err) {
      if (err instanceof HubError) return problem(err);
      console.error(err);
      return problem(new HubError("internal", "internal error"));
    }
  };
}

async function jsonBody(req: Request, code: string): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HubError(code, "the body must be JSON");
  }
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
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" },
  });
}

export function startServer(engine: Engine, port: number): Server<undefined> {
  const session = (req: Request) => engine.sessionFor(req.headers.get("Hermes-Session"));

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    development: process.env.NODE_ENV === "development",
    routes: {
      // Command Center UI (bundled from source by Bun's HTML import)
      "/": commandCenter,
      "/rounds/:id": commandCenter,

      // Agent API (transports spec)
      "/v1/hub": { GET: handle(() => Response.json(engine.hubInfo())) },
      "/v1/sessions": {
        POST: handle(async (req) => Response.json(engine.upsertSession(await jsonBody(req, "invalid_round")))),
      },
      "/v1/rounds": {
        POST: handle(async (req) => {
          const s = session(req);
          return Response.json(engine.submit(s, await jsonBody(req, "invalid_round")), { status: 201 });
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

      // Command Center endpoints (internal; never documented to Agents)
      "/cc/rounds": { GET: handle(() => Response.json({ rounds: engine.pending() })) },
      "/cc/rounds/:id/send": {
        POST: handle<"/cc/rounds/:id/send">(async (req) =>
          Response.json(engine.send(req.params.id, await jsonBody(req, "invalid_answer"))),
        ),
      },
      "/cc/events": {
        GET: (req, server) =>
          sse(req, server, (send) => {
            send("hello", { server_time: new Date().toISOString() });
            return engine.subscribe((e: HubEvent) => send(e.type, e));
          }),
      },
    },
    fetch: () => problem(new HubError("not_found", "no such endpoint")),
  });
}
