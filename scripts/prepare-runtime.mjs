#!/usr/bin/env node
/*
 * prepare-runtime.mjs — 打包期运行时准备（必须幂等，可反复执行）。
 *
 * 职责：
 * 1. 把 scripts/shared/ensure-python.mjs 复制到 build/runtime/shared/
 *    （electron-builder extraResources 把 build/runtime 整目录拷到 resources/runtime）。
 * 2. 生成 node 入口 shim 到 build/runtime/bin/：
 *    - node.cmd（Windows，嵌套 shell 兜底；顶层 PowerShell 的 node 由 spawnHook 注入，
 *      不依赖此 shim）。%* 转发的 cmd 二次分词局限已知，仅作兜底。
 *    - node（POSIX sh，mac/linux）。
 * 3. 对 build/skills/ 下每个含 package.json 的 skill 执行 npm install --omit=dev，
 *    node_modules 随 skill 目录一起进包；用户机器运行时无 npm，依赖必须打包期就位。
 * 4. 输出体积报告。
 *
 * .gitignore 全局忽略 node_modules/ 与 build/runtime/，因此每次打包（含换机/CI）
 * 都必须先跑本脚本——已接线进 package.json 的 build 脚本链。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 深度优先遍历（不递归进符号链接），返回文件绝对路径列表 */
function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * skill node_modules 体积裁剪（实测压缩后省约 3.5MB）：
 * - @types/* 与 *.d.ts/.d.cts/.d.mts：纯编译期产物，运行时永远不会被 require。
 * - *.umd.cjs / *.iife.js：浏览器传统打包产物。删除前先解析所在包的 package.json，
 *   凡 main/module/exports/browser 任意字段引用到该文件名的一律保留——
 *   docx 的 main 恰好指向 index.umd.cjs，但 exports 优先于 main 且不引用 umd/iife。
 */
function pruneNodeModules(skillDir) {
  const nmRoot = path.join(skillDir, "node_modules");
  if (!fs.existsSync(nmRoot)) return { removed: 0, bytes: 0 };
  let removed = 0;
  let bytes = 0;
  const removeFile = (file) => {
    try {
      bytes += fs.statSync(file).size;
      fs.rmSync(file);
      removed++;
    } catch {
      // 单个失败不阻断整体裁剪
    }
  };
  const pkgEntryRefs = new Map(); // pkgDir -> Set<basename>
  const entryRefsOf = (pkgDir) => {
    if (pkgEntryRefs.has(pkgDir)) return pkgEntryRefs.get(pkgDir);
    const refs = new Set();
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      const text = JSON.stringify({
        main: pkg.main,
        module: pkg.module,
        browser: pkg.browser,
        exports: pkg.exports,
      });
      for (const match of text.matchAll(/([\w.-]+\.(?:umd\.cjs|iife\.js))/g)) {
        refs.add(match[1]);
      }
    } catch {
      // 无 package.json 的目录保守起见不裁剪 umd/iife——refs 保持为空时调用方跳过
    }
    pkgEntryRefs.set(pkgDir, refs);
    return refs;
  };
  const isTypesDir = (file) =>
    file.split(path.sep).includes("@types");
  for (const file of walkFiles(nmRoot)) {
    const base = path.basename(file);
    if (isTypesDir(file) || /\.d\.(ts|cts|mts)$/.test(base)) {
      removeFile(file);
      continue;
    }
    if (/\.(umd\.cjs|iife\.js)$/.test(base)) {
      // 找到所属包目录（node_modules/[@scope/]<pkg>/...）
      const rel = path.relative(nmRoot, file).split(path.sep);
      const pkgDir = rel[0].startsWith("@")
        ? path.join(nmRoot, rel[0], rel[1])
        : path.join(nmRoot, rel[0]);
      if (!fs.existsSync(path.join(pkgDir, "package.json"))) continue;
      if (!entryRefsOf(pkgDir).has(base)) removeFile(file);
    }
  }
  return { removed, bytes };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(repoRoot, "build", "runtime");
const sharedDir = path.join(runtimeDir, "shared");
const binDir = path.join(runtimeDir, "bin");
const skillsRoot = path.join(repoRoot, "build", "skills");

function sizeOf(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += sizeOf(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  } catch {
    // ignore
  }
  return total;
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

// 1. 共享脚本
fs.mkdirSync(sharedDir, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "scripts", "shared", "ensure-python.mjs"), path.join(sharedDir, "ensure-python.mjs"));
console.log("[prepare-runtime] shared/ensure-python.mjs copied");

// 2. node shim（打包版安装布局：<root>/MultiChat.exe + <root>/resources/runtime/bin）
//    resources/runtime/bin 上溯三级到应用根：bin → runtime → resources → <root>
fs.mkdirSync(binDir, { recursive: true });
const cmdShim = [
  "@echo off",
  "rem MultiChat bundled node entry (ELECTRON_RUN_AS_NODE passthrough).",
  "rem top-level PowerShell node comes from the spawnHook-injected function;",
  "rem this shim only covers nested shells (cmd / powershell -Command inside scripts).",
  "set ELECTRON_RUN_AS_NODE=1",
  '"%~dp0..\\..\\..\\MultiChat.exe" %*',
  "",
].join("\r\n");
fs.writeFileSync(path.join(binDir, "node.cmd"), cmdShim, "utf8");

// POSIX：macOS 的 exe 在 Contents/MacOS/<productName>；linux 在应用根。
// resources/runtime/bin 上溯三级：bin → runtime → resources → <root>
const shShim = [
  "#!/bin/sh",
  "# MultiChat bundled node entry (ELECTRON_RUN_AS_NODE passthrough).",
  'ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"',
  'if [ -x "$ROOT/MultiChat" ]; then EXE="$ROOT/MultiChat"',
  'elif [ -x "$ROOT/MacOS/MultiChat" ]; then EXE="$ROOT/MacOS/MultiChat"',
  'elif [ -x "$ROOT/../MacOS/MultiChat" ]; then EXE="$ROOT/../MacOS/MultiChat"',
  'else echo "MultiChat executable not found" >&2; exit 1; fi',
  'ELECTRON_RUN_AS_NODE=1 exec "$EXE" "$@"',
  "",
].join("\n");
fs.writeFileSync(path.join(binDir, "node"), shShim, "utf8");
try {
  fs.chmodSync(path.join(binDir, "node"), 0o755);
} catch {
  // Windows 上 chmod 语义有限；mac/linux 打包时由 electron-builder 保留权限
}
console.log("[prepare-runtime] bin/node.cmd + bin/node generated");

// 3. skill npm 依赖预装（幂等：package.json mtime 未变且 node_modules 存在则跳过）。
// 目录分层：internal/ 下是侧边 Agent 的挂载根，multichat-cli 在根部（外部 agent 专属），
// 两者都是 skill——预装扫描必须递归一层找到所有含 package.json 的 skill 目录。
function collectSkillDirs(root) {
  const out = [];
  const scan = (dir, depth) => {
    if (depth > 2) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, "SKILL.md"))) {
        out.push(full);
      } else {
        scan(full, depth + 1);
      }
    }
  };
  scan(root, 0);
  return out;
}

let installed = 0;
let skipped = 0;
if (fs.existsSync(skillsRoot)) {
  for (const skillDir of collectSkillDirs(skillsRoot)) {
    const relName = path.relative(skillsRoot, skillDir).split(path.sep).join("/");
    const pkgPath = path.join(skillDir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const stampPath = path.join(skillDir, "node_modules", ".prepare-stamp");
    const pkgMtime = fs.statSync(pkgPath).mtimeMs;
    let upToDate = false;
    try {
      upToDate = fs.existsSync(stampPath) && Number(fs.readFileSync(stampPath, "utf8")) >= pkgMtime;
    } catch {
      upToDate = false;
    }
    if (upToDate) {
      skipped++;
      continue;
    }
    console.log(`[prepare-runtime] npm install --omit=dev in build/skills/${relName}`);
    // Windows 上 execFile 无法直接 spawn npm.cmd（Node CVE-2024-27980 修复后 EINVAL），
    // 参数全部是固定字面量，走 shell 字符串没有注入面。
    const installCmd = "npm install --omit=dev --no-audit --no-fund --loglevel=error";
    execSync(installCmd, { cwd: skillDir, stdio: "inherit", shell: true });
    const pruned = pruneNodeModules(skillDir);
    console.log(
      `[prepare-runtime] pruned ${pruned.removed} files (${mb(pruned.bytes)} MB) from ${relName}/node_modules`
    );
    fs.writeFileSync(stampPath, String(Date.now()), "utf8");
    installed++;
  }
}
console.log(`[prepare-runtime] skill deps: ${installed} installed, ${skipped} up-to-date`);

// 4. 体积报告
let skillTotal = 0;
if (fs.existsSync(skillsRoot)) {
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    skillTotal += sizeOf(path.join(skillsRoot, entry.name));
  }
}
console.log(`[prepare-runtime] build/skills total: ${mb(skillTotal)} MB (uncompressed, incl. node_modules)`);
console.log(`[prepare-runtime] build/runtime total: ${mb(sizeOf(runtimeDir))} MB`);
