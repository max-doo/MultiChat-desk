---
name: multichat-cli
description: Delegate prompts to real web AI platforms (ChatGPT, Gemini, Claude, DeepSeek, Grok, Qwen, Kimi, Doubao, Perplexity, ChatGLM, YiYan, YuanBao, Arena) through the MultiChat desktop app's logged-in browser sessions via its local CLI. Use when the user wants to ask an external AI a question, run Deep Research / web research on a platform, get a second opinion, draft or review a design/plan/document with another model, follow up inside an existing web conversation, or fan out one query to multiple platforms. Requires the MultiChat desktop app to be running; do NOT use for tasks the local agent can do itself or for non-AI CLI work.
---

# MultiChat CLI

Drive the MultiChat desktop app's AI-platform webview sessions from the command line. The CLI is a thin client over a local daemon (named pipe + token auth, handled automatically); every command talks to the running app.

## Invocation

Resolve the CLI entrypoint in this order:

1. `multichat` if already on `PATH` (the Windows installer offers "install multichat command and add to PATH" during setup).
2. Repo dev build: `node out/cli/index.js` (built by `npm run build:cli`, part of `npm run build`). Plain Node works — no `ELECTRON_RUN_AS_NODE` needed for the bundled file.
3. Packaged install: `cli\multichat.cmd` under the Windows install dir, or `multichat.sh` at `MultiChat.app/Contents/` (macOS); these set `ELECTRON_RUN_AS_NODE=1` internally.

Examples below use `multichat`; substitute the resolved entrypoint.

## Preflight (always do this first)

```bash
multichat daemon status   # app running? exit 0 = yes
multichat platforms       # adapted platforms + capabilities
```

- If `daemon status` fails (`DAEMON_UNAVAILABLE`, exit 1): the desktop app is not running — tell the user to start MultiChat. Do not retry loops.
- `platforms` returns `[{id, deepResearch, busySignal, followUp}]`. Use it to pick a platform instead of hardcoding: `deepResearch=true` → `--research` is safe; `busySignal=adapted` → completion detection is reliable; `generic` → completion relies on reply-stability heuristic (still works, just less certain).
- The platform must be **logged in** inside MultiChat (sessions share the app's `persist:shared` login state). `PAGE_NOT_READY`/`AUTH_LOST` mid-task usually means login expired — ask the user to re-login in the app.

## Core workflow: submit → wait → result

Tasks are async. `submit` returns a `taskId` immediately; the daemon runs the page automation (new conversation → inject prompt → poll reply until stable).

```bash
# One-shot: submit and block up to Ns server-side (single request; safe default)
multichat task submit --platform gemini --query "对比 Electron 与 Tauri 的内存占用" --wait 300 --json

# Long polls: loop status --wait until a terminal phase
multichat task status <taskId> --wait 120 --json

# Full result (usually unnecessary: a done status view already embeds `reply`)
multichat task result <taskId> --json
```

`scripts/run_task.sh` wraps the submit+poll loop — prefer it over hand-rolling polling:

```bash
scripts/run_task.sh --platform chatgpt --wait 600 --query "评审以下设计：..."
cat prompt.md | scripts/run_task.sh --platform claude   # stdin query
```

Response contract (stdout, `--json` is the default — never pass prompts/results through stderr):

```json
{ "success": true, "data": { "taskId": "...", "phase": "done", "reply": "<markdown>", "conversationUrl": "...", "replyChars": 1234, "elapsedMs": 42000 } }
```

- Phases: `queued → preparing → sending → generating → done|failed|cancelled`. A `--wait` that expires mid-task still exits 0 with the live phase — keep polling.
- `queued`/`queuedPosition` means another task holds that platform's session (per-platform FIFO; different platforms run in parallel).
- When `phase=done`, `data.reply` is the full Markdown answer and `data.conversationUrl` enables follow-ups.
- `--text` flag switches to human-readable output; omit it in automation.

## Recipes

**Deep research / web research** (long-running report; only on `deepResearch=true` platforms):

```bash
multichat task submit --platform gemini --research \
  --query-file research-brief.md --timeout 1800 --wait 600 --json
# then keep polling: task status <taskId> --wait 600
```

**Draft or review a plan/design** (large context → stdin or `--query-file`, 100k char cap):

```bash
cat design.md | multichat task submit --platform claude --wait 300
```

**Follow-up in the same conversation** (keeps the model's context):

```bash
multichat task submit --platform chatgpt --conversation <conversationUrl> \
  --query "把第 3 节展开成实施步骤" --wait 300
```

**Fan out one query to several platforms** (submit in parallel; collect each by its own taskId):

```bash
for p in chatgpt gemini claude; do
  multichat task submit --platform $p --query-file q.md &
done; wait
```

**Cancel / inspect**:

```bash
multichat task cancel <taskId>     # idempotent; prompt may already be sent if past `sending`
multichat task list --all          # active + persisted history
```

## Limits & semantics

- `--timeout` = task hard timeout (default 600s chat / 1800s research, max 7200). `--queue-timeout` = max time in queue (default = timeout). `--wait` = this call's block time only — it does not extend the task timeout.
- `--model` is **declarative metadata only** — it does not switch the model in the web page; the page's currently selected model is used. Say so if the user expects real model switching.
- `--conversation` URL must belong to the same platform and be a conversation URL (not home/login page), else `INVALID_PARAMS`.
- Query input priority: piped stdin > `--query-file` > `--query`. Max 100,000 chars → `INVALID_PARAMS` when exceeded.
- A task occupies the platform's background session window; per-platform tasks serialize. UI actions (logout, account switch) can kill running tasks (`AUTH_LOST`/`SESSION_LOST`) — warn the user not to touch those accounts in the app while tasks run.
- Replies and queries are sensitive: quote only what's needed; do not exfiltrate conversation contents to third parties.

## Error codes (top-level `code` field; exit codes 0 ok / 1 failed / 2 bad params)

| code | meaning | agent action |
|---|---|---|
| `DAEMON_UNAVAILABLE` | app not running / unauthorized | ask user to start MultiChat; stop retrying |
| `INVALID_PARAMS` | bad/missing args, bad `--conversation` URL, query >100k | fix arguments and retry |
| `PLATFORM_UNKNOWN` | platform has no selectors | pick another id from `platforms` |
| `CAPABILITY_UNSUPPORTED` | e.g. `--research` on non-adapted platform | drop flag or switch platform |
| `PAGE_NOT_READY` | page not ready (logged out/captcha/load fail) | ask user to check login in app |
| `AUTH_LOST` | session jumped to login wall mid-task | ask user to re-login; resubmit |
| `NOT_BLANK_CONVERSATION` | "new chat" page wasn't blank | retry; if persistent, report bug |
| `SESSION_LOST` | window destroyed / app quit | resubmit after app restart |
| `SEND_FAILED` | prompt injection/submit failed | retry once; then report |
| `TASK_TIMEOUT` / `QUEUE_TIMEOUT` | hit hard/queue timeout | resubmit with larger `--timeout` |
| `TASK_CANCELLED` | cancelled by caller | — |
| `TASK_NOT_FOUND` | unknown taskId | check `task list --all` |
| `INTERNAL` | uncategorized | report with taskId |
