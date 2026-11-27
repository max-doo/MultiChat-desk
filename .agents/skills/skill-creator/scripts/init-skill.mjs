#!/usr/bin/env node
/*
 * init-skill.mjs — 创建新 skill 目录与 SKILL.md 模板（宿主无关，Node 运行）。
 *
 * 用法:
 *   node init-skill.mjs <skill-name> --path <output-dir> [--resources scripts,references,assets] [--examples]
 */
import fs from "node:fs";
import path from "node:path";

const MAX_SKILL_NAME_LENGTH = 64;
const ALLOWED_RESOURCES = new Set(["scripts", "references", "assets"]);

const SKILL_TEMPLATE = `---
name: {skill_name}
description: [TODO: 完整说明这个 skill 做什么、什么时候使用。必须包含触发时机——具体的场景、文件类型或任务。description 是唯一的触发依据，"何时使用"的信息写在这里，不要写在正文里。]
---

# {skill_title}

## 概述

[TODO: 1-2 句话说明这个 skill 让 Agent 能做什么]

## 选择本 skill 的结构

[TODO: 选择最贴合用途的结构模式。常见模式：

**1. 工作流式**（适合有明确步骤顺序的流程）
- 例：文档处理类 skill 的"读取 -> 创建 -> 编辑"
- 结构：## 概述 -> ## 流程决策 -> ## 步骤 1 -> ## 步骤 2...

**2. 任务式**（适合工具集合）
- 例：PDF skill 的"合并 -> 拆分 -> 抽取文本"
- 结构：## 概述 -> ## 快速上手 -> ## 任务类别 1 -> ## 任务类别 2...

**3. 规范/准则式**（适合标准与规范）
- 例：品牌规范、编码标准
- 结构：## 概述 -> ## 准则 -> ## 规格 -> ## 用法...

**4. 能力式**（适合多功能集成系统）
- 结构：## 概述 -> ## 核心能力 -> ### 1. 能力 -> ### 2. 能力...

模式可以混合。写完后删除整个"选择本 skill 的结构"小节——它只是引导。]

## [TODO: 按所选结构替换为第一个主体小节]

[TODO: 在这里写内容。参考要点：
- 技术型 skill 给代码示例
- 复杂流程给决策树
- 给真实的用户请求示例
- 按需引用 scripts/references/assets 中的资源]

## 资源（可选）

只为真正需要的资源建目录。没有资源就删除本节。

### scripts/
可直接执行完成特定操作的代码（Node/Python/PowerShell 等）。

**适合：** 需要确定性可靠或反复重写的操作——自动化、数据处理、格式转换。

**注意：** 脚本可以不经加载直接执行，但 Agent 也可能读取它做环境适配或修补。

### references/
按需加载进上下文、供 Agent 工作时参考的文档。

**适合：** 深入的文档、API 参考、数据库 schema、完整指南——任何 Agent 工作需要参考的详细信息。

### assets/
不加载进上下文、直接用于产出物的文件。

**适合：** 模板、样板代码、文档模板、图片、图标、字体，以及会被复制或修改进最终产出的文件。

---

**不是每个 skill 都需要全部三种资源。**
`;

const EXAMPLE_SCRIPT = `// {skill_name} 的示例辅助脚本（占位）
//
// 这是一个可以直接执行的占位脚本。替换为真实实现；不需要就删除。

console.log("This is an example script for {skill_name}");
// TODO: 在这里写实际逻辑：数据处理、格式转换、API 调用等
`;

const EXAMPLE_REFERENCE = `# {skill_title} 参考文档

这是详细参考文档的占位。替换为真实参考内容；不需要就删除。

## 什么时候需要参考文档

- 完整的 API 文档
- 详细的工作流指南
- 复杂的多步骤流程
- 放不进 SKILL.md 的长内容
- 只在特定场景才需要的内容

## 结构建议

### API 参考型
- 概述 / 鉴权 / 端点与示例 / 错误码 / 限流

### 流程指南型
- 前置条件 / 分步说明 / 常见模式 / 排错 / 最佳实践
`;

const EXAMPLE_ASSET = `# 示例资产文件

这个占位文件代表资产文件的存放位置。替换为真实资产（模板、图片、字体等）；不需要就删除。

资产文件不加载进上下文，而是直接用于 Agent 产出的成果。

## 常见资产类型

- 模板：.pptx、.docx、样板项目目录
- 图片：.png、.jpg、.svg、.gif
- 字体：.ttf、.otf、.woff、.woff2
- 样板代码：项目目录、起步文件
- 数据文件：.csv、.json、.xml、.yaml
`;

function normalizeSkillName(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function titleCase(name) {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseArgs(argv) {
  const out = { skillName: null, path: null, resources: "", examples: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") out.path = argv[++i];
    else if (a === "--resources") out.resources = argv[++i];
    else if (a === "--examples") out.examples = true;
    else if (!a.startsWith("--") && !out.skillName) out.skillName = a;
  }
  return out;
}

function fail(msg) {
  console.error(`[ERROR] ${msg}`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skillName) fail("缺少 skill 名称。用法: node init-skill.mjs <skill-name> --path <output-dir>");
  if (!args.path) fail("缺少 --path <output-dir>");

  const raw = args.skillName;
  const skillName = normalizeSkillName(raw);
  if (!skillName) fail("skill 名称至少包含一个字母或数字。");
  if (skillName.length > MAX_SKILL_NAME_LENGTH) {
    fail(`skill 名称 '${skillName}' 过长（${skillName.length} 字符），上限 ${MAX_SKILL_NAME_LENGTH}。`);
  }
  if (skillName !== raw) console.log(`注意：名称已从 '${raw}' 规范化为 '${skillName}'。`);

  const resources = args.resources
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = resources.filter((r) => !ALLOWED_RESOURCES.has(r));
  if (invalid.length) fail(`未知资源类型: ${invalid.join(", ")}。可选: ${[...ALLOWED_RESOURCES].join(", ")}`);
  if (args.examples && !resources.length) fail("--examples 需要同时指定 --resources。");

  const skillDir = path.join(path.resolve(args.path), skillName);
  if (fs.existsSync(skillDir)) fail(`目录已存在: ${skillDir}`);
  fs.mkdirSync(skillDir, { recursive: true });
  console.log(`[OK] 创建目录: ${skillDir}`);

  const skillTitle = titleCase(skillName);
  const content = SKILL_TEMPLATE.replaceAll("{skill_name}", skillName).replaceAll("{skill_title}", skillTitle);
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
  console.log("[OK] 创建 SKILL.md");

  for (const resource of new Set(resources)) {
    const dir = path.join(skillDir, resource);
    fs.mkdirSync(dir, { recursive: true });
    if (!args.examples) {
      console.log(`[OK] 创建 ${resource}/`);
      continue;
    }
    if (resource === "scripts") {
      fs.writeFileSync(path.join(dir, "example.mjs"), EXAMPLE_SCRIPT.replaceAll("{skill_name}", skillName), "utf8");
      console.log("[OK] 创建 scripts/example.mjs");
    } else if (resource === "references") {
      fs.writeFileSync(path.join(dir, "api_reference.md"), EXAMPLE_REFERENCE.replaceAll("{skill_title}", skillTitle), "utf8");
      console.log("[OK] 创建 references/api_reference.md");
    } else if (resource === "assets") {
      fs.writeFileSync(path.join(dir, "example_asset.txt"), EXAMPLE_ASSET, "utf8");
      console.log("[OK] 创建 assets/example_asset.txt");
    }
  }

  console.log(`\n[OK] skill '${skillName}' 初始化完成: ${skillDir}`);
  console.log("\n后续步骤:");
  console.log("1. 编辑 SKILL.md，完成所有 TODO 并写好 description（触发边界）");
  console.log("2. 按需填充 scripts/、references/、assets/；示例文件替换或删除");
  console.log("3. 运行 validate-skill.mjs 校验结构");
}

main();
