import { create } from 'zustand'
import type { Annotation } from '../../../shared/types/annotations'

export type AnnotationFilter = 'all' | 'document' | 'source' | 'unlocated'

interface AnnotationState {
  workspaceRoot: string | null
  relativePath: string | null
  documentAnnotations: Annotation[]
  sourceAnnotations: Annotation[]
  sourceKey: string | null
  unlocatedIds: string[]
  selectedId: string | null
  filter: AnnotationFilter
  loading: boolean
  error: string | null
  /** 每次文档切换递增，防止异步加载把上一份标注写进新文档。 */
  token: number
}

interface AnnotationActions {
  resetForDocument: (workspaceRoot: string | null, relativePath: string | null, sourceKey: string | null) => void
  setDocumentAnnotations: (items: Annotation[], token: number) => void
  setSourceAnnotations: (items: Annotation[], token: number) => void
  setUnlocated: (ids: string[], token: number) => void
  upsertLocal: (annotation: Annotation) => void
  removeLocal: (id: string) => void
  setSelected: (id: string | null) => void
  setFilter: (filter: AnnotationFilter) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export type AnnotationStore = AnnotationState & AnnotationActions

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  workspaceRoot: null,
  relativePath: null,
  documentAnnotations: [],
  sourceAnnotations: [],
  sourceKey: null,
  unlocatedIds: [],
  selectedId: null,
  filter: 'all',
  loading: false,
  error: null,
  token: 0,

  resetForDocument: (workspaceRoot, relativePath, sourceKey) => set(state => ({
    workspaceRoot,
    relativePath,
    sourceKey,
    documentAnnotations: [],
    sourceAnnotations: [],
    unlocatedIds: [],
    selectedId: null,
    error: null,
    loading: Boolean(relativePath),
    token: state.token + 1
  })),

  setDocumentAnnotations: (items, token) => {
    if (token !== get().token) return
    set({ documentAnnotations: items })
  },
  setSourceAnnotations: (items, token) => {
    if (token !== get().token) return
    set({ sourceAnnotations: items })
  },
  setUnlocated: (ids, token) => {
    if (token !== get().token) return
    set({ unlocatedIds: ids })
  },
  upsertLocal: (annotation) => set(state => {
    const bucket = annotation.scope === 'document' ? 'documentAnnotations' : 'sourceAnnotations'
    const items = state[bucket]
    const exists = items.some(item => item.id === annotation.id)
    return {
      [bucket]: exists
        ? items.map(item => item.id === annotation.id ? annotation : item)
        : [...items, annotation]
    }
  }),
  removeLocal: (id) => set(state => ({
    documentAnnotations: state.documentAnnotations.filter(item => item.id !== id),
    sourceAnnotations: state.sourceAnnotations.filter(item => item.id !== id),
    unlocatedIds: state.unlocatedIds.filter(item => item !== id),
    selectedId: state.selectedId === id ? null : state.selectedId
  })),
  setSelected: (id) => set({ selectedId: id }),
  setFilter: (filter) => set({ filter }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}))

export const visibleAnnotations = (state: AnnotationStore): Annotation[] => {
  const all = [...state.documentAnnotations, ...state.sourceAnnotations]
  switch (state.filter) {
    case 'document': return all.filter(item => item.scope === 'document')
    case 'source': return all.filter(item => item.scope === 'source')
    case 'unlocated': return all.filter(item => state.unlocatedIds.includes(item.id))
    default: return all
  }
}
