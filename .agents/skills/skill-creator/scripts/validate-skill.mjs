#!/usr/bin/env node
/*
 * validate-skill.mjs — skill 目录结构校验（宿主无关，零依赖 Node 脚本）。
 *
 * 用法: node validate-skill.mjs <skill-directory>
 *
 * 校验项:
 *   - SKILL.md 存在且有合法 YAML frontmatter
 *   - frontmatter 只允许 name / description / license 键
 *   - name 必填: hyphen-case（小写字母、数字、连字符），长度 <= 64
 *   - description 必填: 无尖括号，长度 <= 1024
 */
import fs from "node:fs";
import path from "node:path";

const MAX_SKILL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const ALLOWED_KEYS = new Set(["name", "description", "license"]);

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// 极简 frontmatter 解析：顶层 key: value（value 可跨行延续直到下一个顶层 key），
// 支持 description 的引号包裹多行写法。不支持的 YAML 特性直接报错而不是猜。
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  const entries = new Map();
  let currentKey = null;
  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      entries.set(currentKey, keyMatch[2]);
      continue;
    }
    if (currentKey && /^\s+\S/.test(line)) {
      entries.set(currentKey, entries.get(currentKey) + " " + line.trim());
      continue;
    }
    if (line.trim() === "") continue;
    return { error: `无法解析的 frontmatter 行: ${line.slice(0, 60)}` };
  }
  const out = {};
  for (const [key, raw] of entries) {
    out[key] = stripQuotes(raw);
  }
  return { data: out };
}

function validateSkill(skillPath) {
  const dir = path.resolve(skillPath);
  const skillMd = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillMd)) return [false, "SKILL.md not found"];

  const content = fs.readFileSync(skillMd, "utf8");
  if (!content.startsWith("---")) return [false, "No YAML frontmatter found"];

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [false, "Invalid frontmatter format"];

  const parsed = parseFrontmatter(match[1]);
  if (parsed.error) return [false, `Invalid YAML in frontmatter: ${parsed.error}`];
  const fm = parsed.data;

  const unexpected = Object.keys(fm).filter((k) => !ALLOWED_KEYS.has(k));
  if (unexpected.length) {
    return [
      false,
      `Unexpected key(s) in SKILL.md frontmatter: ${unexpected.sort().join(", ")}. ` +
        `Allowed properties are: ${[...ALLOWED_KEYS].sort().join(", ")}`,
    ];
  }

  if (!("name" in fm)) return [false, "Missing 'name' in frontmatter"];
  if (!("description" in fm)) return [false, "Missing 'description' in frontmatter"];

  const name = fm.name.trim();
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      return [false, `Name '${name}' should be hyphen-case (lowercase letters, digits, and hyphens only)`];
    }
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      return [false, `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`];
    }
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      return [false, `Name is too long (${name.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH} characters.`];
    }
  }

  const description = fm.description.trim();
  if (description) {
    if (description.includes("<") || description.includes(">")) {
      return [false, "Description cannot contain angle brackets (< or >)"];
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return [false, `Description is too long (${description.length} characters). Maximum is ${MAX_DESCRIPTION_LENGTH} characters.`];
    }
  }

  return [true, "Skill is valid!"];
}

if (process.argv.length !== 3) {
  console.log("Usage: node validate-skill.mjs <skill_directory>");
  process.exit(1);
}

const [valid, message] = validateSkill(process.argv[2]);
console.log(message);
process.exit(valid ? 0 : 1);
