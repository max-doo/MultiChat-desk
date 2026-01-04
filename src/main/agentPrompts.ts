/**
 * Agent Prompts 管理模块
 * 负责 Agent 提示词的文件读写、解析、监听等功能
 */

import { join } from 'path'
import type { BrowserWindow } from 'electron'

// ============ 类型定义 ============

export type AgentPromptFileItem = {
    id: string
    name: string
    description?: string
    prompt: string
    isDefault?: boolean
}

// ============ 模块状态 ============

let agentPromptsDir: string = ''
let agentPromptsWatcher: import('fs').FSWatcher | null = null
let agentPromptsChangeTimer: NodeJS.Timeout | null = null

/**
 * 初始化模块，设置数据目录
 */
export function initAgentPrompts(dataPath: string): void {
    agentPromptsDir = join(dataPath, 'agent-prompts')
}

/**
 * 获取 agent-prompts 目录路径
 */
export function getAgentPromptsDir(): string {
    return agentPromptsDir
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
 * 确保 agent-prompts 目录存在
 */
export async function ensureAgentPromptsDir(): Promise<void> {
    const { mkdir } = await import('fs/promises')
    await mkdir(agentPromptsDir, { recursive: true })
}

/**
 * 移除 BOM 标记
 */
function stripBOM(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// ============ Markdown 解析/格式化 ============

/**
 * 解析 Agent Prompt Markdown 文件
 */
function parseAgentPromptMarkdown(fileName: string, raw: string): AgentPromptFileItem {
    const text = stripBOM(raw)
    const stem = fileName.replace(/\.md$/i, '')
    const metaMatch = text.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*(?:\r?\n)?/i)
    let meta: { id?: string; name?: string; order?: number; description?: string; isDefault?: boolean } | undefined = undefined
    let body = text
    if (metaMatch) {
        body = text.slice(metaMatch[0].length)
        try {
            meta = JSON.parse(metaMatch[1])
        } catch {
            // JSON 解析失败时忽略元数据，使用默认值
        }
    }

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

    return {
        id,
        name,
        description,
        prompt: body.trim(),
        isDefault: Boolean(meta?.isDefault)
    }
}

/**
 * 格式化 Agent Prompt 为 Markdown
 */
export function formatAgentPromptMarkdown(prompt: AgentPromptFileItem): string {
    const header = {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        isDefault: Boolean(prompt.isDefault)
    }
    const body = (prompt.prompt || '').trim()
    return `<!--${JSON.stringify(header)}-->\n\n${body}\n`
}

// ============ 文件操作 ============

/**
 * 列出所有 .md 文件
 */
async function listAgentPromptFiles(): Promise<string[]> {
    await ensureAgentPromptsDir()
    const { readdir } = await import('fs/promises')
    const items = await readdir(agentPromptsDir, { withFileTypes: true })
    return items
        .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
        .map((d) => d.name)
}

/**
 * 列出所有 Agent Prompts
 */
export async function listAgentPrompts(): Promise<AgentPromptFileItem[]> {
    const { readFile } = await import('fs/promises')
    const fileNames = await listAgentPromptFiles()
    const prompts = await Promise.all(
        fileNames.map(async (name) => {
            const content = await readFile(join(agentPromptsDir, name), 'utf-8')
            return parseAgentPromptMarkdown(name, content)
        })
    )
    const isNumericId = (id: string): boolean => /^\d+$/.test(id)
    return prompts.sort((a, b) => {
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
export async function getAgentPromptIndex(): Promise<{
    idToFileName: Map<string, string>
    usedStems: Set<string>
}> {
    const { readFile } = await import('fs/promises')
    const fileNames = await listAgentPromptFiles()
    const idToFileName = new Map<string, string>()
    const usedStems = new Set<string>()

    await Promise.all(
        fileNames.map(async (fileName) => {
            const stem = fileName.replace(/\.md$/i, '')
            usedStems.add(stem)
            try {
                const content = await readFile(join(agentPromptsDir, fileName), 'utf-8')
                const parsed = parseAgentPromptMarkdown(fileName, content)
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
 * 初始化默认 prompts（如果目录为空）
 */
export async function bootstrapAgentPrompts(defaultPrompts: AgentPromptFileItem[]): Promise<void> {
    const { writeFile, readFile } = await import('fs/promises')
    const existing = await listAgentPromptFiles()
    if (existing.length > 0) {
        const index = await getAgentPromptIndex()
        const seedById = new Map(defaultPrompts.map(p => [p.id, p]))
        for (const [id, fileName] of index.idToFileName.entries()) {
            const seed = seedById.get(id)
            if (!seed?.description) continue
            try {
                const filePath = join(agentPromptsDir, fileName)
                const content = await readFile(filePath, 'utf-8')
                const parsed = parseAgentPromptMarkdown(fileName, content)
                if (parsed.description) continue
                await writeFile(
                    filePath,
                    formatAgentPromptMarkdown({
                        ...parsed,
                        description: seed.description
                    }),
                    'utf-8'
                )
            } catch {
                // 写入失败时跳过该文件
            }
        }
        return
    }
    const usedStems = new Set<string>()
    for (const p of defaultPrompts) {
        const baseStem = toSafeFileStem(p.name || p.id)
        const stem = pickUniqueStem(baseStem, usedStems)
        usedStems.add(stem)
        const filePath = join(agentPromptsDir, `${stem}.md`)
        await writeFile(filePath, formatAgentPromptMarkdown(p), 'utf-8')
    }
}

/**
 * 写入单个 prompt
 */
export async function writeAgentPrompt(prompt: AgentPromptFileItem): Promise<void> {
    await ensureAgentPromptsDir()
    const { writeFile, rm } = await import('fs/promises')
    const id = String(prompt?.id || '').trim() || String(Date.now())

    const index = await getAgentPromptIndex()
    let fileName = index.idToFileName.get(id)
    if (!fileName) {
        const baseStem = toSafeFileStem(prompt.name || id)
        const stem = pickUniqueStem(baseStem, index.usedStems)
        fileName = `${stem}.md`
    }

    const oldFileName = index.idToFileName.get(id)
    if (oldFileName && oldFileName !== fileName) {
        await rm(join(agentPromptsDir, oldFileName), { force: true })
    }

    const finalPrompt = { ...prompt, id }
    await writeFile(join(agentPromptsDir, fileName), formatAgentPromptMarkdown(finalPrompt), 'utf-8')
}

/**
 * 删除单个 prompt
 */
export async function deleteAgentPrompt(promptId: string): Promise<void> {
    await ensureAgentPromptsDir()
    const { rm } = await import('fs/promises')
    const index = await getAgentPromptIndex()
    const fileName = index.idToFileName.get(promptId) || `${toSafeFileStem(promptId)}.md`
    const filePath = join(agentPromptsDir, fileName)
    await rm(filePath, { force: true })
}

// ============ 文件监听 ============

/**
 * 启动文件监听器
 */
export function startAgentPromptsWatcher(window: BrowserWindow): void {
    try {
        const fs = require('fs') as typeof import('fs')
        if (agentPromptsWatcher) return
        agentPromptsWatcher = fs.watch(agentPromptsDir, { recursive: false }, () => {
            if (agentPromptsChangeTimer) clearTimeout(agentPromptsChangeTimer)
            agentPromptsChangeTimer = setTimeout(() => {
                if (!window.isDestroyed()) {
                    window.webContents.send('agent-prompts-changed')
                }
            }, 150)
        })

        window.on('closed', () => {
            try {
                agentPromptsWatcher?.close()
            } catch {
                // 关闭 watcher 失败时忽略
            }
            agentPromptsWatcher = null
            if (agentPromptsChangeTimer) clearTimeout(agentPromptsChangeTimer)
            agentPromptsChangeTimer = null
        })
    } catch {
        // 启动文件监听器失败时忽略（可能是目录不存在）
    }
}
