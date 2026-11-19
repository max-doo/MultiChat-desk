---
name: multichat-cli
description: Delegate prompts to real web AI platforms (ChatGPT, Gemini, Claude, DeepSeek, Grok, Qwen, Kimi, Doubao, Perplexity, ChatGLM, YiYan, YuanBao, Arena) through the MultiChat desktop app's logged-in browser sessions via its local CLI. Use when the user wants to ask an external AI a question, run Deep Research / web research on a platform, get a second opinion, draft or review a design/plan/document with another model, follow up inside an existing web conversation, or fan out one query to multiple platforms. Requires the MultiChat desktop app to be running; do NOT use for tasks the local agent can do itself or for non-AI CLI work.
---

# MultiChat CLI

Drive the MultiChat desktop app's AI-platform webview sessions from the command line. The CLI is a thin client over a local daemon (named pipe + token auth, handled automatically); every command talks to the running app.

## Invocation

Resolve the CLI entrypoint in this order:

1. **`cli.json` manifest** (same dir as `daemon.token`; the running app rewrites it on startup) → `cliCmdPath`. One file read gives the definitive path — check it first. Location by platform (app dir name is `multichat` or `MultiChat`, dev adds `-dev` — probe both):
   - Windows: `%APPDATA%\MultiChat\cli.json`
   - macOS: `~/Library/Application Support/multichat/cli.json`
   - Linux: `$XDG_CONFIG_HOME/multichat/cli.json` or `~/.config/multichat/cli.json`
2. `multichat` if already on `PATH` (the Windows installer offers "install multichat command and add to PATH" during setup). Note: a PATH added during install only reaches *new* processes — a long-running agent shell inherits its parent's stale PATH, so "command not found" here means stale environment, not a missing install. Do NOT conclude the CLI is absent; continue to step 3/4.
3. Repo dev build: `node out/cli/index.js` (built by `npm run build:cli`, part of `npm run build`). Plain Node works — no `ELECTRON_RUN_AS_NODE` needed for the bundled file.
4. Packaged install: `cli\multichat.cmd` under the Windows install dir, or `multichat.sh` at `MultiChat.app/Contents/` (macOS); these set `ELECTRON_RUN_AS_NODE=1` internally. If a `.sh` entrypoint is not executable (`Permission denied`), invoke it through `sh`/`bash` instead of relying on the exec bit.

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
- `platforms` returns `[{id, deepResearch, imageGeneration, imageDownload, busySignal, followUp, signedIn?, loginRequired}]`. Use it to pick a platform instead of hardcoding: `deepResearch=true` → `--research` is safe; `imageDownload=true` → `--gen-image` is safe (the submit-time check requires a configured download chain only; `imageGeneration` separately reports whether the page has a "generate image" mode toggle — a platform with `imageGeneration=true` but `imageDownload=false`, e.g. chatglm/kimi today, can open image mode in the UI but `--gen-image` still gets `CAPABILITY_UNSUPPORTED`). `busySignal=adapted` → the page's stop-streaming button is selector-adapted (currently chatgpt/claude/gemini/deepseek); `generic` (all other platforms) → completion relies on reply-stability heuristic — still works and is the normal path on those platforms, just less certain.
- `signedIn` is resolved from the app's `persist:shared` state through two channels that are both always consulted: account **cookies** (chatgpt/gemini/doubao/grok/qwen/yiyan/arena by name; chatglm/yuanbao by name **plus value**, because their guest sessions write the same cookie with `is_guest:true` / an `a_did_` prefix) and page **localStorage** (deepseek `userToken`, kimi `refresh_token`). `true` = logged in, `false` = guest, omitted = unknown (no list configured, or the page could not be read — e.g. Cloudflare interstitial for claude/perplexity). **Guest ≠ logged in**: gemini/doubao/yiyan/chatglm can answer as a guest but are still not logged in and are subject to guest quotas. `loginRequired=true` means guest mode cannot send at all (deepseek/qwen/claude/grok) — for those, `signedIn=false` fails fast at submit with `AUTH_REQUIRED` before any page work. Check with `multichat auth [platform]`; that command may load the site once to read localStorage, so it is slower than `platforms` (which stays cookie-only plus already-open pages and can report `unknown` for kimi/deepseek).
- `AUTH_REQUIRED` means the platform is not logged in (cookie check) or the page turned out to be a login wall/captcha before sending; `AUTH_LOST` means it dropped to one mid-task — in both cases ask the user to re-login in the app, then resubmit. `PAGE_NOT_READY` is now the fallback for unknown causes (slow render, load failure).
- Login detection covers `task.*` only. The legacy `exec`/`collect` actions return unstructured errors and are not part of this check.

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
bash scripts/run_task.sh --platform chatgpt --query "..."    # fallback if not executable
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

**Generate an image** — send an image prompt and have MultiChat save the produced image under the artifact dir:

```bash
# Requires imageDownload=true on the platform (check `multichat platforms`);
# the submit-time capability check only looks at the download chain, not
# imageGeneration — a platform without a "generate image" mode toggle can
# still satisfy --gen-image if your prompt itself drives image output.
# The prompt itself drives generation — --gen-image does NOT toggle any
# "image mode" button; it just sends the query and captures the produced image.
# Currently: chatgpt, yiyan, gemini, grok, qwen, doubao, yuanbao.
# --gen-image conflicts with --research.
multichat task submit --platform gemini --gen-image \
  --query "生成一只在窗边晒太阳的橘猫" --timeout 600 --json
# then: task status <taskId> --wait 600 --json
```

When `phase=done`, `data.imageFiles` holds the absolute path(s) of image(s) saved during the capture window — typically one (MultiChat clicks the newest image's native download button), but every `will-download` intercepted for that webview is collected, so check the array rather than assuming `[0]` is the only entry. `data.imageError` carries a non-fatal reason if the click/download missed (the text reply is still returned). Artifacts land under `--artifact-dir` (default `<cwd>/.multichat/`): images → `<dir>/image/`, reply TXT → `<dir>/results/`.

> **How it works**: `--gen-image` sends your prompt as a normal message (no "image mode" toggling), then polls the page for the platform's image element (`imageDownload.steps[0].selector`), clicks the native download button, and intercepts Electron's `will-download` to save the file. If the platform doesn't actually produce an image (wrong prompt, refused, no image quota), the task still completes `done` with the text reply and `imageError='生成超时未检测到图片'` — the text is never lost.

**Persisted artifacts**: every finished task writes its reply to `<artifact-dir>/results/{platform}-{taskId[:8]}.txt` (default `<cwd>/.multichat/results/`); the done-view JSON exposes it as `data.replyFile`. With `--text`, those paths go to **stderr** (`saved:` / `image:` lines) so stdout stays a clean reply body.

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
- `--gen-image` sends the prompt and captures the produced image via the platform's native download button; requires `imageDownload` capability (else `CAPABILITY_UNSUPPORTED`). Mutually exclusive with `--research`. The produced image is saved to `<artifact-dir>/image/{platform}-{taskId[:8]}-{seq}.{ext}` and reported via `data.imageFiles`.
- `--artifact-dir <path>` overrides the artifact root (default `<cwd>/.multichat`). The CLI resolves it to an absolute path before sending; use it to keep task artifacts inside a specific project instead of the launch directory.
- Task artifacts persist on disk: `reply` text → `<artifact-dir>/results/{platform}-{taskId[:8]}.txt` (`data.replyFile`), generated image → `<artifact-dir>/image/…` (`data.imageFiles`). These paths survive app restarts (recorded in `agent-tasks/*.json`).
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
| `AUTH_REQUIRED` | not logged in (cookie says guest on a login-required platform), or login wall/captcha before sending | ask user to log in in the app, then resubmit |
| `PAGE_NOT_READY` | page not ready for an undetermined reason (load fail/slow render) | ask user to check login in app |
| `AUTH_LOST` | session jumped to login wall mid-task | ask user to re-login; resubmit |
| `NOT_BLANK_CONVERSATION` | "new chat" page wasn't blank | retry; if persistent, report bug |
| `SESSION_LOST` | window destroyed / app quit | resubmit after app restart |
| `SEND_FAILED` | prompt injection/submit or `--image` upload failed | retry once; then report |
| `TASK_TIMEOUT` / `QUEUE_TIMEOUT` | hit hard/queue timeout | resubmit with larger `--timeout` |
| `TASK_CANCELLED` | cancelled by caller | — |
| `TASK_NOT_FOUND` | unknown taskId | check `task list --all` |
| `INTERNAL` | uncategorized | report with taskId |
