#!/usr/bin/env bash
# Live Hub Skill checks: a real Agent completes a Round knowing Hermes only from the Hub Skill (or,
# on Claude Code, from the hermes mcp shim's tool descriptions), against a throwaway Hub. Never part
# of `bun test`.
#
#   scripts/live-skill.sh codex   `codex exec` under workspace-write with the doctor's snippet
#                                 (network_access = true) applied as a -c override; Codex finds the
#                                 Skill in the project's .agents/skills (needs `codex` logged in).
#   scripts/live-skill.sh claude  `claude -p` with the shim registered the way `hermes setup claude`
#                                 does it, through --mcp-config (needs `claude` logged in).
#   scripts/live-skill.sh omp     sets up the Hub and the project, prints the task to hand to an omp
#                                 agent, then plays the Human and waits for the Agent to finish.
#
# This script plays the Human: it answers the Agent's first Round with the Recommended options, a
# while after it arrives, so the Agent really has to wait. Then it reports every hermes command (or
# hermes_* tool call) the Agent made: one ask and no polling is a pass. Your own client config is
# untouched; `hermes` is a wrapper in <work>/bin bound to this checkout and the throwaway Hub.
set -euo pipefail

MODE=${1:?usage: scripts/live-skill.sh codex|claude|omp}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/hermes-live-skill.XXXXXX)
export HERMES_HOME="$WORK/home"
ANSWER_AFTER=${HERMES_LIVE_ANSWER_AFTER:-20}
mkdir -p "$HERMES_HOME" "$WORK/bin" "$WORK/proj"
printf 'port = %s\n' "${HERMES_LIVE_PORT:-4796}" > "$HERMES_HOME/config.toml"

cat > "$WORK/bin/hermes" << EOF
#!/usr/bin/env bash
export HERMES_HOME="$HERMES_HOME"
exec bun "$ROOT/src/cli/main.ts" "\$@"
EOF
chmod +x "$WORK/bin/hermes"
export PATH="$WORK/bin:$PATH"

hermes migrate > /dev/null
hermes hub > "$WORK/hub.log" 2>&1 &
HUB_PID=$!
trap 'kill "$HUB_PID" 2> /dev/null || true; echo "work dir: $WORK"' EXIT
until [ -f "$HERMES_HOME/hub.json" ]; do sleep 0.2; done
HUB=$(jq -r .url "$HERMES_HOME/hub.json")
echo "Hub: $HUB"

PROJ="$WORK/proj"
git -C "$PROJ" init -q
printf '# billing-service\n\nA small Node service. It has no logging yet.\n' > "$PROJ/README.md"
git -C "$PROJ" add README.md
git -C "$PROJ" -c user.name=live -c user.email=live@example.invalid commit -qm init
(cd "$PROJ" && hermes skill install)

TASK="This project needs a logging library, pino or winston, and that choice belongs to the Human, not you. Ask the Human through Hermes Hub (you recommend pino), wait for their Answer, then write the id of the option they chose, alone, to choice.txt in the project root, and stop."

# Run the clients as from a plain terminal, without the calling agent's own identity variables.
clean_env() {
  env -u AGENT -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID -u OMPCODE -u PI_SESSION_FILE \
    -u PI_SESSION_ID -u PI_TERMINAL_OWNER_PID -u PI_TOOL_CALL_ID -u CODEX_THREAD_ID -u CODEX_SESSION_ID "$@"
}

pending_round() {
  curl -sf "$HUB/cc/rounds" | jq -r '[.rounds[] | select(.status == "pending")][0].id // empty'
}

# Waits for the first Round; with a pid ($1), fails if that process exits first (e.g. not logged in; output in $2).
wait_for_round() {
  local id=""
  until [ -n "$id" ]; do
    if [ -n "${1:-}" ] && ! kill -0 "$1" 2> /dev/null; then
      echo "the Agent exited before asking:" >&2
      tail -c 4000 "$2" >&2
      exit 1
    fi
    sleep 1
    id=$(pending_round)
  done
  echo "$id"
}

# The Human sends the Recommended option of every Question (else the first option, "ok", approve).
answer() {
  local body
  body=$(curl -sf "$HUB/cc/rounds/$1" | jq -c '{questions: ([.view.round.questions[] | {key: .id, value: {value: (
    if .kind == "single" then {selected: (.recommended // .options[0].id)}
    elif .kind == "multi" then {selected: (.recommended // [.options[0].id])}
    elif .kind == "text" then {text: (.recommended // "ok")}
    else {decision: (.recommended // "approve"), edited: false} end)}}] | from_entries)}')
  curl -sf -X POST -H 'Content-Type: application/json' -d "$body" "$HUB/cc/rounds/$1/send" | jq -c '{round_id, outcome, questions}'
}

# Plays the Human for the Agent running as $1 (output in $2).
human() {
  local round
  round=$(wait_for_round "${1:-}" "${2:-/dev/null}")
  echo "Round $round arrived; the Human answers in $ANSWER_AFTER s"
  sleep "$ANSWER_AFTER"
  answer "$round"
}

verdict() {
  echo "== choice.txt: $(cat "$PROJ/choice.txt" 2> /dev/null || echo '(missing)')"
  echo "== Rounds the Hub received (pending ones, then the answered log)"
  curl -sf "$HUB/cc/rounds" | jq -c '.rounds[] | {id, status, title: .round.title}'
  curl -sf "$HUB/cc/log" | jq -c '.entries[] | {id: .answer.round_id, callsign: .meta.callsign, outcome: .answer.outcome, title: .round.title, delivered_at: .meta.delivered_at}'
}

case "$MODE" in
  codex)
    clean_env codex exec --json -C "$PROJ" -s workspace-write -c sandbox_workspace_write.network_access=true "$TASK" \
      > "$WORK/codex.jsonl" 2> "$WORK/codex.err" &
    AGENT_PID=$!
    human "$AGENT_PID" "$WORK/codex.err"
    wait "$AGENT_PID" || echo "codex exited with $?"
    echo "== Codex's commands (one hermes ask, no hermes wait/inbox loop, no sleep = no polling)"
    jq -r 'select(.type == "item.completed" and .item.type == "command_execution") | .item.command' "$WORK/codex.jsonl"
    echo "== hermes ask: $(jq -r 'select(.type == "item.completed" and .item.type == "command_execution") | .item.command' "$WORK/codex.jsonl" | grep -c 'hermes ask' || true)," \
      "hermes wait/inbox: $(jq -r 'select(.type == "item.completed" and .item.type == "command_execution") | .item.command' "$WORK/codex.jsonl" | grep -cE 'hermes (wait|inbox)' || true)"
    verdict
    ;;
  claude)
    # What `hermes setup claude` registers (claude mcp add --scope user hermes -- hermes mcp), passed
    # per run instead so the user-scope config stays untouched.
    printf '{"mcpServers":{"hermes":{"type":"stdio","command":"hermes","args":["mcp"]}}}\n' > "$WORK/mcp.json"
    cd "$PROJ"
    clean_env claude -p --mcp-config "$WORK/mcp.json" --strict-mcp-config \
      --allowedTools "mcp__hermes__hermes_ask,mcp__hermes__hermes_wait,mcp__hermes__hermes_inbox,mcp__hermes__hermes_cancel,Write" \
      --output-format stream-json --verbose "$TASK" > "$WORK/claude.jsonl" 2> "$WORK/claude.err" &
    AGENT_PID=$!
    human "$AGENT_PID" "$WORK/claude.jsonl"
    wait "$AGENT_PID" || echo "claude exited with $?"
    echo "== Claude Code's tool calls (one hermes_ask, then waiting on its Task or hermes_wait; no inbox loop)"
    jq -c 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | {name, input: (.input | tostring | .[0:120])}' "$WORK/claude.jsonl"
    verdict
    ;;
  omp)
    cat << EOF
== Hand this to an omp agent (the project has the Skill installed; hermes is $WORK/bin/hermes):

Work in $PROJ. Read and follow the skill at $PROJ/.agents/skills/hermes-hub/SKILL.md for anything
that involves the Human. Run every shell command with PATH=$WORK/bin:\$PATH so that \`hermes\` resolves.
$TASK

== The Human answers the first Round $ANSWER_AFTER s after it arrives; this script then waits for choice.txt.
EOF
    human
    until [ -s "$PROJ/choice.txt" ]; do sleep 1; done
    verdict
    ;;
  *)
    echo "usage: scripts/live-skill.sh codex|claude|omp" >&2
    exit 2
    ;;
esac
