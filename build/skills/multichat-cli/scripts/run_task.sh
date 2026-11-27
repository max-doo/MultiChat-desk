#!/usr/bin/env bash
# Submit a MultiChat agent task and poll until a terminal phase.
# Prints the final task view JSON (contains `reply` when phase=done) to stdout.
# The taskId is echoed to stderr as JSON immediately after submit, so a killed
# wait still leaves the task recoverable via `multichat task list --all`.
#
# Usage:
#   run_task.sh --platform <id> [--research] [--gen-image] [--timeout SEC] [--poll SEC] [--conversation URL]
#               [--idempotency-key KEY] [--image FILE]... [--query TEXT | --query-file FILE | stdin]
#
# Env:
#   MULTICHAT_CLI   CLI entrypoint override: either a single executable path
#                   (may contain spaces) or a composite command like
#                   "node out/cli/index.js". Default: `multichat` on PATH.
set -euo pipefail

PLATFORM="" RESEARCH="" GEN_IMAGE="" TIMEOUT="" POLL=120 CONVERSATION="" QUERY="" QUERY_FILE="" IDEMPOTENCY_KEY=""
IMAGES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2;;
    --research) RESEARCH="--research"; shift;;
    --gen-image) GEN_IMAGE="--gen-image"; shift;;
    --timeout) TIMEOUT="$2"; shift 2;;
    --poll) POLL="$2"; shift 2;;
    --conversation) CONVERSATION="$2"; shift 2;;
    --idempotency-key) IDEMPOTENCY_KEY="$2"; shift 2;;
    --image) IMAGES+=("$2"); shift 2;;
    --query) QUERY="$2"; shift 2;;
    --query-file) QUERY_FILE="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$PLATFORM" ] || { echo "missing --platform" >&2; exit 2; }

CLI=${MULTICHAT_CLI:-multichat}

# 单个已存在文件路径（可含空格）整串引用；否则按词切分以支持 "node out/cli/index.js" 复合命令
if [ -f "$CLI" ]; then
  run_cli() { "$CLI" "$@"; }
else
  run_cli() { $CLI "$@"; }
fi

args=(task submit --platform "$PLATFORM")
[ -n "$RESEARCH" ] && args+=("$RESEARCH")
[ -n "$GEN_IMAGE" ] && args+=("$GEN_IMAGE")
[ -n "$TIMEOUT" ] && args+=(--timeout "$TIMEOUT")
[ -n "$CONVERSATION" ] && args+=(--conversation "$CONVERSATION")
[ -n "$IDEMPOTENCY_KEY" ] && args+=(--idempotency-key "$IDEMPOTENCY_KEY")
if [ ${#IMAGES[@]} -gt 0 ]; then
  for img in "${IMAGES[@]}"; do args+=(--image "$img"); done
fi
[ -n "$QUERY" ] && args+=(--query "$QUERY")
[ -n "$QUERY_FILE" ] && args+=(--query-file "$QUERY_FILE")

# Phase 1: submit WITHOUT --wait — taskId 一次往返即回。
# 显式 --query/--query-file 时给 CLI 一个立即 EOF 的空 stdin：否则宿主挂成不关闭
# 管道的 stdin 会被 CLI 的 readStdinIfPiped 无条件读死（CLI 无条件先读 stdin）。
if [ -n "$QUERY" ] || [ -n "$QUERY_FILE" ]; then
  if ! out=$(printf '' | run_cli "${args[@]}"); then printf '%s\n' "$out" >&2; exit 1; fi
else
  if ! out=$(run_cli "${args[@]}"); then printf '%s\n' "$out" >&2; exit 1; fi
fi
# 退出码在 ≤1.3.1 安装版 shim 上不可信（endlocal 吞 ERRORLEVEL）——必须看 JSON success
if ! printf '%s' "$out" | grep -q '"success": *true'; then printf '%s\n' "$out" >&2; exit 1; fi

task_id=$(printf '%s' "$out" | sed -n 's/.*"taskId": *"\([^"]*\)".*/\1/p' | head -1)
phase=$(printf '%s' "$out" | sed -n 's/.*"phase": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$task_id" ] && printf '{"taskId":"%s","phase":"%s"}\n' "$task_id" "$phase" >&2

# Phase 2: status 长轮询直到终态；done/failed/cancelled 结束循环。
while [ -n "$task_id" ] && ! printf '%s' "$phase" | grep -qE '^(done|failed|cancelled)$'; do
  if ! out=$(printf '' | run_cli task status "$task_id" --wait "$POLL"); then printf '%s\n' "$out" >&2; exit 1; fi
  if ! printf '%s' "$out" | grep -q '"success": *true'; then printf '%s\n' "$out" >&2; exit 1; fi
  phase=$(printf '%s' "$out" | sed -n 's/.*"phase": *"\([^"]*\)".*/\1/p' | head -1)
done

printf '%s\n' "$out"
