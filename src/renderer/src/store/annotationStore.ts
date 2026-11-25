import { create } from 'zustand'
import type {
  Annotation,
  AnnotationAnchorReason,
  AnnotationAnchorState
} from '../../../shared/types/annotations'
import { isUnresolvedAnchorState } from '../../../shared/utils/annotationAnchors'

export type AnnotationFilter = 'all' | 'document' | 'source' | 'unlocated'

export interface AnnotationResolution {
  state: AnnotationAnchorState
  reason?: AnnotationAnchorReason
}

interface AnnotationState {
  workspaceRoot: string | null
  relativePath: string | null
  documentAnnotations: Annotation[]
  sourceAnnotations: Annotation[]
  sourceKey: string | null
  unlocatedIds: string[]
  resolutionById: Record<string, AnnotationResolution>
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
  setResolution: (id: string, resolution: AnnotationResolution) => void
  setResolutions: (entries: Array<{ id: string } & AnnotationResolution>, token?: number) => void
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
  resolutionById: {},
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
    resolutionById: {},
    selectedId: null,
    error: null,
    loading: Boolean(relativePath),
    token: state.token + 1
  })),

  setDocumentAnnotations: (items, token) => {
    if (token !== get().token) return
    set(state => {
      const nextResolution = { ...state.resolutionById }
      const nextIds = new Set(items.map(item => item.id))
      for (const previous of state.documentAnnotations) {
        if (!nextIds.has(previous.id)) delete nextResolution[previous.id]
      }
      for (const item of items) {
        if (item.anchorState) {
          nextResolution[item.id] = {
            state: item.anchorState,
            reason: item.anchorReason
          }
        } else {
          delete nextResolution[item.id]
        }
      }
      return {
        documentAnnotations: items,
        resolutionById: nextResolution,
        unlocatedIds: Object.entries(nextResolution)
          .filter(([, resolution]) => isUnresolvedAnchorState(resolution.state))
          .map(([id]) => id)
      }
    })
  },
  setSourceAnnotations: (items, token) => {
    if (token !== get().token) return
    set(state => {
      const nextResolution = { ...state.resolutionById }
      const nextIds = new Set(items.map(item => item.id))
      for (const previous of state.sourceAnnotations) {
        if (!nextIds.has(previous.id)) delete nextResolution[previous.id]
      }
      return {
        sourceAnnotations: items,
        resolutionById: nextResolution,
        unlocatedIds: Object.entries(nextResolution)
          .filter(([, resolution]) => isUnresolvedAnchorState(resolution.state))
          .map(([id]) => id)
      }
    })
  },
  setUnlocated: (ids, token) => {
    if (token !== get().token) return
    set({ unlocatedIds: ids })
  },
  setResolution: (id, resolution) => set(state => {
    const resolutionById = { ...state.resolutionById, [id]: resolution }
    return {
      resolutionById,
      unlocatedIds: Object.entries(resolutionById)
        .filter(([, item]) => isUnresolvedAnchorState(item.state))
        .map(([itemId]) => itemId)
    }
  }),
  setResolutions: (entries, token) => {
    if (typeof token === 'number' && token !== get().token) return
    set(state => {
      let changed = false
      for (const entry of entries) {
        const prev = state.resolutionById[entry.id]
        if (!prev || prev.state !== entry.state || prev.reason !== entry.reason) {
          changed = true
          break
        }
      }
      if (!changed) return state
      const resolutionById = { ...state.resolutionById }
      for (const entry of entries) {
        resolutionById[entry.id] = { state: entry.state, reason: entry.reason }
      }
      const nextUnlocated = Object.entries(resolutionById)
        .filter(([, resolution]) => isUnresolvedAnchorState(resolution.state))
        .map(([id]) => id)
      const sameUnlocated =
        nextUnlocated.length === state.unlocatedIds.length &&
        nextUnlocated.every((id, idx) => id === state.unlocatedIds[idx])
      return {
        resolutionById,
        unlocatedIds: sameUnlocated ? state.unlocatedIds : nextUnlocated
      }
    })
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
    resolutionById: Object.fromEntries(
      Object.entries(state.resolutionById).filter(([itemId]) => itemId !== id)
    ),
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
    case 'unlocated': return all.filter(item => isUnresolvedAnchorState(state.resolutionById[item.id]?.state))
    default: return all
  }
}
