export type MindmapInlineFormat = 'bold' | 'highlight'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only the two inline formats supported by the node toolbar are rendered. */
export function renderMindmapInlineFormat(source: string): string {
  return escapeHtml(source)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
}

export function stripMindmapInlineFormat(source: string): string {
  let text = source
  for (let i = 0; i < 2; i++) {
    text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/==(.+?)==/g, '$1')
  }
  return text
}

function splitWholeNodeFormat(source: string): { text: string; bold: boolean; highlight: boolean } {
  let text = source
  let bold = false
  let highlight = false
  for (let i = 0; i < 2; i++) {
    if (!bold && text.startsWith('**') && text.endsWith('**') && text.length > 4 && !text.slice(2, -2).includes('**')) {
      bold = true
      text = text.slice(2, -2)
    } else if (!highlight && text.startsWith('==') && text.endsWith('==') && text.length > 4 && !text.slice(2, -2).includes('==')) {
      highlight = true
      text = text.slice(2, -2)
    }
  }
  return { text, bold, highlight }
}

export function hasWholeNodeFormat(source: string, format: MindmapInlineFormat): boolean {
  return splitWholeNodeFormat(source)[format]
}

export function editableMindmapContent(source: string): string {
  const whole = splitWholeNodeFormat(source)
  return whole.bold || whole.highlight ? whole.text : source
}

export function toggleWholeNodeFormat(source: string, format: MindmapInlineFormat): string {
  const current = splitWholeNodeFormat(source)
  const enabled = !current[format]
  // Applying a format to the whole node replaces any smaller spans of that same format.
  const text = enabled
    ? format === 'bold'
      ? current.text.replace(/\*\*(.+?)\*\*/g, '$1')
      : current.text.replace(/==(.+?)==/g, '$1')
    : current.text
  const boldText = (format === 'bold' ? enabled : current.bold) ? `**${text}**` : text
  return (format === 'highlight' ? enabled : current.highlight) ? `==${boldText}==` : boldText
}

/** Preserve whole-node toolbar formatting when editing replaces its rendered elements. */
export function retainWholeNodeFormat(original: string, edited: string): string {
  let result = edited
  for (const format of ['bold', 'highlight'] as const) {
    if (hasWholeNodeFormat(original, format) && !hasWholeNodeFormat(result, format)) {
      result = toggleWholeNodeFormat(result, format)
    }
  }
  return result
}

/** Read only the supported formatting from a contenteditable node. */
export function readMindmapInlineFormat(element: HTMLElement): string {
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.tagName === 'BR') return ' '
    const text = Array.from(node.childNodes, read).join('')
    if (node.tagName === 'STRONG' || node.tagName === 'B') return text ? `**${text}**` : ''
    if (node.tagName === 'MARK') return text ? `==${text}==` : ''
    if (node.tagName === 'DIV' || node.tagName === 'P') return `${text} `
    return text
  }
  const edited = Array.from(element.childNodes, read).join('').replace(/[\r\n]+/g, ' ').trim()
  return retainWholeNodeFormat(element.getAttribute('data-original-text') || '', edited)
}
