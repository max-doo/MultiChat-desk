/** 统一格式化文件字节大小，避免预览组件各自实现。 */
export function formatFileSize(size: number | null | undefined, emptyFallback = ''): string {
  if (size === null || size === undefined) return emptyFallback
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
