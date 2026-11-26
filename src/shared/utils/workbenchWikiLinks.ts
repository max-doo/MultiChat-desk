/**
 * 从 Markdown 文本中提取双链 [[target]] 目标，按出现顺序去重。
 * 跳过 Frontmatter、围栏代码块与行内代码，与行内标签提取保持同一套口径。
 * [[target|display]] 只取 target；嵌入 ![[x]] 的内部 [[x]] 同样计为引用（与 Obsidian 一致）。
 */
export function extractWikiLinkTargets(content: string): string[] {
  const targets: string[] = []
  const seen = new Set<string>()
  const lines = content.split(/\r?\n/)
  let inFencedCode = false
  let inFrontmatter = false

  // 行内代码 `code` / ``code`` 整段挖掉，避免示例文本里的 [[x]] 被误算。
  // 只处理不成对的同符反引号串，覆盖常见笔记场景够用。
  const INLINE_CODE_RE = /(`+)(?!`)[^`\n]*?\1/g
  const WIKI_LINK_RE = /\[\[([^\]\n]+)\]\]/g

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (line.trim() === '---') inFrontmatter = false
      continue
    }

    if (/^\s*(```|~~~)/.test(line)) {
      inFencedCode = !inFencedCode
      continue
    }
    if (inFencedCode) continue

    const stripped = line.replace(INLINE_CODE_RE, '')
    let match: RegExpExecArray | null
    WIKI_LINK_RE.lastIndex = 0
    while ((match = WIKI_LINK_RE.exec(stripped)) !== null) {
      const inner = match[1]
      const pipeIndex = inner.indexOf('|')
      const target = (pipeIndex === -1 ? inner : inner.slice(0, pipeIndex)).trim()
      if (!target) continue
      const key = target.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        targets.push(target)
      }
    }
  }

  return targets
}
