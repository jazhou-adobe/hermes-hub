# Research notes

These notes were researched against primary sources during Phase 1 planning. Each one lives on its own `research/*` branch as a primary source and is cited by the specs.

| Note | Question | Ticket |
|---|---|---|
| [Agent ↔ hub ↔ human transport options](https://github.com/jazhou-adobe/hermes-hub/blob/research/agent-human-transport-options/docs/research/agent-human-transport-options.md) | Communication architectures, client timeouts, async resumption, prior art | Charting |
| [MCP on Bun: Streamable HTTP + Tasks](https://github.com/jazhou-adobe/hermes-hub/blob/research/mcp-bun-tasks/docs/research/mcp-bun-tasks.md) | Can a Bun Hub serve MCP with Tasks on the current TypeScript SDK? | [#3](https://github.com/jazhou-adobe/hermes-hub/issues/3) |
| [LAN and tailnet exposure and auth](https://github.com/jazhou-adobe/hermes-hub/blob/research/lan-tailnet-exposure-auth/docs/research/lan-tailnet-exposure-auth.md) | TLS, Agent and Human auth, and cloud sandboxes. The Hub later became local only. | [#4](https://github.com/jazhou-adobe/hermes-hub/issues/4) |
| [Agent detection signals](https://github.com/jazhou-adobe/hermes-hub/blob/research/agent-detection-signals/docs/research/agent-detection-signals.md) | Which env vars, `_meta` and `clientInfo` identify each client and session | [#5](https://github.com/jazhou-adobe/hermes-hub/issues/5) |
