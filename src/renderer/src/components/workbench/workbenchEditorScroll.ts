export type WorkbenchEditorScrollMode = 'wysiwyg' | 'source'

const scrollPositions = new Map<string, number>()

function scrollKey(
  workspacePath: string | null,
  relativePath: string,
  mode: WorkbenchEditorScrollMode
): string {
  return `${workspacePath ?? ''}\n${relativePath}\n${mode}`
}

export function readEditorScroll(
  workspacePath: string | null,
  relativePath: string,
  mode: WorkbenchEditorScrollMode
): number {
  return scrollPositions.get(scrollKey(workspacePath, relativePath, mode)) ?? 0
}

export function rememberEditorScroll(
  workspacePath: string | null,
  relativePath: string,
  mode: WorkbenchEditorScrollMode,
  top: number
): void {
  if (!Number.isFinite(top) || top <= 0) {
    scrollPositions.delete(scrollKey(workspacePath, relativePath, mode))
    return
  }
  scrollPositions.set(scrollKey(workspacePath, relativePath, mode), top)
}
