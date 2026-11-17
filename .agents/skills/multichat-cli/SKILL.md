---
name: multichat-cli
description: Delegate prompts to real web AI platforms (ChatGPT, Gemini, Claude, DeepSeek, Grok, Qwen, Kimi, Doubao, Perplexity, ChatGLM, YiYan, YuanBao, Arena) through the MultiChat desktop app's logged-in browser sessions via its local CLI. Use when the user wants to ask an external AI a question, run Deep Research / web research on a platform, get a second opinion, draft or review a design/plan/document with another model, follow up inside an existing web conversation, or fan out one query to multiple platforms. Requires the MultiChat desktop app to be running; do NOT use for tasks the local agent can do itself or for non-AI CLI work.
---

# MultiChat CLI

Drive the MultiChat desktop app's AI-platform webview sessions from the command line. The CLI is a thin client over a local daemon (named pipe + token auth, handled automatically); every command talks to the running app.

## Invocation

Resolve the CLI entrypoint in this order:

1. **`cli.json` manifest** in the app data dir (same dir as `daemon.token`; the running app rewrites it on startup): `%APPDATA%\{MultiChat,MultiChat-dev,multichat,multichat-dev}\cli.json` → `cliCmdPath`. One file read gives the definitive path and also covers portable installs — check it first.
2. `multichat` if already on `PATH` (the Windows installer offers "install multichat command and add to PATH" during setup). Note: a PATH added during install only reaches *new* processes — a long-running agent shell inherits its parent's stale PATH, so "command not found" here means stale environment, not a missing install. Do NOT conclude the CLI is absent; continue to step 3/4.
3. Repo dev build: `node out/cli/index.js` (built by `npm run build:cli`, part of `npm run build`). Plain Node works — no `ELECTRON_RUN_AS_NODE` needed for the bundled file.
4. Packaged install: `cli\multichat.cmd` under the Windows install dir, or `multichat.sh` at `MultiChat.app/Contents/` (macOS); these set `ELECTRON_RUN_AS_NODE=1` internally.

   On Windows, locate the install dir **deterministically** from the uninstall registry — do not search the disk or guess paths. (electron-builder does not write `InstallLocation`; derive it from `DisplayIcon`/`UninstallString`):

   ```powershell
   Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -EA SilentlyContinue |
     ? { $_.DisplayName -like 'MultiChat*' } | % {
       if ($_.DisplayIcon) { Split-Path ($_.DisplayIcon -split ',')[0].Trim('"') }
       elseif ($_.UninstallString -match '^"([^"]+)"') { Split-Path $Matches[1] }
     } | select -First 1
   # then: <dir>\cli\multichat.cmd
   ```

   Portable (zip) installs and pre-manifest builds have no `cli.json`/uninstall entry — fall back to the running process path (the daemon must be running for tasks anyway) or set `MULTICHAT_CLI`:

   ```powershell
   (Get-Process MultiChat -EA SilentlyContinue | select -First 1 -Expand Path | Split-Path) + '\cli\multichat.cmd'
   ```

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
# Phase 1 — submit WITHOUT --wait: the taskId comes back in one round trip.
# Capture it before any blocking call.
multichat task submit --platform gemini --query "对比 Electron 与 Tauri 的内存占用" --json

# Phase 2 — block on the status long-poll. If your shell/tool has a short
# foreground timeout, run this as a BACKGROUND command, not foreground.
multichat task status <taskId> --wait 300 --json

# One-shot variant for interactive shells only (no taskId until the call ends):
multichat task submit --platform gemini --query "..." --wait 300 --json

# Full result (usually unnecessary: a done status view already embeds `reply`)
multichat task result <taskId> --json
```

**If a submit call is killed or times out in your harness, the daemon-side task keeps running** — killing the client never cancels it. `submit --wait` emits the submit ack (`{"taskId":...,"phase":...}`) on **stderr** as soon as the task is accepted, before it blocks — capture stderr to keep the taskId even if the call is killed. Without it (older CLIs): `multichat task list --all` to recover the live taskId, `task cancel <taskId>` to stop it, or resubmit with the same `--idempotency-key` (in-memory dedupe returns the existing task instead of queueing a duplicate). Blindly resubmitting without a key creates a duplicate that queues behind the first on the same platform (per-platform FIFO), doubling the wait.

**Query text on Windows: prefer stdin or `--query-file` over `--query`.** Prompts go through the `.cmd` shim's `%*`, which mangles embedded quotes/special chars — especially with non-ASCII text. `cat file | multichat ...` and `--query-file` bypass this entirely.

**stdin caveat:** stdin is only read when *neither* `--query` nor `--query-file` is given — explicit args always win. On CLI builds ≤1.3.1 stdin was read unconditionally first, so an always-open stdin pipe hung every submit regardless of flags; if you're stuck on such a build, feed a closed stdin: `'' | multichat task submit ...` (PowerShell) or `printf '' | multichat task submit ...` / `</dev/null` (bash).

`scripts/run_task.sh` (bash) / `scripts/run_task.ps1` (PowerShell) wrap the submit+poll loop, including entrypoint resolution — prefer them over hand-rolling polling:

```bash
scripts/run_task.sh --platform chatgpt --poll 600 --query "评审以下设计：..."
cat prompt.md | scripts/run_task.sh --platform claude        # stdin query
scripts/run_task.ps1 -Platform deepseek -Query "..."         # PowerShell
```

Response contract (stdout, `--json` is the default — never pass prompts/results through stderr):

```json
{ "success": true, "data": { "taskId": "...", "phase": "done", "reply": "<markdown>", "conversationUrl": "...", "replyChars": 1234, "elapsedMs": 42000 } }
```

- Phases: `queued → preparing → sending → generating → done|failed|cancelled`. A `--wait` that expires mid-task still returns `success:true` with the live phase — judge completion by `data.phase` reaching a terminal state (`done`/`failed`/`cancelled`), never by exit code or `success` alone.
- `queued`/`queuedPosition` means another task holds that platform's session (per-platform FIFO; different platforms run in parallel).
- When `phase=done`, `data.reply` is the full Markdown answer and `data.conversationUrl` enables follow-ups.
- `--text` flag switches to human-readable output; omit it in automation.

## Recipes

**Deep research / web research** (long-running report; only on `deepResearch=true` platforms):

```bash
multichat task submit --platform gemini --research \
  --query-file research-brief.md --timeout 1800 --json
# then keep polling in background: task status <taskId> --wait 600
```

**Draft or review a plan/design** (large context → stdin or `--query-file`, 100k char cap):

```bash
cat design.md | multichat task submit --platform claude --json
# then: task status <taskId> --wait 300
```

**Follow-up in the same conversation** (keeps the model's context):

```bash
multichat task submit --platform chatgpt --conversation <conversationUrl> \
  --query "把第 3 节展开成实施步骤" --json
# then: task status <taskId> --wait 300
```

**Attach image(s)** — UI/screenshot/style analysis, design review (repeatable up to 10, `query` optional when at least one image is given):

```bash
multichat task submit --platform gemini \
  --image ./docs/home.png --image ./docs/settings.png \
  --query "分析这几张截图的 UI 风格并给出改进建议" --json
# image-only: no --query/--query-file → stdin is still read for optional text;
# feed a closed stdin (printf '' | multichat ... or </dev/null) so it can't hang.
printf '' | multichat task submit --platform claude --image ./shot.png --json
# then: task status <taskId> --wait 300
```

**Fan out one query to several platforms** (submit each without `--wait` — returns instantly; then one blocking status call per task, in background):

```bash
for p in chatgpt gemini claude; do
  multichat task submit --platform $p --query-file q.md   # capture each taskId
done
multichat task status <id1> --wait 600 &
multichat task status <id2> --wait 600 &
multichat task status <id3> --wait 600 &
wait
```

**Cancel / inspect**:

```bash
multichat task cancel <taskId>     # idempotent; prompt may already be sent if past `sending`
multichat task list --all          # active + persisted history
```

## Limits & semantics

- `--timeout` = task hard timeout (default 600s chat / 1800s research, max 7200). `--queue-timeout` = max time in queue (default = timeout). `--wait` = this call's block time only — it does not extend the task timeout.
- `--idempotency-key <key>` = same platform+key while the task is live (or finished in-memory) returns the existing taskId instead of queueing a duplicate — pass a stable key when your submit might be retried. In-memory only; an app restart forgets it.
- Query input: stdin is read only when neither `--query` nor `--query-file` is given. Max 100,000 chars → `INVALID_PARAMS` when exceeded.
- `--image <path>` attaches a local image to the task; repeatable up to 10 files. Relative paths resolve client-side to absolute; the file must exist → `INVALID_PARAMS` (exit 2) otherwise. Uploads reuse the app's drag-drop file-upload path (per file: drop → platform finishes parsing → next file); a platform that rejects the file type or never finishes parsing surfaces as `SEND_FAILED` with the reason. `query` may be empty when ≥1 `--image` is given (image-only ask).
- Client lifetime ≠ task lifetime: a killed/disconnected CLI call leaves the daemon task running and still holding its platform queue slot. Recover with `task list --all`, stop with `task cancel <taskId>`.
- `--model` is **declarative metadata only** — it does not switch the model in the web page; the page's currently selected model is used. Say so if the user expects real model switching.
- `--conversation` URL must belong to the same platform and be a conversation URL (not home/login page), else `INVALID_PARAMS`.
- A task occupies the platform's background session window; per-platform tasks serialize. UI actions (logout, account switch) can kill running tasks (`AUTH_LOST`/`SESSION_LOST`) — warn the user not to touch those accounts in the app while tasks run.
- Replies and queries are sensitive: quote only what's needed; do not exfiltrate conversation contents to third parties.

## Error codes (top-level `code` field; exit codes 0 ok / 1 failed / 2 bad params)

**Do not trust the exit code alone on Windows installs ≤1.3.1** — the shipped `multichat.cmd` shim swallowed it (`endlocal` reset `ERRORLEVEL`), so every command exited 0. Always branch on the JSON `success`/`code` fields.

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
| `SEND_FAILED` | prompt injection/submit or `--image` upload failed | retry once; then report |
| `TASK_TIMEOUT` / `QUEUE_TIMEOUT` | hit hard/queue timeout | resubmit with larger `--timeout` |
| `TASK_CANCELLED` | cancelled by caller | — |
| `TASK_NOT_FOUND` | unknown taskId | check `task list --all` |
| `INTERNAL` | uncategorized | report with taskId |
