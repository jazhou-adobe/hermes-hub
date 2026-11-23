#!/usr/bin/env bash
# Live MCP checks against a throwaway Hub, in real time. Never part of `bun test`.
#
#   scripts/live-mcp.sh claude   Claude Code asks through hermes_ask, exits, the Human answers, the
#                                resumed session receives the Answer (needs `claude` logged in).
#   scripts/live-mcp.sh codex    Codex with its default 60 s tool_timeout_sec gets `pending` at 50 s
#                                and re-calls hermes_wait (needs `codex` logged in).
#   scripts/live-mcp.sh replay   Codex 0.133's captured wire replayed through `hermes mcp` with a
#                                60 s deadline per call (no login needed).
#
# Your own Claude Code and Codex config are untouched: the shim is passed with --mcp-config /
# -c overrides. Every JSON-RPC line is traced to <work>/trace.{in,out}.jsonl; the work dir is printed.
set -euo pipefail

MODE=${1:?usage: scripts/live-mcp.sh claude|codex|replay}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/hermes-live-mcp.XXXXXX)
export HERMES_HOME="$WORK/home"
mkdir -p "$HERMES_HOME" "$WORK/proj"
printf 'port = %s\n' "${HERMES_LIVE_PORT:-4798}" > "$HERMES_HOME/config.toml"
git -C "$WORK/proj" init -q

bun "$ROOT/src/cli/main.ts" migrate > /dev/null
bun "$ROOT/src/cli/main.ts" hub > "$WORK/hub.log" 2>&1 &
HUB_PID=$!
trap 'kill "$HUB_PID" 2> /dev/null || true; echo "work dir: $WORK"' EXIT
until [ -f "$HERMES_HOME/hub.json" ]; do sleep 0.2; done
HUB=$(jq -r .url "$HERMES_HOME/hub.json")
echo "Hub: $HUB"

# The shim, with every line between the client and `hermes mcp` traced.
cat > "$WORK/shim.sh" << EOF
#!/usr/bin/env bash
export HERMES_HUB_URL=$HUB
tee -a "$WORK/trace.in.jsonl" | bun "$ROOT/src/cli/main.ts" mcp | tee -a "$WORK/trace.out.jsonl"
EOF
chmod +x "$WORK/shim.sh"

# Run the clients as from a plain terminal, without the calling agent's own identity variables.
clean_env() {
  env -u AGENT -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID -u OMPCODE -u PI_SESSION_FILE \
    -u PI_SESSION_ID -u PI_TERMINAL_OWNER_PID -u PI_TOOL_CALL_ID -u CODEX_THREAD_ID -u CODEX_SESSION_ID "$@"
}

pending_round() {
  curl -sf "$HUB/cc/rounds" | jq -r '[.rounds[] | select(.status == "pending")][0].id // empty'
}

# Waits for the Round the client ($1, a pid) submits; fails if it exits first (e.g. not logged in; output in $2).
wait_for_round() {
  local id=""
  until [ -n "$id" ]; do
    kill -0 "$1" 2> /dev/null || { echo "the client exited before asking:" >&2; cat "$2" >&2; exit 1; }
    sleep 1
    id=$(pending_round)
  done
  echo "$id"
}

# The Human sends the Recommended option (else the first) of every single-choice Question.
answer() {
  local body
  body=$(curl -sf "$HUB/cc/rounds/$1" | jq -c '{questions: ([.view.round.questions[] | {key: .id, value: {value: {selected: (.recommended // .options[0].id)}}}] | from_entries)}')
  curl -sf -X POST -H 'Content-Type: application/json' -d "$body" "$HUB/cc/rounds/$1/send" | jq -c '{round_id, outcome, questions}'
}

ASK='Use the hermes MCP server'"'"'s hermes_ask tool to ask the Human one decision: which database the billing service should use. Make it a single-choice Question with id "db", options "postgres" (label Postgres, recommended) and "sqlite" (label SQLite), and the default wait policy.'

case "$MODE" in
  claude)
    printf '{"mcpServers":{"hermes":{"type":"stdio","command":"%s","args":[]}}}\n' "$WORK/shim.sh" > "$WORK/mcp.json"
    TOOLS=(mcp__hermes__hermes_ask mcp__hermes__hermes_wait mcp__hermes__hermes_inbox mcp__hermes__hermes_cancel)
    cd "$WORK/proj"
    echo "== run 1: ask, then exit"
    clean_env claude -p --mcp-config "$WORK/mcp.json" --strict-mcp-config --allowedTools "${TOOLS[@]}" --output-format json \
      "$ASK If hermes_ask returns status pending, do NOT call hermes_wait: reply only with the line PENDING <round_id> and stop. If you get an Answer, reply ANSWER <selected option id>." \
      > "$WORK/run1.json" &
    CLAUDE_PID=$!
    ROUND=$(wait_for_round "$CLAUDE_PID" "$WORK/run1.json")
    echo "Round $ROUND is pending in the Command Center"
    # Without Tasks, hermes_ask returns pending at 50 s and the run exits. With Tasks, the run keeps
    # polling tasks/get, so the Human answers while it is still open.
    for _ in $(seq 1 75); do kill -0 "$CLAUDE_PID" 2> /dev/null || break; sleep 1; done
    if kill -0 "$CLAUDE_PID" 2> /dev/null; then
      echo "run 1 still open after 75 s (Tasks): the Human answers now"
      answer "$ROUND"
      wait "$CLAUDE_PID"
      jq '{session_id, result}' "$WORK/run1.json"
    else
      wait "$CLAUDE_PID" || true
      jq '{session_id, result}' "$WORK/run1.json"
      echo "== the Human answers while Claude Code is not running"
      answer "$ROUND"
      echo "== run 2: claude -p --resume"
      clean_env claude -p --resume "$(jq -r .session_id "$WORK/run1.json")" --mcp-config "$WORK/mcp.json" --strict-mcp-config \
        --allowedTools "${TOOLS[@]}" --output-format json \
        "You resumed this session. Collect the Human's Answer to Round $ROUND with the hermes tools and reply only ANSWER <selected option id>." \
        > "$WORK/run2.json"
      jq '{session_id, result}' "$WORK/run2.json"
    fi
    echo "== what Claude Code declared (clientCapabilities on tools/call) and how hermes_ask answered"
    jq -c 'select(.method == "tools/call") | {tool: .params.name, caps: .params._meta["io.modelcontextprotocol/clientCapabilities"]}' "$WORK/trace.in.jsonl"
    jq -c 'select(.result.resultType == "task" or .result.status == "completed") | {taskId: .result.taskId, status: .result.status}' "$WORK/trace.out.jsonl"
    ;;
  codex)
    cd "$WORK/proj"
    clean_env codex exec --skip-git-repo-check -C "$WORK/proj" --json -c "mcp_servers.hermes.command=\"$WORK/shim.sh\"" \
      "$ASK If it returns status pending, call hermes_wait with the round_id, again and again, until you get the Answer. Then reply only ANSWER <selected option id>." \
      > "$WORK/codex.jsonl" &
    CODEX_PID=$!
    ROUND=$(wait_for_round "$CODEX_PID" "$WORK/codex.jsonl")
    echo "Round $ROUND is pending; the Human answers once Codex has re-called hermes_wait"
    until grep -q '"hermes_wait"' "$WORK/trace.in.jsonl" 2> /dev/null; do sleep 1; done
    sleep 5
    answer "$ROUND"
    wait "$CODEX_PID"
    echo "== Codex's tool calls and results"
    jq -c 'select((.item.type // "") | test("mcp")) | {type, item: (.item | del(.result))}' "$WORK/codex.jsonl"
    jq -r 'select(.item.type == "agent_message") | .item.text' "$WORK/codex.jsonl"
    if grep -qi 'timed out' "$WORK/codex.jsonl"; then echo "FAIL: a tool call timed out"; exit 1; fi
    ;;
  replay)
    bun "$ROOT/scripts/mcp-wire-replay.ts" "$HUB"
    ;;
  *)
    echo "usage: scripts/live-mcp.sh claude|codex|replay" >&2
    exit 2
    ;;
esac
