import type { GitFileChange } from '../../../shared/types/workbench'

export type GitBadgeCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '!'

export interface GitStatusBadgeMeta {
  letter: GitBadgeCode
  colorClass: string
  bgClass: string
  label: string
  gitWord: string
  shortDesc: string
  tooltip: string
}

/**
 * 工作台统一的 Git 状态徽标映射：
 * 保留 Git 标准字母与英文原词，同时用简短中文说明降低非编程用户理解门槛。
 */
export const GIT_BADGE_STYLES: Record<GitBadgeCode, GitStatusBadgeMeta> = {
  M: {
    letter: 'M',
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-500/15',
    label: '已修改',
    gitWord: 'Modified',
    shortDesc: '较上次提交有改动',
    tooltip: '已修改 (Modified) · 较上次提交有改动'
  },
  U: {
    letter: 'U',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-500/15',
    label: '新文件',
    gitWord: 'Untracked',
    shortDesc: '本地新增文件',
    tooltip: '新文件 (Untracked) · 本地新增文件'
  },
  D: {
    letter: 'D',
    colorClass: 'text-rose-500',
    bgClass: 'bg-rose-500/15',
    label: '已删除',
    gitWord: 'Deleted',
    shortDesc: '已从本地移除',
    tooltip: '已删除 (Deleted) · 已从本地移除'
  },
  R: {
    letter: 'R',
    colorClass: 'text-blue-500',
    bgClass: 'bg-blue-500/15',
    label: '已重命名',
    gitWord: 'Renamed',
    shortDesc: '路径或名称已变更',
    tooltip: '已重命名 (Renamed) · 路径或名称已变更'
  },
  A: {
    letter: 'A',
    colorClass: 'text-teal-600 dark:text-teal-400',
    bgClass: 'bg-teal-500/15',
    label: '待提交',
    gitWord: 'Added',
    shortDesc: '已加入待提交的新文件',
    tooltip: '待提交 (Added) · 已加入待提交的新文件'
  },
  C: {
    letter: 'C',
    colorClass: 'text-sky-500',
    bgClass: 'bg-sky-500/15',
    label: '已复制',
    gitWord: 'Copied',
    shortDesc: '新增的复制文件',
    tooltip: '已复制 (Copied) · 新增的复制文件'
  },
  '!': {
    letter: '!',
    colorClass: 'text-rose-500',
    bgClass: 'bg-rose-500/15',
    label: '冲突',
    gitWord: 'Conflicted',
    shortDesc: '与远程改动重叠',
    tooltip: '冲突 (Conflicted) · 与远程改动重叠'
  }
}

export const GIT_BADGE_LEGEND_ORDER: GitBadgeCode[] = ['M', 'U', 'D', 'R', 'A', 'C', '!']

/** 目录徽标：取后代中优先级最高的状态 */
export const GIT_BADGE_PRIORITY: GitBadgeCode[] = ['!', 'D', 'M', 'U', 'R', 'C', 'A']

export function resolveFileGitBadge(change: GitFileChange): GitStatusBadgeMeta {
  if (change.conflicted) return GIT_BADGE_STYLES['!']
  if (change.untracked) return GIT_BADGE_STYLES.U
  if (change.unstaged === 'deleted' || change.staged === 'deleted') return GIT_BADGE_STYLES.D
  if (change.staged === 'renamed') return GIT_BADGE_STYLES.R
  if (change.staged === 'copied') return GIT_BADGE_STYLES.C
  if (change.staged === 'added') return GIT_BADGE_STYLES.A
  return GIT_BADGE_STYLES.M
}

export function mergeGitBadgeCodes(letters: Iterable<GitBadgeCode>): GitBadgeCode | null {
  const set = new Set(letters)
  for (const code of GIT_BADGE_PRIORITY) {
    if (set.has(code)) return code
  }
  return null
}
