export interface MindNode {
  id: string
  content: string
  children: MindNode[]
  fold?: boolean
}

let idSeed = 1
export function generateId(): string {
  return `node-${Date.now()}-${idSeed++}`
}

/**
 * 递归深拷贝 MindNode 树
 */
export function cloneTree(root: MindNode): MindNode {
  return {
    ...root,
    children: root.children.map((c) => cloneTree(c))
  }
}

/**
 * 递归查找指定 ID 节点
 */
export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

/**
 * 将 Markdown 文本解析为规范的 MindNode 树
 */
export function parseMarkdownToTree(markdown: string): MindNode {
  const lines = markdown.split('\n')
  let root: MindNode | null = null
  const stack: Array<{ level: number; node: MindNode }> = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue

    const trimmed = line.trimStart()
    const indent = line.length - trimmed.length

    let content = ''
    let level = 0

    if (trimmed.startsWith('# ')) {
      level = 0
      content = trimmed.replace(/^#\s+/, '').trim()
    } else if (trimmed.startsWith('## ')) {
      level = 1
      content = trimmed.replace(/^##\s+/, '').trim()
    } else if (trimmed.startsWith('### ')) {
      level = 2
      content = trimmed.replace(/^###\s+/, '').trim()
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      level = 2 + Math.floor(indent / 2)
      content = trimmed.replace(/^[-*]\s+/, '').trim()
    } else {
      continue
    }

    const node: MindNode = {
      id: generateId(),
      content: content || '未命名分支',
      children: [],
      fold: false
    }

    if (!root) {
      root = node
      stack.push({ level: 0, node })
      continue
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(node)
    } else {
      root.children.push(node)
    }

    stack.push({ level, node })
  }

  return root || { id: generateId(), content: '思维导图', children: [], fold: false }
}

/**
 * 将 MindNode 树序列化为干净的标准 Markdown 文本
 */
export function treeToMarkdown(root: MindNode): string {
  if (!root) return '# 思维导图\n'
  const lines: string[] = [`# ${root.content}`, '']

  function walk(node: MindNode, depth: number): void {
    if (!node.children || node.children.length === 0) return
    for (const child of node.children) {
      if (depth === 1) {
        lines.push('')
        lines.push(`## ${child.content}`)
      } else {
        const indent = '  '.repeat(depth - 2)
        lines.push(`${indent}- ${child.content}`)
      }
      walk(child, depth + 1)
    }
  }

  walk(root, 1)
  return lines.join('\n').trim()
}
