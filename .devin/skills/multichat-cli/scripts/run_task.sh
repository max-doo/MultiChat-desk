#!/usr/bin/env bash
# Submit a MultiChat agent task and poll until a terminal phase.
# Prints the final task view JSON (contains `reply` when phase=done) to stdout.
#
# Usage:
#   run_task.sh --platform <id> [--research] [--timeout SEC] [--poll SEC] [--conversation URL]
#               [--query TEXT | --query-file FILE | stdin]
#
# Env:
#   MULTICHAT_CLI   CLI entrypoint override, e.g. "node out/cli/index.js"
#                   or "/path/to/cli/multichat.cmd". Default: `multichat` on PATH.
set -euo pipefail

PLATFORM="" RESEARCH="" TIMEOUT="" POLL=120 CONVERSATION="" QUERY="" QUERY_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2;;
    --research) RESEARCH="--research"; shift;;
    --timeout) TIMEOUT="$2"; shift 2;;
    --poll) POLL="$2"; shift 2;;
    --conversation) CONVERSATION="$2"; shift 2;;
    --query) QUERY="$2"; shift 2;;
    --query-file) QUERY_FILE="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$PLATFORM" ] || { echo "missing --platform" >&2; exit 2; }

CLI=${MULTICHAT_CLI:-multichat}

args=(task submit --platform "$PLATFORM" --wait "$POLL")
[ -n "$RESEARCH" ] && args+=("$RESEARCH")
[ -n "$TIMEOUT" ] && args+=(--timeout "$TIMEOUT")
[ -n "$CONVERSATION" ] && args+=(--conversation "$CONVERSATION")
[ -n "$QUERY" ] && args+=(--query "$QUERY")
[ -n "$QUERY_FILE" ] && args+=(--query-file "$QUERY_FILE")

out=$($CLI "${args[@]}")
task_id=$(printf '%s' "$out" | sed -n 's/.*"taskId": *"\([^"]*\)".*/\1/p' | head -1)
phase=$(printf '%s' "$out" | sed -n 's/.*"phase": *"\([^"]*\)".*/\1/p' | head -1)

# Poll until terminal; done/failed/cancelled end the loop.
while [ -n "$task_id" ] && ! printf '%s' "$phase" | grep -qE '^(done|failed|cancelled)$'; do
  out=$($CLI task status "$task_id" --wait "$POLL")
  phase=$(printf '%s' "$out" | sed -n 's/.*"phase": *"\([^"]*\)".*/\1/p' | head -1)
done

printf '%s\n' "$out"
