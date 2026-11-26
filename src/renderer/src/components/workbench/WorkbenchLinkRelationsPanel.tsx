import { useMemo } from 'react'
import { AppIcon } from '../icons/AppIcon'
import { MARKDOWN_EXTENSIONS } from '../../../../shared/types/workbench'
import { extractWikiLinkTargets } from '../../../../shared/utils/workbenchWikiLinks'
import { flattenSortedFiles, useWorkbenchStore } from '../../store/workbenchStore'
import { FileChipIcon, FileChipMissingIcon, WorkbenchFileChip } from './WorkbenchFileChip'
import { resolveWikiLinkTarget, type WikiLinkResolution } from './workbenchWikiLinks'

/** Markdown 文档显示去扩展名的文件名（与行内 chip 默认显示一致），其他文件用完整文件名 */
function linkChipLabel(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot > 0 && MARKDOWN_EXTENSIONS.has(name.slice(dot).toLowerCase())) {
    return name.slice(0, dot)
  }
  return name
}

interface LinkChipData {
  key: string
  label: string
  path: string | null
  nodeName: string | null
  nodeFullPath: string | null
  rawTarget: string
}

function toChipData(target: string, resolution: WikiLinkResolution): LinkChipData {
  const node = resolution.node
  return {
    key: target,
    label: node ? linkChipLabel(node.name) : target.split('/').pop() || target,
    path: resolution.path,
    nodeName: node?.name ?? null,
    nodeFullPath: node?.fullPath ?? null,
    rawTarget: target
  }
}

function LinkChip({ data }: { data: LinkChipData }): JSX.Element {
  const missing = data.path === null
  if (missing) {
    return (
      <WorkbenchFileChip
        missing
        label={data.label}
        title={`${data.rawTarget}（未找到目标文件）`}
        icon={<FileChipMissingIcon />}
      />
    )
  }
  const name = data.nodeName ?? data.label
  return (
    <WorkbenchFileChip
      label={data.label}
      title={data.path ?? data.rawTarget}
      icon={<FileChipIcon absPath={data.nodeFullPath ?? data.path ?? ''} name={name} />}
      onClick={() => {
        if (data.path) {
          void useWorkbenchStore.getState().openFile(data.path, { forcePermanent: true })
        }
      }}
    />
  )
}

function RelationRow({
  icon,
  label,
  items
}: {
  icon: 'arrow_outward' | 'arrow_back'
  label: string
  items: LinkChipData[]
}): JSX.Element {
  return (
    // 字号与笔记属性面板对齐（text-body）；chip 图标是 em 尺寸会同步缩小
    <div className="flex items-start gap-3 rounded-md -mx-1 px-1 py-0.5 text-body">
      <div className="flex items-center gap-1.5 w-32 shrink-0 pt-[3px] text-body text-gray-500 dark:text-gray-400">
        <AppIcon name={icon} size={15} className="opacity-60" />
        <span className="truncate">{label}</span>
        <span className="text-caption opacity-70">{items.length}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center flex-wrap gap-y-0.5">
        {items.map((item) => (
          <LinkChip key={item.key} data={item} />
        ))}
      </div>
    </div>
  )
}

/**
 * 文档元数据区的链接关系：当前文档引用的文档（出链）与引用当前文档的文档（反链）。
 * 纯计算展示、不可编辑——双链由正文内容与文件名决定，只允许在正文里增删，
 * 避免在元数据区误操作。出链实时取自编辑器内存内容（未保存也准确）；
 * 反链来自主进程的工作区双链快照，保存或外部改动后自动刷新。
 */
export default function WorkbenchLinkRelationsPanel(): JSX.Element | null {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const workspaceLinks = useWorkbenchStore((s) => s.workspaceLinks)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const fileSort = useWorkbenchStore((s) => s.fileSort)
  // 出链/反链属于笔记属性，折叠笔记属性时联动收起
  const frontmatterCollapsed = useWorkbenchStore((s) => s.frontmatterPanelCollapsed)

  const files = useMemo(() => flattenSortedFiles(fileTree, fileSort), [fileTree, fileSort])

  // 同一文件树下的解析结果可复用：反链需要把每个来源文件的每个目标串解到具体路径，
  // 目标串级 memo 把复杂度从 文件数×目标数×文件数 降到 独立目标数×文件数。
  const resolveTarget = useMemo(() => {
    const cache = new Map<string, WikiLinkResolution>()
    return (target: string): WikiLinkResolution => {
      const key = target.toLowerCase()
      const cached = cache.get(key)
      if (cached) return cached
      const resolution = resolveWikiLinkTarget(target, files)
      cache.set(key, resolution)
      return resolution
    }
  }, [files])

  const outgoing = useMemo<LinkChipData[]>(() => {
    // 按解析后的目标文件去重（Obsidian 语义）：
    // 同一文件用不同写法（[[B]] 与 [[dir/B.md]]）只算一个出链，取首次出现的形态；
    // 未解析的目标按目标串本身去重。
    const seen = new Set<string>()
    const result: LinkChipData[] = []
    for (const target of extractWikiLinkTargets(activeFileContent)) {
      const resolution = resolveTarget(target)
      const dedupeKey = resolution.path
        ? `p:${resolution.path.toLowerCase()}`
        : `t:${target.toLowerCase()}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      result.push(toChipData(target, resolution))
    }
    return result
  }, [activeFileContent, resolveTarget])

  const backlinks = useMemo<LinkChipData[]>(() => {
    if (!activeFilePath) return []
    const sources: string[] = []
    for (const entry of workspaceLinks) {
      // 自引用已在出链行展示，反链行不再重复列出自己
      if (entry.path === activeFilePath) continue
      const hits = entry.targets.some((target) => resolveTarget(target).path === activeFilePath)
      if (hits) sources.push(entry.path)
    }
    sources.sort((a, b) => a.localeCompare(b))
    const byPath = new Map(files.map((file) => [file.path, file]))
    return sources.map((sourcePath) => {
      const node = byPath.get(sourcePath) ?? null
      return {
        key: sourcePath,
        label: node ? linkChipLabel(node.name) : sourcePath.split('/').pop() || sourcePath,
        path: sourcePath,
        nodeName: node?.name ?? null,
        nodeFullPath: node?.fullPath ?? null,
        rawTarget: sourcePath
      }
    })
  }, [workspaceLinks, activeFilePath, resolveTarget, files])

  if (outgoing.length === 0 && backlinks.length === 0) return null
  if (frontmatterCollapsed) return null

  return (
    <div className="mb-4" data-link-relations-panel="true">
      <div className="mb-1 border-t border-black/5 dark:border-white/5" />
      {outgoing.length > 0 && (
        <RelationRow icon="arrow_outward" label="出链" items={outgoing} />
      )}
      {backlinks.length > 0 && (
        <RelationRow icon="arrow_back" label="反链" items={backlinks} />
      )}
    </div>
  )
}
