export interface MindNode {
  id: string
  content: string
  children: MindNode[]
  fold?: boolean
  sourceLine?: number
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

export function findParent(root: MindNode, id: string): MindNode | null {
  for (const child of root.children) {
    if (child.id === id) return root
    const parent = findParent(child, id)
    if (parent) return parent
  }
  return null
}

/** 按树顺序取选中分支，父子同时选中时只操作父分支，根节点不参与移动或删除。 */
export function getSelectedBranches(root: MindNode, ids: ReadonlySet<string>): MindNode[] {
  const result: MindNode[] = []
  const visit = (node: MindNode): void => {
    for (const child of node.children) {
      if (ids.has(child.id)) result.push(child)
      else visit(child)
    }
  }
  visit(root)
  return result
}

export type MindmapDropPosition = 'child' | 'before' | 'after'

/** 返回移动后的树；无效目标、循环引用和没有实际变化时不提交。 */
export function moveBranches(
  root: MindNode,
  ids: ReadonlySet<string>,
  targetId: string,
  position: MindmapDropPosition
): MindNode | null {
  const branches = getSelectedBranches(root, ids)
  if (!branches.length || branches.some(node => findNode(node, targetId))) return null
  if (!findNode(root, targetId) || (targetId === root.id && position !== 'child')) return null
  const next = cloneTree(root)
  const moving = branches.map(node => findNode(next, node.id)!)
  for (const node of moving) {
    const parent = findParent(next, node.id)!
    parent.children = parent.children.filter(child => child.id !== node.id)
  }
  const target = findNode(next, targetId)!
  const parent = position === 'child' ? target : findParent(next, targetId)!
  const index = position === 'child' ? parent.children.length
    : parent.children.findIndex(node => node.id === targetId) + (position === 'after' ? 1 : 0)
  parent.children.splice(index, 0, ...moving)
  parent.fold = false
  return treeToMarkdown(next) === treeToMarkdown(root) ? null : next
}

/**
 * 将 Markdown 文本解析为规范的 MindNode 树
 */
export function parseMarkdownToTree(markdown: string): MindNode {
  const lines = markdown.split('\n')
  let root: MindNode | null = null
  const stack: Array<{ level: number; node: MindNode }> = []

  for (let sourceLine = 0; sourceLine < lines.length; sourceLine++) {
    const rawLine = lines[sourceLine]
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
      sourceLine,
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
