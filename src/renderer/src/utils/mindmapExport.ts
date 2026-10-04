import { globalCSS } from 'markmap-view'
import mindmapCSS from '../styles/localMindmap.css?inline'

interface PreparedMindmapSvg {
  svgString: string
  width: number
  height: number
  title: string
}

function prepareExportSvg(svgEl: SVGSVGElement | null, title: string): PreparedMindmapSvg | null {
  const gEl = svgEl?.querySelector('g')
  if (!svgEl || !gEl) return null

  const bbox = gEl.getBBox()
  const padding = 40
  const minX = Math.floor(bbox.x - padding)
  const minY = Math.floor(bbox.y - padding)
  const width = Math.max(200, Math.ceil(bbox.width + padding * 2))
  const height = Math.max(100, Math.ceil(bbox.height + padding * 2))
  const clone = svgEl.cloneNode(true) as SVGSVGElement

  // 导出正文，不保留选中、编辑和操作按钮；去掉画布的平移/缩放，使用内容坐标。
  clone.querySelector('g')?.removeAttribute('transform')
  clone.querySelectorAll('.mm-selected, .mm-editing').forEach(el => {
    el.classList.remove('mm-selected', 'mm-editing')
  })
  clone.querySelectorAll('.mm-node-btns-anchor').forEach(el => el.remove())
  clone.querySelectorAll('[contenteditable], [data-original-text]').forEach(el => {
    el.removeAttribute('contenteditable')
    el.removeAttribute('data-original-text')
  })

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`)
  clone.setAttribute('width', `${width}`)
  clone.setAttribute('height', `${height}`)
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.background = '#ffffff'

  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bgRect.setAttribute('x', `${minX}`)
  bgRect.setAttribute('y', `${minY}`)
  bgRect.setAttribute('width', `${width}`)
  bgRect.setAttribute('height', `${height}`)
  bgRect.setAttribute('fill', '#ffffff')
  clone.insertBefore(bgRect, clone.firstChild)

  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  styleEl.textContent = `${globalCSS}\n${mindmapCSS}\n
    .mm-node-item { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .mm-node-l2, .mm-node-l2:hover { background-color: transparent !important; }
    .mm-node-btns-anchor { display: none !important; }
  `
  clone.insertBefore(styleEl, clone.firstChild)

  return {
    svgString: new XMLSerializer().serializeToString(clone),
    width,
    height,
    title: title.replace(/<[^>]*>/g, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'mindmap'
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}

export function exportMindmapSvg(svgEl: SVGSVGElement | null, title: string): string {
  try {
    const data = prepareExportSvg(svgEl, title)
    if (!data) return '导出失败，未找到导图内容'
    downloadBlob(new Blob([data.svgString], { type: 'image/svg+xml;charset=utf-8' }), `${data.title}.svg`)
    return 'SVG 已导出'
  } catch {
    return '导出 SVG 失败'
  }
}

export async function exportMindmapPng(svgEl: SVGSVGElement | null, title: string): Promise<string> {
  try {
    const data = prepareExportSvg(svgEl, title)
    if (!data) return '导出失败，未找到导图内容'
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('无法加载导图 SVG'))
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data.svgString)))}`
    })

    const canvas = document.createElement('canvas')
    canvas.width = data.width * 2
    canvas.height = data.height * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) return '导出失败，无法创建画布'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return '导出失败'
    downloadBlob(blob, `${data.title}.png`)
    return 'PNG 图片已导出'
  } catch {
    return '导出 PNG 失败'
  }
}
