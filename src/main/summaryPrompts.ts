/**
 * Summary Prompts 管理模块
 * 负责总结提示词的文件读写、解析、监听、迁移与 schema 升级等功能
 */

import { join } from 'path'
import type { BrowserWindow } from 'electron'

// ============ 类型定义 ============

export type SummaryPromptFileItem = {
    id: string
    name: string
    description?: string
    prompt: string
    isDefault?: boolean
    schemaVersion?: number
}

// ============ 模块状态 ============

let summaryPromptsDir: string = ''
let summaryPromptsWatcher: import('fs').FSWatcher | null = null
let summaryPromptsChangeTimer: NodeJS.Timeout | null = null

/**
 * 初始化模块，设置数据目录，并完成旧目录迁移
 *
 * 迁移规则（迁移在 bootstrap 之前执行）：
 * 1. 新目录 summary-prompts 已存在 → 直接用，不动旧目录。
 * 2. 新目录不存在、旧目录 agent-prompts 存在 → rename 旧→新；rename 失败（跨卷/占用）回退递归 copy + rm。
 * 3. 两者都不存在 → ensureSummaryPromptsDir 创建空目录，由 bootstrap 种子预设。
 *
 * 同步实现：在 app whenReady 之前、模块加载期同步执行，确保后续 watcher / bootstrap 看到的是迁移后的状态。
 */
export function initSummaryPrompts(dataPath: string): void {
    summaryPromptsDir = join(dataPath, 'summary-prompts')
    migrateFromAgentPromptsDir(dataPath)
}

/**
 * 获取 summary-prompts 目录路径
 */
export function getSummaryPromptsDir(): string {
    return summaryPromptsDir
}

// ============ 旧目录迁移 ============

/**
 * 将旧的 agent-prompts 目录同步迁移到 summary-prompts。
 * 仅在“新目录不存在”时尝试迁移；新目录已存在则保守不动旧目录。
 */
function migrateFromAgentPromptsDir(dataPath: string): void {
    const fs = require('fs') as typeof import('fs')
    const oldDir = join(dataPath, 'agent-prompts')

    if (fs.existsSync(summaryPromptsDir)) return
    if (!fs.existsSync(oldDir)) return

    // 优先 rename（同卷下原子且快）
    try {
        fs.renameSync(oldDir, summaryPromptsDir)
        return
    } catch {
        // 跨卷或被占用：回退到递归 copy + rm
    }

    copyDirRecursiveSync(fs, oldDir, summaryPromptsDir)
    try {
        fs.rmSync(oldDir, { recursive: true, force: true })
    } catch {
        // 旧目录残留清理失败不影响主流程；新目录已就绪即可
    }
}

/** 递归拷贝目录（同步） */
function copyDirRecursiveSync(
    fs: typeof import('fs'),
    src: string,
    dest: string
): void {
    fs.mkdirSync(dest, { recursive: true })
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
        const from = join(src, entry.name)
        const to = join(dest, entry.name)
        if (entry.isDirectory()) {
            copyDirRecursiveSync(fs, from, to)
        } else if (entry.isFile()) {
            fs.copyFileSync(from, to)
        }
    }
}

// ============ 工具函数 ============

/**
 * 将字符串转换为安全的文件名
 */
function toSafeFileStem(input: string): string {
    // 移除文件名中不安全的字符（包括 ASCII 控制字符 0x00-0x1F）
    // eslint-disable-next-line no-control-regex
    const unsafeCharsRegex = /[<>:"/\\|?*]|[\u0000-\u001F]/g
    const cleaned = input
        .replace(unsafeCharsRegex, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '')
    return cleaned || 'prompt'
}

/**
 * 确保 summary-prompts 目录存在
 */
export async function ensureSummaryPromptsDir(): Promise<void> {
    const { mkdir } = await import('fs/promises')
    await mkdir(summaryPromptsDir, { recursive: true })
}

/**
 * 移除 BOM 标记
 */
function stripBOM(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * 计算 body 的归一化 hash（trim + 统一 \n 后取 sha256 前 16 hex）。
 * 用于判断用户是否自定义过模板正文：与预设 hash 一致则视为未改过，可安全升级。
 */
function computeBodyHash(body: string): string {
    const crypto = require('crypto') as typeof import('crypto')
    const normalized = (body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 16)
}

// ============ Markdown 解析/格式化 ============

type SummaryPromptMeta = {
    id?: string
    name?: string
    description?: string
    isDefault?: boolean
    schemaVersion?: number
}

/**
 * 解析 Summary Prompt Markdown 文件
 */
function parseSummaryPromptMarkdown(fileName: string, raw: string): SummaryPromptFileItem {
    const text = stripBOM(raw)
    const stem = fileName.replace(/\.md$/i, '')
    let meta: SummaryPromptMeta | undefined = undefined
    let body = text

    let parsedMeta: SummaryPromptMeta | undefined = undefined

    // 循环剥离头部的所有 frontmatter 块（YAML 或 HTML 注释），仅保留最后解析成功的一个作为有效元数据
    // eslint-disable-next-line no-constant-condition
    while (true) {
        // 尝试解析 YAML Frontmatter 格式
        const yamlMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/i)
        // 尝试解析旧版 HTML 注释 JSON 格式
        const htmlMatch = body.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*(?:\r?\n)?/i)

        if (yamlMatch) {
            body = body.slice(yamlMatch[0].length).trimStart()
            const lines = yamlMatch[1].split(/\r?\n/)
            const metaObj: Record<string, any> = {}
            for (const line of lines) {
                const colonIndex = line.indexOf(':')
                if (colonIndex > 0) {
                    const key = line.slice(0, colonIndex).trim()
                    let value = line.slice(colonIndex + 1).trim()
                    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1)
                    } else if (value === 'true') {
                        value = true
                    } else if (value === 'false') {
                        value = false
                    } else if (!isNaN(Number(value)) && value !== '') {
                        value = Number(value)
                    }
                    metaObj[key] = value
                }
            }
            parsedMeta = metaObj as SummaryPromptMeta
        } else if (htmlMatch) {
            body = body.slice(htmlMatch[0].length).trimStart()
            try {
                parsedMeta = JSON.parse(htmlMatch[1])
            } catch {
                // JSON 解析失败时忽略
            }
        } else {
            break
        }
    }

    meta = parsedMeta

    const headingMatch = body.match(/^#\s+(.+)\s*$/m)
    const id = typeof meta?.id === 'string' && meta.id.trim()
        ? meta.id.trim()
        : stem
    const name = typeof meta?.name === 'string' && meta.name.trim()
        ? meta.name.trim()
        : headingMatch?.[1]?.trim() || stem
    const description = typeof meta?.description === 'string' && meta.description.trim()
        ? meta.description.trim()
        : undefined
    const schemaVersion = typeof meta?.schemaVersion === 'number' && Number.isFinite(meta.schemaVersion)
        ? meta.schemaVersion
        : undefined

    return {
        id,
        name,
        description,
        prompt: body.trim(),
        isDefault: Boolean(meta?.isDefault),
        schemaVersion
    }
}

/**
 * 格式化 Summary Prompt 为 Markdown
 */
export function formatSummaryPromptMarkdown(prompt: SummaryPromptFileItem): string {
    const lines: string[] = ['---']
    
    if (prompt.id) lines.push(`id: "${prompt.id}"`)
    if (prompt.name) lines.push(`name: "${prompt.name}"`)
    if (prompt.description) lines.push(`description: "${prompt.description}"`)
    if (prompt.isDefault !== undefined) lines.push(`isDefault: ${prompt.isDefault}`)
    if (prompt.schemaVersion !== undefined) lines.push(`schemaVersion: ${prompt.schemaVersion}`)
    
    lines.push('---', '')

    const body = (prompt.prompt || '').trim()
    return `${lines.join('\n')}\n${body}\n`
}

// ============ 文件操作 ============

/**
 * 列出所有 .md 文件
 */
async function listSummaryPromptFiles(): Promise<string[]> {
    await ensureSummaryPromptsDir()
    const { readdir } = await import('fs/promises')
    const items = await readdir(summaryPromptsDir, { withFileTypes: true })
    return items
        .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
        .map((d) => d.name)
}

/**
 * 列出所有 Summary Prompts
 */
export async function listSummaryPrompts(): Promise<SummaryPromptFileItem[]> {
    const { readFile } = await import('fs/promises')
    const fileNames = await listSummaryPromptFiles()
    const prompts = await Promise.all(
        fileNames.map(async (name) => {
            const content = await readFile(join(summaryPromptsDir, name), 'utf-8')
            return parseSummaryPromptMarkdown(name, content)
        })
    )
    // 旧版本或手工复制文件可能留下相同 id 的多个文件。渲染层按 id
    // 使用 React key，因此这里保留首次出现的条目，避免重复 key 和重复编辑项。
    const seenIds = new Set<string>()
    const uniquePrompts = prompts.filter((prompt) => {
        if (seenIds.has(prompt.id)) return false
        seenIds.add(prompt.id)
        return true
    })
    const isNumericId = (id: string): boolean => /^\d+$/.test(id)
    return uniquePrompts.sort((a, b) => {
        const aNum = isNumericId(a.id)
        const bNum = isNumericId(b.id)
        if (aNum && bNum) return Number(a.id) - Number(b.id)
        if (aNum !== bNum) return aNum ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
}

/**
 * 获取 prompt 索引（id 到文件名的映射）
 */
export async function getSummaryPromptIndex(): Promise<{
    idToFileName: Map<string, string>
    usedStems: Set<string>
}> {
    const { readFile } = await import('fs/promises')
    const fileNames = await listSummaryPromptFiles()
    const idToFileName = new Map<string, string>()
    const usedStems = new Set<string>()

    await Promise.all(
        fileNames.map(async (fileName) => {
            const stem = fileName.replace(/\.md$/i, '')
            usedStems.add(stem)
            try {
                const content = await readFile(join(summaryPromptsDir, fileName), 'utf-8')
                const parsed = parseSummaryPromptMarkdown(fileName, content)
                if (parsed?.id) idToFileName.set(parsed.id, fileName)
            } catch {
                // 文件读取或解析失败时跳过该文件
            }
        })
    )

    return { idToFileName, usedStems }
}

/**
 * 生成唯一的文件名 stem
 */
function pickUniqueStem(baseStem: string, usedStems: Set<string>): string {
    let stem = baseStem
    let counter = 2
    while (usedStems.has(stem)) {
        stem = `${baseStem}-${counter}`
        counter += 1
    }
    return stem
}

/**
 * 初始化默认 prompts（含 schemaVersion 升级逻辑）
 *
 * - 目录为空 → 直接种子全部预设。
 * - 目录非空 → 对每个本地已存在的同 id 预设：
 *   - 本地 body hash == 预设 body hash → 用户未自定义 body → 用预设新版覆盖（新 body + 新 schemaVersion + 新 description）。
 *   - hash 不一致 → 用户改过 body → 保留本地 body，仅回填 description（若无）。
 * - 本地不存在的预设 → 直接写入。
 */
export async function bootstrapSummaryPrompts(defaultPrompts: SummaryPromptFileItem[]): Promise<void> {
    const { writeFile, readFile } = await import('fs/promises')
    const seedById = new Map(defaultPrompts.map(p => [p.id, p]))
    // 预设 body 的 hash 在此一并算出，避免循环内重复计算
    const seedHashById = new Map(defaultPrompts.map(p => [p.id, computeBodyHash(p.prompt)]))

    const existing = await listSummaryPromptFiles()

    // 目录为空：种子全部预设
    if (existing.length === 0) {
        const usedStems = new Set<string>()
        for (const p of defaultPrompts) {
            const baseStem = toSafeFileStem(p.name || p.id)
            const stem = pickUniqueStem(baseStem, usedStems)
            usedStems.add(stem)
            const filePath = join(summaryPromptsDir, `${stem}.md`)
            await writeFile(filePath, formatSummaryPromptMarkdown(p), 'utf-8')
        }
        return
    }

    // 目录非空：逐个 id 升级 / 补种
    const index = await getSummaryPromptIndex()
    const usedStems = index.usedStems

    for (const [id, seed] of seedById.entries()) {
        const fileName = index.idToFileName.get(id)

        // 本地不存在该预设 → 直接写入（如新增的“成稿汇总”）
        if (!fileName) {
            const baseStem = toSafeFileStem(seed.name || id)
            const stem = pickUniqueStem(baseStem, usedStems)
            usedStems.add(stem)
            const filePath = join(summaryPromptsDir, `${stem}.md`)
            await writeFile(filePath, formatSummaryPromptMarkdown(seed), 'utf-8')
            continue
        }

        // 本地已存在：比较 body hash 决定是否覆盖升级
        try {
            const filePath = join(summaryPromptsDir, fileName)
            const content = await readFile(filePath, 'utf-8')
            const parsed = parseSummaryPromptMarkdown(fileName, content)
            const localHash = computeBodyHash(parsed.prompt)
            const seedHash = seedHashById.get(id) ?? computeBodyHash(seed.prompt)

            if (localHash === seedHash) {
                // 用户未改 body → 用预设新版覆盖升级
                await writeFile(
                    filePath,
                    formatSummaryPromptMarkdown({
                        ...seed,
                        // 保留本地 id/name（防止用户改过文件名映射），其余取预设新版
                        id: parsed.id || seed.id,
                        name: parsed.name || seed.name
                    }),
                    'utf-8'
                )
            } else {
                // 用户改过 body → 仅回填 description（若无）
                if (!parsed.description && seed.description) {
                    await writeFile(
                        filePath,
                        formatSummaryPromptMarkdown({
                            ...parsed,
                            description: seed.description
                        }),
                        'utf-8'
                    )
                }
            }
        } catch {
            // 读写失败时跳过该文件
        }
    }
}

/**
 * 写入单个 prompt
 */
export async function writeSummaryPrompt(prompt: SummaryPromptFileItem): Promise<void> {
    await ensureSummaryPromptsDir()
    const { writeFile, rm } = await import('fs/promises')
    const id = String(prompt?.id || '').trim() || String(Date.now())

    const index = await getSummaryPromptIndex()
    let fileName = index.idToFileName.get(id)
    if (!fileName) {
        const baseStem = toSafeFileStem(prompt.name || id)
        const stem = pickUniqueStem(baseStem, index.usedStems)
        fileName = `${stem}.md`
    }

    const oldFileName = index.idToFileName.get(id)
    if (oldFileName && oldFileName !== fileName) {
        await rm(join(summaryPromptsDir, oldFileName), { force: true })
    }

    const finalPrompt = { ...prompt, id }
    await writeFile(join(summaryPromptsDir, fileName), formatSummaryPromptMarkdown(finalPrompt), 'utf-8')
}

/**
 * 删除单个 prompt
 */
export async function deleteSummaryPrompt(promptId: string): Promise<void> {
    await ensureSummaryPromptsDir()
    const { rm } = await import('fs/promises')
    const index = await getSummaryPromptIndex()
    const fileName = index.idToFileName.get(promptId) || `${toSafeFileStem(promptId)}.md`
    const filePath = join(summaryPromptsDir, fileName)
    await rm(filePath, { force: true })
}

// ============ 文件监听 ============

/**
 * 启动文件监听器
 */
export function startSummaryPromptsWatcher(window: BrowserWindow): void {
    try {
        const fs = require('fs') as typeof import('fs')
        if (summaryPromptsWatcher) return
        summaryPromptsWatcher = fs.watch(summaryPromptsDir, { recursive: false }, () => {
            if (summaryPromptsChangeTimer) clearTimeout(summaryPromptsChangeTimer)
            summaryPromptsChangeTimer = setTimeout(() => {
                if (!window.isDestroyed()) {
                    window.webContents.send('summary-prompts-changed')
                }
            }, 150)
        })

        window.on('closed', () => {
            try {
                summaryPromptsWatcher?.close()
            } catch {
                // 关闭 watcher 失败时忽略
            }
            summaryPromptsWatcher = null
            if (summaryPromptsChangeTimer) clearTimeout(summaryPromptsChangeTimer)
            summaryPromptsChangeTimer = null
        })
    } catch {
        // 启动文件监听器失败时忽略（可能是目录不存在）
    }
}
