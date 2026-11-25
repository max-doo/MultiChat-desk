import type { AnnotationAnchor } from './annotations'

export const WORKBENCH_HTML_ANNOTATION_QUERY = 'workbench-annotate'
export const WORKBENCH_HTML_ANNOTATION_RUNTIME_QUERY = 'workbench-annotate-runtime'
export const WORKBENCH_HTML_ANNOTATION_STYLE_QUERY = 'workbench-annotate-style'
export const WORKBENCH_HTML_ANNOTATION_MESSAGE_SOURCE = 'multichat-workbench-html-annotation'
export const WORKBENCH_HTML_ANNOTATION_EVENT = 'workbench:html-annotate-selection'

export interface WorkbenchHtmlAnnotationRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface WorkbenchHtmlAnnotationFrameMessage {
  source?: string
  type?: string
  id?: string
  quote?: string
  anchor?: AnnotationAnchor
  rect?: WorkbenchHtmlAnnotationRect
  unlocated?: string[]
  error?: string
  zoom?: number
  direction?: -1 | 1
}
