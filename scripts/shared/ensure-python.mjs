#!/usr/bin/env node
/*
 * ensure-python.mjs — MultiChat skill 共享的 Python 环境供给（幂等、并发安全）。
 *
 * 用法:
 *   node ensure-python.mjs [--target-dir <dir>] [--packages "a b c"]
 *
 * 三级回退（前一级不可用才进入下一级）:
 *   1. managed:  $MULTICHAT_AGENT_DIR/python（embeddable）或 python-venv 已就绪 → 直接复用；
 *   2. system-venv: 安全探测到系统 python ≥3.10 且有 pip → 一次性 python -m venv
 *      转化为 managed venv（python.org 安装器自带 ensurepip；venv 隔离，不污染系统环境，
 *      后续依赖解析与 tier3 完全一致）；
 *   3. bootstrapped: 下载 embeddable Python（仅 Windows；mac/linux 输出手动安装指引）。
 *
 * 关键纪律:
 *   - embeddable 发行版的 python*._pth 必须取消 `#import site` 注释，否则 pip 无效；
 *   - 系统 python 探测严禁裸调（Windows 商店 app execution alias stub 会弹 Microsoft
 *     Store 窗口）——只允许带 `--version` 解析 stdout，命中 WindowsApps 路径直接排除；
 *   - 跨进程互斥用原子 mkdir lockdir（含陈旧锁超时回收），并行会话首触不会损坏环境；
 *   - 网络失败最多重试 2 次（含首次共 3 次），失败输出 hint 手动安装指引，不静默循环。
 *
 * stdout 最后一行输出 JSON:
 *   {"ok":true,"pythonExe":"...","reused":bool,"source":"managed|system-venv|bootstrapped",
 *    "targetDir":"...","pipReady":bool,"installed":[...]}
 *   {"ok":false,"error":"...","hint":"...","detail":"..."}
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const PYTHON_VERSION = "3.13.9";
const PYTHON_ZIP_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
// python.org 官方 python-3.13.9-embed-amd64.zip 的 sha256（实算自 TLS 下载，固定版本故可硬编码）。
// 校验失败（截断/劫持/上游换包）时必须中止——解压半成品 python 进用户环境比不安装更糟。
const PYTHON_ZIP_SHA256 = "91d828c2da3a029b41699e918674a0cb379c02cf20dab9c501306885f837402a";
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";
const MAX_NETWORK_ATTEMPTS = 3;
const LOCK_STALE_MS = 10 * 60 * 1000;
const MIN_SYSTEM_PYTHON = [3, 10];

function parseArgs(argv) {
  const out = { targetDir: null, packages: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--target-dir" || a === "--dir") && argv[i + 1]) {
      out.targetDir = argv[++i];
    } else if (a === "--packages" && argv[i + 1]) {
      out.packages = argv[++i].split(/[\s,]+/).filter(Boolean);
    }
  }
  return out;
}

function fail(obj) {
  process.stdout.write(JSON.stringify({ ok: false, ...obj }) + "\n");
  process.exit(1);
}

function report(obj) {
  process.stdout.write(JSON.stringify({ ok: true, ...obj }) + "\n");
}

function agentDir() {
  const dir = process.env.MULTICHAT_AGENT_DIR;
  return dir && dir.trim() ? dir.trim() : null;
}

// ---------- 并发锁：原子 mkdir lockdir ----------
function acquireLock(lockDir) {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + LOCK_STALE_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "owner"), `${process.pid} ${Date.now()}`, "utf8");
      return () => {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // 锁释放失败不影响结果；陈旧锁会被超时回收。
        }
      };
    } catch (err) {
      if (err && err.code === "EEXIST") {
        try {
          const stat = fs.statSync(lockDir);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            fs.rmSync(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) {
          fail({ error: "lock-timeout", hint: "另一个 Python 环境准备流程长时间未结束。请稍后重试；若反复出现，删除 " + lockDir + " 后重试。" });
        }
        // 同步睡眠等待持锁方（本脚本整体同步风格，watch 间隔 1.5s 足够）
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
        continue;
      }
      throw err;
    }
  }
}

// ---------- 网络 ----------
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const doGet = (u, redirectsLeft) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) return reject(new Error("too many redirects"));
            return doGet(new URL(res.headers.location, u).toString(), redirectsLeft - 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
          file.on("error", reject);
        })
        .on("error", reject);
    };
    doGet(url, 5);
  });
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function downloadWithRetry(url, dest, label, expectedSha256 = null) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_NETWORK_ATTEMPTS; attempt++) {
    try {
      await download(url, dest);
      if (expectedSha256) {
        const actual = sha256File(dest);
        if (actual !== expectedSha256) {
          throw new Error(`sha256 校验失败（期望 ${expectedSha256.slice(0, 12)}… 实得 ${actual.slice(0, 12)}…）`);
        }
      }
      return;
    } catch (err) {
      lastErr = err;
      process.stderr.write(`[ensure-python] ${label} 下载失败（第 ${attempt}/${MAX_NETWORK_ATTEMPTS} 次）: ${err.message}\n`);
    }
  }
  fail({
    error: "network",
    hint:
      `下载 ${label} 失败，已重试 ${MAX_NETWORK_ATTEMPTS - 1} 次。请检查网络后重试；` +
      `或手动安装 Python ${MIN_SYSTEM_PYTHON[0]}.${MIN_SYSTEM_PYTHON[1]}+（https://www.python.org/downloads/）` +
      `——装好后本脚本会自动优先使用系统 Python，无需再次下载。`,
    detail: String(lastErr && lastErr.message),
  });
}

function unzip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  try {
    execFileSync("tar.exe", ["-xf", zipPath, "-C", destDir], { stdio: "pipe" });
  } catch {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
      { stdio: "pipe" }
    );
  }
}

function enableSiteImport(targetDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(targetDir);
  } catch {
    return;
  }
  const pthFiles = entries.filter((f) => /^python\d+\._pth$/.test(f));
  for (const f of pthFiles) {
    const p = path.join(targetDir, f);
    const content = fs.readFileSync(p, "utf8");
    const patched = content.replace(/^#\s*import site\s*$/m, "import site");
    if (patched !== content) fs.writeFileSync(p, patched, "utf8");
  }
}

function runPython(pythonExe, args, timeoutMs = 15000) {
  return execFileSync(pythonExe, args, { stdio: "pipe", encoding: "utf8", timeout: timeoutMs, windowsHide: true });
}

function pipWorks(pythonExe) {
  try {
    runPython(pythonExe, ["-m", "pip", "--version"]);
    return true;
  } catch {
    return false;
  }
}

function pythonWorks(pythonExe) {
  try {
    const out = runPython(pythonExe, ["--version"], 8000);
    return /^Python \d/.test((out || "").trim());
  } catch {
    return false;
  }
}

// ---------- 系统 python 安全探测 ----------
// 严禁裸调 `python`：Windows 商店 app execution alias stub（WindowsApps\python.exe）
// 执行即弹 Microsoft Store 窗口。只允许带 --version 解析 stdout；
// 命中 WindowsApps 路径的候选直接排除。
function probePythonVersion(exe, args = ["--version"]) {
  try {
    const out = execFileSync(exe, args, { stdio: "pipe", encoding: "utf8", timeout: 8000, windowsHide: true });
    const match = (out || "").trim().match(/^Python (\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  } catch {
    return null;
  }
}

function versionAtLeast(v, min) {
  return v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);
}

function isWindowsAppsStub(exePath) {
  return /\\Microsoft\\WindowsApps\\python[^\\]*\.exe$/i.test(exePath) || /\\WindowsApps\\python/i.test(exePath);
}

function findOnPath(command) {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const exts = process.platform === "win32" ? [".exe", ".bat", ".cmd", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function probeSystemPython() {
  const candidates = [];
  if (process.platform === "win32") {
    const pyExe = findOnPath("py");
    if (pyExe) candidates.push({ exe: pyExe, versionArgs: ["-3", "--version"], pipArgsPrefix: ["-3"] });
    const pythonExe = findOnPath("python");
    if (pythonExe && !isWindowsAppsStub(pythonExe)) {
      candidates.push({ exe: pythonExe, versionArgs: ["--version"], pipArgsPrefix: [] });
    }
  } else {
    for (const name of ["python3", "python"]) {
      const exe = findOnPath(name);
      if (exe) candidates.push({ exe, versionArgs: ["--version"], pipArgsPrefix: [] });
    }
  }
  for (const candidate of candidates) {
    const version = probePythonVersion(candidate.exe, candidate.versionArgs);
    if (version && versionAtLeast(version, MIN_SYSTEM_PYTHON)) {
      return { ...candidate, version };
    }
  }
  return null;
}

function systemPythonHasPip(sysProbe) {
  try {
    runPython(sysProbe.exe, [...sysProbe.pipArgsPrefix, "-m", "pip", "--version"]);
    return true;
  } catch {
    return false;
  }
}

function venvPythonExe(venvDir) {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python3");
}

// ---------- pip 安装 ----------
function installPackages(pythonExe, packages) {
  const installed = [];
  for (const pkg of packages) {
    // 已装跳过：先用 import 探测包对应的关键模块名无法可靠映射，统一走 pip install
    // ——pip 自身幂等（已满足版本要求时秒回）。
    let ok = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_NETWORK_ATTEMPTS && !ok; attempt++) {
      try {
        execFileSync(
          pythonExe,
          ["-m", "pip", "install", "--disable-pip-version-check", "--quiet", pkg],
          { stdio: "pipe", timeout: 300000, windowsHide: true }
        );
        ok = true;
      } catch (err) {
        lastErr = err;
        process.stderr.write(`[ensure-python] pip 安装 ${pkg} 失败（第 ${attempt}/${MAX_NETWORK_ATTEMPTS} 次）\n`);
      }
    }
    if (!ok) {
      fail({
        error: "pip-install",
        hint: `pip 安装 ${pkg} 失败。可手动执行: "${pythonExe}" -m pip install ${packages.join(" ")}`,
        detail: String(lastErr && lastErr.message),
        pythonExe,
      });
    }
    installed.push(pkg);
  }
  return installed;
}

// ---------- 各 tier ----------
async function ensureManagedBootstrap(managedDir) {
  const pythonExe = path.join(managedDir, "python.exe");
  let reused = fs.existsSync(pythonExe);

  if (process.platform !== "win32") {
    fail({
      error: "bootstrap-unsupported-platform",
      hint:
        "当前平台不支持自动安装 Python。请用系统包管理器安装 Python 3.10+（macOS: `brew install python@3.13`；" +
        "Debian/Ubuntu: `sudo apt install python3 python3-venv`），装好后本脚本会自动优先使用系统 Python。",
    });
  }

  if (!reused) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcpy-"));
    const zipPath = path.join(tmp, "python-embed.zip");
    await downloadWithRetry(PYTHON_ZIP_URL, zipPath, "embeddable Python", PYTHON_ZIP_SHA256);
    unzip(zipPath, managedDir);
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!fs.existsSync(pythonExe)) {
      fail({ error: "extract", hint: "Python 解压后未找到 python.exe，请检查目标目录权限与杀毒软件拦截。", targetDir: managedDir });
    }
  }

  enableSiteImport(managedDir);

  if (!pipWorks(pythonExe)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcgp-"));
    const getPip = path.join(tmp, "get-pip.py");
    await downloadWithRetry(GET_PIP_URL, getPip, "get-pip.py");
    try {
      execFileSync(pythonExe, [getPip, "--no-warn-script-location"], { stdio: "pipe", timeout: 180000, windowsHide: true });
    } catch (err) {
      fail({
        error: "pip-bootstrap",
        hint: "get-pip 引导失败。可手动安装 Python 3.10+（https://www.python.org/downloads/）后重试。",
        detail: String(err.message),
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  return { pythonExe, targetDir: managedDir, reused, source: "bootstrapped" };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseDir = agentDir();
  if (!baseDir && !opts.targetDir) {
    fail({
      error: "missing-env",
      hint: "环境变量 MULTICHAT_AGENT_DIR 未设置。可显式传 --target-dir <dir> 指定安装位置。",
    });
  }
  const embedDir = opts.targetDir ? path.resolve(opts.targetDir) : path.join(baseDir, "python");
  const venvDir = opts.targetDir ? path.resolve(opts.targetDir) + "-venv" : path.join(baseDir, "python-venv");
  const lockDir = path.join(baseDir || path.dirname(embedDir), ".python-bootstrap.lock");
  const releaseLock = acquireLock(lockDir);

  try {
    // tier 1: managed 已就绪（venv 或 embeddable 任一）
    const venvExe = venvPythonExe(venvDir);
    if (fs.existsSync(venvExe) && pythonWorks(venvExe) && pipWorks(venvExe)) {
      const installed = installPackages(venvExe, opts.packages);
      report({ pythonExe: venvExe, targetDir: venvDir, reused: true, source: "managed", pipReady: true, installed });
      return;
    }
    const embedExe = path.join(embedDir, "python.exe");
    if (fs.existsSync(embedExe) && pythonWorks(embedExe)) {
      enableSiteImport(embedDir);
      if (pipWorks(embedExe)) {
        const installed = installPackages(embedExe, opts.packages);
        report({ pythonExe: embedExe, targetDir: embedDir, reused: true, source: "managed", pipReady: true, installed });
        return;
      }
    }

    // tier 2: 系统 python → 一次性 venv 转化为 managed
    const sysProbe = probeSystemPython();
    if (sysProbe && systemPythonHasPip(sysProbe)) {
      try {
        fs.rmSync(venvDir, { recursive: true, force: true });
        execFileSync(sysProbe.exe, [...sysProbe.pipArgsPrefix, "-m", "venv", venvDir], {
          stdio: "pipe",
          timeout: 180000,
          windowsHide: true,
        });
      } catch (err) {
        process.stderr.write(`[ensure-python] 系统 python 创建 venv 失败，降级 embeddable 路径: ${err.message}\n`);
      }
      if (fs.existsSync(venvExe) && pipWorks(venvExe)) {
        const installed = installPackages(venvExe, opts.packages);
        report({ pythonExe: venvExe, targetDir: venvDir, reused: false, source: "system-venv", pipReady: true, installed });
        return;
      }
    }

    // tier 3: embeddable bootstrap（仅 Windows）
    const result = await ensureManagedBootstrap(embedDir);
    const installed = installPackages(result.pythonExe, opts.packages);
    report({
      pythonExe: result.pythonExe,
      targetDir: result.targetDir,
      reused: result.reused,
      source: result.reused ? "managed" : result.source,
      pipReady: pipWorks(result.pythonExe),
      installed,
    });
  } finally {
    releaseLock();
  }
}

main().catch((err) => fail({ error: "unexpected", detail: String((err && err.stack) || err) }));
