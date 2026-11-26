import type { McpServerFactory } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { HubClient } from "../cli/client.ts";
import { detectSession, type IdentityFlags } from "../cli/identity.ts";
import { createMcpFactory, HUB_WAIT_SECONDS, realTimers, type Timers } from "./tools.ts";

/**
 * The `hermes-hub mcp` tool set: every call re-detects the caller (flags, the call's `_meta`,
 * `clientInfo`, the inherited environment) and calls `POST /v1/sessions`, as each CLI run does; the
 * token stays in memory. Then it proxies to the HTTP API.
 */
export function shimFactory(baseUrl: string, flags: IdentityFlags, timers: Timers = realTimers): McpServerFactory {
  return createMcpFactory(async ({ meta, clientInfo }) => {
    const client = new HubClient(baseUrl);
    // A stdio server's cwd depends on the client's config; Claude Code names the project explicitly.
    await client.openSession(detectSession(flags, process.env, process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), { meta, clientInfo }));
    return {
      submit: async (round) => (await client.submit(round)).round_id,
      get: (id) => client.round(id),
      async wait(id, signal) {
        try {
          return await client.round(id, HUB_WAIT_SECONDS, signal);
        } catch (err) {
          if (!signal.aborted) throw err;
        }
        return client.round(id); // the bound closed the long-poll: report the state as of now
      },
      cancel: (id) => client.cancel(id),
      inbox: () => client.inbox(),
    };
  }, timers);
}

/** Serves the shim on stdin/stdout until the client closes stdin. Nothing else may write to stdout. */
export function serveShim(baseUrl: string, flags: IdentityFlags): void {
  serveStdio(shimFactory(baseUrl, flags), { onerror: (err) => console.error(`hermes-hub mcp: ${err.message}`) });
}
