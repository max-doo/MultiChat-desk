#!/usr/bin/env node
/**
 * MultiChat Agent CLI 验收测试（无 Electron 运行时部分）
 *
 * 覆盖：
 *  A. src/shared/utils/conversationUrl.ts 单元用例（esbuild 现编到 scripts/.tmp 再 import）
 *  B. CLI 本地参数契约（spawn node out/cli/index.js，参数错误无需 daemon）
 *  C. CLI ↔ daemon 协议契约（内置 mock daemon + net.connect 重定向 shim，
 *     验证请求字段 / stdin 优先级 / waitMs / 退出码 / --json stdout 干净度）
 *  D. 真实 daemon 探测：NDJSON 协议活性 + 新旧版本识别；
 *     旧 daemon 上 task.* 返回"不支持的请求动作"时打 SKIP 而非 FAIL
 *
 * 用法：node scripts/agent-cli-acceptance.mjs
 * 退出码：0 = 无 FAIL（SKIP 不失败），1 = 有 FAIL 或脚本自身异常
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'out', 'cli', 'index.js')
const TMP = path.join(ROOT, 'scripts', '.tmp')
const REAL_PIPE =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\multichat-daemon'
    : path.join(os.tmpdir(), `multichat-daemon-${process.getuid?.() ?? 'user'}.sock`)
const FAKE_PIPE =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\multichat-accept-${process.pid}`
    : path.join(os.tmpdir(), `multichat-accept-${process.pid}.sock`)

const results = []
function record(name, status, detail = '') {
  results.push({ name, status, detail })
  const tag = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : status === 'SKIP' ? '\x1b[33mSKIP\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`)
}
async function test(name, fn) {
  try {
    const r = await fn()
    if (r === 'SKIP') record(name, 'SKIP')
    else record(name, 'PASS', typeof r === 'string' ? r : '')
  } catch (err) {
    record(name, 'FAIL', err instanceof Error ? err.message : String(err))
  }
}
function skip(name, reason) {
  record(name, 'SKIP', reason)
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
function eq(actual, expected, what = '') {
  if (actual !== expected) throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ---------- 通用子进程 ----------
function runCli(args, { stdin, timeoutMs = 15000, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    })
    let stdout = ''
    let stderr = ''
    const started = Date.now()
    const killer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: -1, stdout, stderr: stderr + '\n[TEST] killed after timeout', elapsedMs: Date.now() - started })
    }, timeoutMs)
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => {
      clearTimeout(killer)
      resolve({ code: -1, stdout, stderr: String(err), elapsedMs: Date.now() - started })
    })
    child.on('close', code => {
      clearTimeout(killer)
      resolve({ code, stdout, stderr, elapsedMs: Date.now() - started })
    })
    if (stdin === undefined) {
      child.stdin.end()
    } else {
      child.stdin.write(stdin)
      child.stdin.end()
    }
  })
}

function parseStdoutJson(r) {
  try {
    return JSON.parse(r.stdout.trim())
  } catch {
    throw new Error(`stdout 非纯 JSON: ${r.stdout.slice(0, 200)}`)
  }
}

// ---------- NDJSON 直连 ----------
function pipeRequest(pipe, obj, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const s = net.connect(pipe)
    let buf = ''
    const done = (v) => { try { s.destroy() } catch { /* noop */ } resolve(v) }
    const timer = setTimeout(() => done({ __timeout: true }), timeoutMs)
    s.on('connect', () => s.write(JSON.stringify(obj) + '\n'))
    s.on('data', d => {
      buf += d.toString()
      const i = buf.indexOf('\n')
      if (i >= 0) {
        clearTimeout(timer)
        try { done(JSON.parse(buf.slice(0, i))) } catch { done({ __raw: buf.slice(0, i) }) }
      }
    })
    s.on('error', e => { clearTimeout(timer); done({ __error: e.code || e.message }) })
    s.on('close', () => { clearTimeout(timer); if (!buf) done({ __closed: true }) })
  })
}

// ---------- Mock daemon ----------
let mockServer = null
const mockRequests = []
let mockHandler = async () => ({ success: false, error: 'no handler' })
function startMockDaemon() {
  return new Promise((resolve, reject) => {
    mockServer = net.createServer(socket => {
      let buf = ''
      socket.on('data', chunk => {
        buf += chunk.toString('utf8')
        let idx
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (!line) continue
          let req
          try { req = JSON.parse(line) } catch { req = { __parseError: line } }
          mockRequests.push(req)
          Promise.resolve(mockHandler(req, socket))
            .then(res => { if (res !== null && res !== undefined) socket.write(JSON.stringify(res) + '\n') })
            .catch(err => socket.write(JSON.stringify({ success: false, error: String(err) }) + '\n'))
        }
      })
      socket.on('error', () => { /* client reset */ })
    })
    mockServer.on('error', reject)
    mockServer.listen(FAKE_PIPE, () => resolve())
  })
}

// NODE_OPTIONS --require 在 Windows 下会把 \ 当转义；统一用正斜杠路径
const SHIM = path.join(TMP, 'pipe-shim.cjs').replace(/\\/g, '/')
function writeShim() {
  fs.mkdirSync(TMP, { recursive: true })
  fs.writeFileSync(SHIM, [
    "const net = require('net')",
    "const REAL = process.env.MC_REAL_PIPE",
    "const FAKE = process.env.MC_FAKE_PIPE",
    "const orig = net.connect.bind(net)",
    "const wrap = function (...args) {",
    "  const first = args[0]",
    "  if (typeof first === 'string' && first === REAL) args[0] = FAKE",
    "  else if (first && typeof first === 'object' && first.path === REAL) args[0] = { ...first, path: FAKE }",
    "  return orig(...args)",
    "}",
    "net.connect = wrap",
    "net.createConnection = wrap",
    ""
  ].join('\n'))
}
function shimEnv() {
  return {
    NODE_OPTIONS: `--require "${SHIM}"`,
    MC_REAL_PIPE: REAL_PIPE,
    MC_FAKE_PIPE: FAKE_PIPE
  }
}

// ==================== A. conversationUrl 单元测试 ====================
async function sectionConversationUrl() {
  console.log('\n== A. conversationUrl.ts 单元用例 ==')
  fs.mkdirSync(TMP, { recursive: true })
  const outFile = path.join(TMP, 'conversationUrl.mjs')
  const src = path.join(ROOT, 'src', 'shared', 'utils', 'conversationUrl.ts')
  try {
    const esbuild = createRequire(path.join(ROOT, 'package.json'))('esbuild')
    esbuild.buildSync({ entryPoints: [src], bundle: true, format: 'esm', outfile: outFile, logLevel: 'silent' })
    record('A0. esbuild 编译 conversationUrl.ts', 'PASS')
  } catch (err) {
    record('A0. esbuild 编译 conversationUrl.ts', 'FAIL', String(err))
    return
  }
  const mod = await import(pathToFileURL(outFile).href)
  const { isConversationUrlForPlatform, canonicalizeConversationUrl, isAuthWallUrl } = mod

  const base = {
    chatgpt: 'https://chatgpt.com',
    gemini: 'https://gemini.google.com/app',
    claude: 'https://claude.ai/new',
    perplexity: 'https://www.perplexity.ai/',
    arena: 'https://arena.ai/',
    doubao: 'https://www.doubao.com/chat/',
    yuanbao: 'https://yuanbao.tencent.com/chat',
    qwen: 'https://chat.qwen.ai/',
    deepseek: 'https://chat.deepseek.com/',
    kimi: 'https://www.kimi.com/',
    chatglm: 'https://chatglm.cn/main/alltoolsdetail',
    yiyan: 'https://chat.baidu.com/',
    grok: 'https://grok.com/'
  }

  const cases = [
    // [name, platformId, url, base, expected]
    ['chatgpt 会话 /c/<id>', 'chatgpt', 'https://chatgpt.com/c/68f1a2bc-1234', base.chatgpt, true],
    ['chatgpt 首页', 'chatgpt', 'https://chatgpt.com/', base.chatgpt, false],
    ['chatgpt 无尾斜杠根', 'chatgpt', 'https://chatgpt.com', base.chatgpt, false],
    ['chatgpt 登录页', 'chatgpt', 'https://chatgpt.com/auth/login', base.chatgpt, false],
    ['chatgpt 跨域假冒', 'chatgpt', 'https://evil.com/c/abc', base.chatgpt, false],
    ['chatgpt http 降级', 'chatgpt', 'http://chatgpt.com/c/abc', base.chatgpt, false],
    ['chatgpt 带凭据', 'chatgpt', 'https://u:p@chatgpt.com/c/abc', base.chatgpt, false],
    ['claude 会话 /chat/<uuid>', 'claude', 'https://claude.ai/chat/1a2b3c4d', base.claude, true],
    ['claude 新建页 /new', 'claude', 'https://claude.ai/new', base.claude, false],
    ['claude 登录', 'claude', 'https://claude.ai/login', base.claude, false],
    ['gemini /app/<id>', 'gemini', 'https://gemini.google.com/app/abc123def', base.gemini, true],
    ['gemini /u/1/app/<id>', 'gemini', 'https://gemini.google.com/u/1/app/abc123def', base.gemini, true],
    ['gemini /u/0/app/<id> 带 query', 'gemini', 'https://gemini.google.com/u/0/app/abc?hl=en', base.gemini, true],
    ['gemini /app 落地页', 'gemini', 'https://gemini.google.com/app', base.gemini, false],
    ['gemini /app/ 尾斜杠无 id', 'gemini', 'https://gemini.google.com/app/', base.gemini, false],
    ['gemini /u/1/app 无 id', 'gemini', 'https://gemini.google.com/u/1/app', base.gemini, false],
    ['gemini 首页', 'gemini', 'https://gemini.google.com/', base.gemini, false],
    ['doubao 会话 /chat/<id>', 'doubao', 'https://www.doubao.com/chat/7355666', base.doubao, true],
    ['doubao 新建页 /chat/', 'doubao', 'https://www.doubao.com/chat/', base.doubao, false],
    ['doubao 新建页 /chat', 'doubao', 'https://www.doubao.com/chat', base.doubao, false],
    ['yuanbao 会话', 'yuanbao', 'https://yuanbao.tencent.com/chat/abc-123', base.yuanbao, true],
    ['yuanbao 新建页 /chat', 'yuanbao', 'https://yuanbao.tencent.com/chat', base.yuanbao, false],
    ['qwen 会话 /c/<id>', 'qwen', 'https://chat.qwen.ai/c/aaa-bbb', base.qwen, true],
    ['qwen 首页', 'qwen', 'https://chat.qwen.ai/', base.qwen, false],
    ['deepseek 会话 /a/chat/s/<id>', 'deepseek', 'https://chat.deepseek.com/a/chat/s/9e8f7d6c', base.deepseek, true],
    ['deepseek 首页', 'deepseek', 'https://chat.deepseek.com/', base.deepseek, false],
    ['kimi 会话 /chat/<id>', 'kimi', 'https://www.kimi.com/chat/d2s9f8', base.kimi, true],
    ['kimi 首页', 'kimi', 'https://www.kimi.com/', base.kimi, false],
    ['grok 会话 /c/<id>', 'grok', 'https://grok.com/c/a1b2', base.grok, true],
    ['grok 首页', 'grok', 'https://grok.com/', base.grok, false],
    ['perplexity /search/<id>', 'perplexity', 'https://www.perplexity.ai/search/abcd-1234', base.perplexity, true],
    ['perplexity 首页', 'perplexity', 'https://www.perplexity.ai/', base.perplexity, false],
    ['chatglm 新建页 /main/alltoolsdetail', 'chatglm', 'https://chatglm.cn/main/alltoolsdetail', base.chatglm, false],
    ['yiyan 首页', 'yiyan', 'https://chat.baidu.com/', base.yiyan, false],
    ['yiyan 根路径+chatId（query 会话 ID 命中）', 'yiyan', 'https://chat.baidu.com/?chatId=xyz', base.yiyan, true],
    ['about:blank', 'chatgpt', 'about:blank', base.chatgpt, false],
    ['空串', 'chatgpt', '', base.chatgpt, false],
    ['非法 URL', 'chatgpt', 'not-a-url', base.chatgpt, false],
    ['conversation_id query 于非空路径', 'arena', 'https://arena.ai/x?conversation_id=q1', base.arena, true],
    ['temporary 路径排除', 'kimi', 'https://www.kimi.com/temporary/x', base.kimi, false]
  ]
  for (const [name, pid, url, b, expected] of cases) {
    test(`A.conv ${name}`, () => {
      eq(isConversationUrlForPlatform(pid, url, b), expected, url)
    })
  }

  await test('A.canon gemini /u/1/app 归一', () => {
    eq(canonicalizeConversationUrl('gemini', 'https://gemini.google.com/u/1/app/abc123?hl=en'),
      'https://gemini.google.com/app/abc123')
  })
  await test('A.canon gemini /app 保持 id', () => {
    eq(canonicalizeConversationUrl('gemini', 'https://gemini.google.com/app/xyz'),
      'https://gemini.google.com/app/xyz')
  })
  await test('A.canon 非 gemini 保留完整 href', () => {
    eq(canonicalizeConversationUrl('chatgpt', 'https://chatgpt.com/c/abc?o=1#frag'),
      'https://chatgpt.com/c/abc?o=1#frag')
  })
  await test('A.canon 非法输入原样返回', () => {
    eq(canonicalizeConversationUrl('gemini', 'not-a-url'), 'not-a-url')
  })
  const wallCases = [
    ['跨 origin → auth wall', 'https://accounts.google.com/signin', base.gemini, true],
    ['同域 /login → auth wall', 'https://chatgpt.com/auth/login', base.chatgpt, true],
    ['同域会话 → 非 wall', 'https://chatgpt.com/c/abc', base.chatgpt, false],
    ['about:blank → 非 wall', 'about:blank', base.gemini, false],
    ['空串 → 非 wall', '', base.gemini, false],
    ['非法串 → 非 wall', '::bad::', base.gemini, false],
    ['gemini /app → 非 wall', 'https://gemini.google.com/app/x', base.gemini, false],
    ['同域 /signin → wall', 'https://claude.ai/signin', base.claude, true]
  ]
  for (const [name, url, b, expected] of wallCases) {
    test(`A.wall ${name}`, () => {
      eq(isAuthWallUrl(url, b), expected, url)
    })
  }
}

// ==================== B. CLI 本地参数契约 ====================
async function sectionCliLocal() {
  console.log('\n== B. CLI 本地参数契约（不依赖 daemon 响应）==')
  if (!fs.existsSync(CLI)) {
    skip('B.*', 'out/cli/index.js 不存在，先 npm run build')
    return
  }
  await test('B1. --help 退出 0 且含 task 命令', () => {
    return runCli(['--help']).then(r => {
      eq(r.code, 0, 'exit')
      assert(/task/.test(r.stdout), `help 缺少 task: ${r.stdout.slice(0, 200)}`)
    })
  })
  await test('B2. task submit 缺 --platform → exit 2', async () => {
    const r = await runCli(['task', 'submit', '--query', 'hi'])
    eq(r.code, 2, 'exit')
    assert(/platform/i.test(r.stderr), `stderr: ${r.stderr.slice(0, 200)}`)
  })
  await test('B3. task submit 缺 --platform --json → stderr JSON + exit 2', async () => {
    const r = await runCli(['--json', 'task', 'submit', '--query', 'hi'])
    eq(r.code, 2, 'exit')
    const env = JSON.parse(r.stderr.trim())
    eq(env.success, false, 'env.success')
    eq(env.code, 'INVALID_PARAMS', 'env.code')
    eq(r.stdout.trim(), '', 'stdout 应保持为空')
  })
  await test('B4. task submit 有 platform 无 query（stdin EOF）→ exit 2', async () => {
    const r = await runCli(['task', 'submit', '--platform', 'gemini'])
    eq(r.code, 2, 'exit')
    assert(/query/i.test(r.stderr), `stderr: ${r.stderr.slice(0, 200)}`)
  })
  await test('B5. query 超 100k（--query-file）→ exit 2', async () => {
    const big = path.join(TMP, 'big-query.txt')
    fs.writeFileSync(big, 'x'.repeat(100_001))
    const r = await runCli(['task', 'submit', '--platform', 'gemini', '--query-file', big])
    eq(r.code, 2, 'exit')
    assert(/100000|上限/i.test(r.stderr), `stderr: ${r.stderr.slice(0, 200)}`)
  })
  await test('B5b. query 超 100k（stdin）→ exit 2', async () => {
    const r = await runCli(['task', 'submit', '--platform', 'gemini'], { stdin: 'y'.repeat(100_001) })
    eq(r.code, 2, 'exit')
  })
  await test('B6. --wait 非法值 → exit 2', async () => {
    const r = await runCli(['task', 'submit', '--platform', 'gemini', '--query', 'hi', '--wait', 'abc'])
    eq(r.code, 2, 'exit')
  })
  await test('B7. --timeout 超上限 → exit 2', async () => {
    const r = await runCli(['task', 'submit', '--platform', 'gemini', '--query', 'hi', '--timeout', '9999'])
    eq(r.code, 2, 'exit')
  })
  await test('B8. task status 缺 <taskId> → exit 2（契约：参数错误=2）', async () => {
    const r = await runCli(['task', 'status'])
    eq(r.code, 2, 'exit（commander 缺参默认 exit 1，契约要求 2）')
  })
  await test('B9. daemon 不可达 → exit 1 + DAEMON_UNAVAILABLE（json stderr）', async () => {
    // 用 shim 将管道名重定向到不存在的管道
    const r = await runCli(['--json', 'task', 'list'], {
      env: {
        NODE_OPTIONS: `--require "${SHIM}"`,
        MC_REAL_PIPE: REAL_PIPE,
        MC_FAKE_PIPE: process.platform === 'win32' ? '\\\\.\\pipe\\multichat-accept-nonexist' : '/tmp/nonexist-mc.sock'
      }
    })
    eq(r.code, 1, 'exit')
    const env = JSON.parse(r.stderr.trim())
    eq(env.code, 'DAEMON_UNAVAILABLE', 'env.code')
  })
  await test('B10. --image 指向不存在文件 → exit 2', async () => {
    const r = await runCli(['task', 'submit', '--platform', 'gemini', '--image', path.join(TMP, 'no-such-img.png')])
    eq(r.code, 2, 'exit')
    assert(/图片|image/i.test(r.stderr), `stderr: ${r.stderr.slice(0, 200)}`)
  })
  await test('B11. --image 重复超过 10 张 → exit 2', async () => {
    const img = path.join(TMP, 'img-ok.png')
    fs.writeFileSync(img, 'PNG-BYTES')
    const args = ['task', 'submit', '--platform', 'gemini', '--query', 'hi']
    for (let i = 0; i < 11; i++) args.push('--image', img)
    const r = await runCli(args)
    eq(r.code, 2, 'exit')
    assert(/上限/.test(r.stderr), `stderr: ${r.stderr.slice(0, 200)}`)
  })
  await test('B12. --image 无 query → 过参数检查（daemon 不可达 → exit 1 DAEMON_UNAVAILABLE）', async () => {
    const img = path.join(TMP, 'img-only.png')
    fs.writeFileSync(img, 'PNG-BYTES')
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--image', img], {
      env: {
        NODE_OPTIONS: `--require "${SHIM}"`,
        MC_REAL_PIPE: REAL_PIPE,
        MC_FAKE_PIPE: process.platform === 'win32' ? '\\\\.\\pipe\\multichat-accept-nonexist' : '/tmp/nonexist-mc.sock'
      }
    })
    eq(r.code, 1, 'exit')
    const env = JSON.parse(r.stderr.trim())
    eq(env.code, 'DAEMON_UNAVAILABLE', 'env.code')
  })
}

// ==================== C. Mock daemon 协议契约 ====================
async function sectionMockDaemon() {
  console.log('\n== C. Mock daemon：CLI ↔ daemon 请求/响应契约 ==')
  await startMockDaemon()
  const env = shimEnv()
  const lastReq = () => mockRequests.at(-1)

  await test('C1. submit 基本字段 + 短形态响应', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: { taskId: 't-1', phase: 'queued', queuedPosition: 1 } })
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--query', 'hello', '--model', 'm1', '--research', '--timeout', '60', '--queue-timeout', '30', '--conversation', 'https://gemini.google.com/app/abc'], { env })
    eq(r.code, 0, 'exit')
    const out = parseStdoutJson(r)
    eq(out.success, true, 'success')
    eq(out.data.taskId, 't-1', 'taskId')
    const req = lastReq()
    eq(req.action, 'task.submit', 'action')
    eq(req.platform, 'gemini', 'platform')
    eq(req.query, 'hello', 'query')
    eq(req.model, 'm1', 'model')
    eq(req.mode, 'deep_research', 'mode')
    eq(req.timeoutMs, 60000, 'timeoutMs')
    eq(req.queueTimeoutMs, 30000, 'queueTimeoutMs')
    eq(req.conversationUrl, 'https://gemini.google.com/app/abc', 'conversationUrl')
  })

  await test('C2. 显式参数抑制 stdin；--query-file > --query', async () => {
    // 契约（KNOWLEDGE #11）：stdin 只在未给 --query/--query-file 时读取，
    // 显式参数在时无条件跳过，根治宿主开放管道挂死；两旗标并存时 file 胜出。
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: { taskId: 't-2', phase: 'queued' } })
    const qfile = path.join(TMP, 'q.txt')
    fs.writeFileSync(qfile, 'FILE-QUERY')
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--query', 'FLAG-QUERY', '--query-file', qfile], { env, stdin: 'STDIN-QUERY\n' })
    eq(r.code, 0, 'exit')
    eq(lastReq().query, 'FILE-QUERY', '显式参数在时 stdin 不读，--query-file 胜出')
  })

  await test('C3. stdin 空 → --query-file 生效', async () => {
    mockRequests.length = 0
    const qfile = path.join(TMP, 'q2.txt')
    fs.writeFileSync(qfile, 'FILE-QUERY-2')
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--query', 'FLAG', '--query-file', qfile], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().query, 'FILE-QUERY-2', 'query-file 应生效')
  })

  await test('C4. 无 stdin/file → --query 生效', async () => {
    mockRequests.length = 0
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--query', 'PLAIN-Q'], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().query, 'PLAIN-Q', '--query 应生效')
  })

  await test('C5. --wait 两段化：submit 取 taskId → stderr ack → task.status waitMs', async () => {
    // 契约（KNOWLEDGE #11）：submit 不带 waitMs 先拿 taskId 吐 stderr，
    // 再发 task.status waitMs 长轮询；daemon 协议与 stdout 契约不变。
    mockRequests.length = 0
    const seen = []
    mockHandler = async (req) => {
      seen.push(String(req.action))
      if (req.action === 'task.submit') return { success: true, data: { taskId: 't-5', phase: 'queued' } }
      if (req.action === 'task.status') {
        if (req.waitMs !== 3000) return { success: false, error: `waitMs wrong: ${req.waitMs}` }
        await new Promise(r => setTimeout(r, 800))
        return { success: true, data: { taskId: 't-5', platform: 'gemini', mode: 'chat', phase: 'done', replyChars: 42, busy: false, elapsedMs: 800 } }
      }
      return { success: false, error: 'unexpected action' }
    }
    const started = Date.now()
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--query', 'hi', '--wait', '3'], { env })
    const elapsed = Date.now() - started
    eq(r.code, 0, 'exit')
    const out = parseStdoutJson(r)
    eq(out.data.phase, 'done', 'phase')
    assert(elapsed >= 700, `应等待 daemon 响应（${elapsed}ms < 700ms）`)
    assert(seen[0] === 'task.submit' && seen[1] === 'task.status', `动作序列: ${seen.join(',')}`)
    const ack = JSON.parse(r.stderr.trim())
    eq(ack.taskId, 't-5', 'stderr 应先吐 submit ack')
  })

  await test('C6. submit 被拒（PLATFORM_UNKNOWN）→ exit 1 + stdout envelope 带 code', async () => {
    mockHandler = async () => ({ success: false, error: '平台未配置选择器: bogus', code: 'PLATFORM_UNKNOWN' })
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'bogus', '--query', 'hi'], { env })
    eq(r.code, 1, 'exit')
    const out = parseStdoutJson(r)
    eq(out.success, false, 'success')
    eq(out.code, 'PLATFORM_UNKNOWN', 'code')
  })

  await test('C7. task status → 请求字段 + 视图输出', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: { taskId: 't-7', platform: 'chatgpt', mode: 'chat', phase: 'generating', replyChars: 120, busy: true, elapsedMs: 9000, conversationUrl: 'https://chatgpt.com/c/abc' } })
    const r = await runCli(['--json', 'task', 'status', 't-7'], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().action, 'task.status', 'action')
    eq(lastReq().taskId, 't-7', 'taskId')
    const out = parseStdoutJson(r)
    eq(out.data.phase, 'generating', 'phase')
    eq(out.data.busy, true, 'busy')
  })

  await test('C8. task status --wait 3 → waitMs=3000', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: { taskId: 't-8', platform: 'chatgpt', mode: 'chat', phase: 'done', replyChars: 5, busy: false, elapsedMs: 100 } })
    const r = await runCli(['--json', 'task', 'status', 't-8', '--wait', '3'], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().waitMs, 3000, 'waitMs')
  })

  await test('C9. task result done → --text 输出 reply 正文', async () => {
    mockHandler = async () => ({ success: true, data: { taskId: 't-9', phase: 'done', reply: 'REPLY-MARKDOWN-正文', conversationUrl: 'https://chatgpt.com/c/abc', durationMs: 12345 } })
    const r = await runCli(['--text', 'task', 'result', 't-9'], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().action, 'task.result', 'action')
    assert(r.stdout.includes('REPLY-MARKDOWN-正文'), `stdout 应含回复正文: ${r.stdout.slice(0, 200)}`)
  })

  await test('C10. task cancel → {taskId,phase}', async () => {
    mockHandler = async () => ({ success: true, data: { taskId: 't-10', phase: 'cancelled' } })
    const r = await runCli(['--text', 'task', 'cancel', 't-10'], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().action, 'task.cancel', 'action')
    assert(r.stdout.includes('cancelled'), `stdout: ${r.stdout.slice(0, 100)}`)
  })

  await test('C11. task list --all --platform → 请求字段 + 列表输出', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: [{ taskId: 't-11', platform: 'gemini', mode: 'chat', phase: 'done', replyChars: 10, busy: false, elapsedMs: 500 }] })
    const r = await runCli(['--text', 'task', 'list', '--all', '--platform', 'gemini'], { env })
    eq(r.code, 0, 'exit')
    const req = lastReq()
    eq(req.action, 'task.list', 'action')
    eq(req.includeFinished, true, 'includeFinished')
    eq(req.platform, 'gemini', 'platform')
    assert(r.stdout.includes('t-11'), `stdout: ${r.stdout.slice(0, 200)}`)
  })

  await test('C12. platforms → 能力清单输出', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: [{ id: 'gemini', deepResearch: true, busySignal: 'adapted', followUp: true }] })
    const r = await runCli(['--text', 'platforms'], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().action, 'platforms', 'action')
    assert(/gemini/.test(r.stdout) && /adapted/.test(r.stdout), `stdout: ${r.stdout.slice(0, 200)}`)
  })

  await test('C13. task.status TASK_NOT_FOUND → exit 1', async () => {
    mockHandler = async () => ({ success: false, error: '任务不存在: ghost', code: 'TASK_NOT_FOUND' })
    const r = await runCli(['--json', 'task', 'status', 'ghost'], { env })
    eq(r.code, 1, 'exit')
    eq(parseStdoutJson(r).code, 'TASK_NOT_FOUND', 'code')
  })

  await test('C14. daemon 在 wait 中途断开 socket → CLI exit 1 不悬挂', async () => {
    mockHandler = async (_req, socket) => {
      setTimeout(() => socket.destroy(), 300)
      return null // 不响应
    }
    const r = await runCli(['--json', 'task', 'status', 't-x', '--wait', '30'], { env, timeoutMs: 15000 })
    eq(r.code, 1, 'exit')
    assert(r.elapsedMs < 10000, `应及时退出而非悬挂（${r.elapsedMs}ms）`)
    const envObj = JSON.parse(r.stderr.trim())
    eq(envObj.code, 'DAEMON_UNAVAILABLE', 'env.code')
  })

  await test('C15. --text 模式错误走 stderr（stdout 干净）', async () => {
    mockHandler = async () => ({ success: false, error: '模拟执行失败', code: 'INTERNAL' })
    const r = await runCli(['--text', 'task', 'result', 't-15'], { env })
    eq(r.code, 1, 'exit')
    assert(!r.stdout.trim(), `stdout 应空: ${r.stdout.slice(0, 100)}`)
    assert(r.stderr.includes('模拟执行失败'), `stderr: ${r.stderr.slice(0, 200)}`)
  })

  await test('C16. --text submit 短形态输出（taskId + phase）', async () => {
    mockHandler = async () => ({ success: true, data: { taskId: 't-16', phase: 'queued', queuedPosition: 1 } })
    const r = await runCli(['--text', 'task', 'submit', '--platform', 'gemini', '--query', 'hi'], { env })
    eq(r.code, 0, 'exit')
    assert(r.stdout.includes('t-16') && r.stdout.includes('queued'), `stdout: ${r.stdout.slice(0, 200)}`)
  })

  await test('C17. query 恰为 100k 边界 → 放行（>100k 才拒）', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: { taskId: 't-17', phase: 'queued' } })
    const qfile = path.join(TMP, 'exact-100k.txt')
    fs.writeFileSync(qfile, 'z'.repeat(100_000))
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--query-file', qfile], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().query.length, 100_000, 'query.length')
  })

  await test('C18. submit --image → req.images 携带解析后绝对路径', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: { taskId: 't-18', phase: 'queued' } })
    const img = path.join(TMP, 'c18.png')
    fs.writeFileSync(img, 'PNG')
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--query', '看图', '--image', img], { env })
    eq(r.code, 0, 'exit')
    const req = lastReq()
    assert(Array.isArray(req.images), `images 应为数组: ${JSON.stringify(req.images)}`)
    eq(req.images.length, 1, 'images.length')
    eq(req.images[0], path.resolve(img), 'images[0] 应为解析后绝对路径')
    eq(req.query, '看图', 'query')
  })

  await test('C19. 纯 --image（无 query）→ req.query 空串 + images 非空', async () => {
    mockRequests.length = 0
    mockHandler = async () => ({ success: true, data: { taskId: 't-19', phase: 'queued' } })
    const img = path.join(TMP, 'c19.png')
    fs.writeFileSync(img, 'PNG')
    const r = await runCli(['--json', 'task', 'submit', '--platform', 'gemini', '--image', img], { env })
    eq(r.code, 0, 'exit')
    eq(lastReq().query, '', 'query 应为空串')
    eq(lastReq().images.length, 1, 'images.length')
  })
}

// ==================== D. 真实 daemon 探测 ====================
// 新版 daemon 全平台强制 token：无 token 请求会得到 DAEMON_UNAVAILABLE 而非静默关闭。
// 探测顺序：无 token status → 读候选目录 token → 带 token platforms 判新旧。
function readRealDaemonToken() {
  const appNames = ['multichat', 'MultiChat']
  const bases = []
  if (process.platform === 'win32') {
    bases.push(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
  } else if (process.platform === 'darwin') {
    bases.push(path.join(os.homedir(), 'Library', 'Application Support'))
  } else {
    bases.push(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'))
  }
  const dirs = []
  for (const base of bases) for (const name of appNames) {
    dirs.push(path.join(base, name), path.join(base, `${name}-dev`))
  }
  for (const dir of dirs) {
    try {
      const t = fs.readFileSync(path.join(dir, 'daemon.token'), 'utf8').trim()
      if (t) return t
    } catch { /* 下一个候选 */ }
  }
  return ''
}

async function sectionRealDaemon() {
  console.log('\n== D. 真实 daemon 探测（旧版容忍 / 协议活性）==')
  const token = readRealDaemonToken()
  const noAuth = await pipeRequest(REAL_PIPE, { action: 'status' }, 3000)
  const protoAlive = noAuth && !noAuth.__error && !noAuth.__timeout && !noAuth.__closed
  // 新 daemon 无 token 必拒 DAEMON_UNAVAILABLE；旧 daemon 无鉴权直接返回成功
  const isNewByAuth = noAuth && noAuth.success === false && noAuth.code === 'DAEMON_UNAVAILABLE'
  const cap = await pipeRequest(REAL_PIPE, { action: 'platforms', ...(token ? { token } : {}) }, 5000)
  const isNew = isNewByAuth || (cap && cap.success === true && Array.isArray(cap.data))
  const isOld = !isNew && cap && cap.success === false && /不支持的请求动作/.test(cap.error || '')
  const alive = protoAlive && (isNew || isOld || (noAuth && noAuth.success === true))
  await test('D1. 管道 NDJSON：协议可响应', () => {
    if (!protoAlive) return 'SKIP'
    assert(true, `status 响应: ${JSON.stringify(noAuth).slice(0, 120)}`)
  })
  if (!alive) {
    skip('D2-D6', protoAlive ? `daemon 响应无法归类: ${JSON.stringify(noAuth).slice(0, 120)}` : '本机无 daemon（或未启动 MultiChat）')
    return
  }
  await test('D1b. status 带 token → Daemon is running', async () => {
    if (isNew && token) {
      const r = await pipeRequest(REAL_PIPE, { action: 'status', token }, 3000)
      eq(r.data, 'Daemon is running', 'data')
      return
    }
    if (isOld && noAuth && noAuth.success === true) {
      eq(noAuth.data, 'Daemon is running', 'data')
      return
    }
    return 'SKIP'
  })
  await test('D2. 版本探测：platforms 路由存在性', () => {
    if (isNew) return '新版 daemon：platforms 返回 ' + cap.data.length + ' 平台'
    if (isOld) return 'SKIP'
    throw new Error(`platforms 响应异常: ${JSON.stringify(cap).slice(0, 200)}`)
  })
  if (isOld) record('D2.note', 'SKIP', '旧版 daemon 在跑（无 task.* 路由），task.* 端到端用例需 npm run dev 新版应用实测')

  if (isNew) {
    await test('D3. 新 daemon：无 token 请求被拒 DAEMON_UNAVAILABLE', async () => {
      const r = await pipeRequest(REAL_PIPE, { action: 'task.list' }, 3000)
      eq(r.success, false, 'success')
      eq(r.code, 'DAEMON_UNAVAILABLE', 'code')
      const r2 = await pipeRequest(REAL_PIPE, { action: 'task.list', token: 'wrong-token-xyz' }, 3000)
      eq(r2.code, 'DAEMON_UNAVAILABLE', '错 token code')
    })
    await test('D4. 新 daemon：task.status 未知 id → TASK_NOT_FOUND（经 CLI）', async () => {
      const r = await runCli(['--json', 'task', 'status', 'definitely-not-exist-id'])
      eq(r.code, 1, 'exit')
      eq(parseStdoutJson(r).code, 'TASK_NOT_FOUND', 'code')
    })
    await test('D5. 新 daemon：task.list --json → 数组', async () => {
      const r = await runCli(['--json', 'task', 'list', '--all'])
      eq(r.code, 0, 'exit')
      assert(Array.isArray(parseStdoutJson(r).data), 'data 应为数组')
    })
    await test('D6. 新 daemon：submit 非法平台 → PLATFORM_UNKNOWN', async () => {
      const r = await runCli(['--json', 'task', 'submit', '--platform', 'no-such-platform-xyz', '--query', 'hi'])
      eq(r.code, 1, 'exit')
      eq(parseStdoutJson(r).code, 'PLATFORM_UNKNOWN', 'code')
    })
    await test('D8. 新 daemon：status on done → 视图内嵌 reply（省一次 result 往返）', async () => {
      const r = await runCli(['--json', 'task', 'list', '--all'])
      const done = (parseStdoutJson(r).data || []).find(t => t.phase === 'done' && t.replyChars > 0)
      if (!done) return 'SKIP'
      const v = parseStdoutJson(await runCli(['--json', 'task', 'status', done.taskId])).data
      assert(typeof v.reply === 'string' && v.reply.length === v.replyChars,
        `reply 应内嵌且与 replyChars 一致: reply=${typeof v.reply}`)
    })
  } else if (isOld) {
    await test('D3. 旧 daemon：task.list → "不支持的请求动作"（协议未破坏）', async () => {
      const r = await pipeRequest(REAL_PIPE, { action: 'task.list' }, 5000)
      eq(r.success, false, 'success')
      assert(/不支持的请求动作/.test(r.error || ''), `error: ${r.error}`)
    })
    await test('D4. 旧 daemon：CLI task list 优雅失败 exit 1（不悬挂/不崩溃）', async () => {
      const r = await runCli(['--json', 'task', 'list'], { timeoutMs: 12000 })
      eq(r.code, 1, 'exit')
      const out = parseStdoutJson(r)
      eq(out.success, false, 'success')
      assert(/不支持的请求动作/.test(out.error || ''), `error: ${out.error}`)
    })
    skip('D5. 新 daemon task.* 用例', '旧版 daemon 在跑，需 npm run dev 起新版实测')
    skip('D6. 新 daemon 鉴权/token 用例', '旧版 daemon 无 token 机制，需新版实测')
  } else {
    skip('D3-D6', 'daemon 行为无法归类（响应异常）')
  }
  await test('D7. CLI `daemon status` 直连真实 daemon → exit 0', async () => {
    const r = await runCli(['daemon', 'status'], { timeoutMs: 12000 })
    eq(r.code, 0, 'exit')
    assert(/Daemon is running/.test(r.stdout), `stdout: ${r.stdout.slice(0, 200)}`)
  })
}

// ==================== main ====================
async function main() {
  console.log('MultiChat Agent CLI 验收测试')
  console.log(`ROOT=${ROOT}`)
  console.log(`CLI=${CLI} ${fs.existsSync(CLI) ? '(存在)' : '(缺失)'}`)
  console.log(`REAL_PIPE=${REAL_PIPE}`)
  fs.mkdirSync(TMP, { recursive: true })
  writeShim()

  await sectionConversationUrl()
  await sectionCliLocal()
  try {
    await sectionMockDaemon()
  } finally {
    if (mockServer) mockServer.close()
  }
  await sectionRealDaemon()

  // 清理本轮生成的临时产物
  try {
    for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true, recursive: true })
  } catch { /* 清理失败不影响结论 */ }

  const pass = results.filter(r => r.status === 'PASS').length
  const fail = results.filter(r => r.status === 'FAIL').length
  const skipp = results.filter(r => r.status === 'SKIP').length
  console.log('\n========== 汇总 ==========')
  console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skipp}  TOTAL=${results.length}`)
  if (fail > 0) {
    console.log('FAIL 项：')
    for (const r of results.filter(r => r.status === 'FAIL')) console.log(`  - ${r.name}: ${r.detail}`)
  }
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('验收脚本自身异常:', err)
  process.exit(1)
})
