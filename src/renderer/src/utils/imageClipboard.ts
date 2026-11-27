/**
 * 渲染层图片解码、栅格化与剪贴板写入工具：
 * - 直接解析 data: URL，不走 fetch()，避免受 CSP connect-src 限制或拖出超长 base64 文件名；
 * - SVG / WebP / BMP / GIF 等非 PNG/JPEG 格式通过 canvas 转为 PNG 后写入剪贴板；
 * - 优先通过主进程 nativeImage + clipboard.writeImage 写剪贴板，避免跨源 iframe 聚焦时 navigator.clipboard 报 Document is not focused。
 */

const MIME_EXT_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico'
}

export function getImageExtFromMime(mimeType: string): string {
  const normalized = mimeType.split(';')[0].trim().toLowerCase()
  if (MIME_EXT_MAP[normalized]) return MIME_EXT_MAP[normalized]
  if (normalized.startsWith('image/')) {
    const raw = normalized.slice('image/'.length).replace(/[^a-z0-9]/gi, '')
    return `.${raw || 'png'}`
  }
  return '.png'
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',')
  if (!/^data:/i.test(dataUrl) || commaIndex === -1) {
    throw new Error('无效的 data URL')
  }
  const header = dataUrl.slice(5, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  const parts = header
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  const isBase64 = parts.some((p) => p.toLowerCase() === 'base64')
  const rawMime = parts.find((p) => !p.includes('=') && p.toLowerCase() !== 'base64')?.toLowerCase()
  const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime || 'application/octet-stream'

  if (isBase64) {
    const normalized = payload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mimeType })
  }

  let decoded = payload
  try {
    decoded = decodeURIComponent(payload)
  } catch {
    // 非法百分号编码时保留原始文本
  }
  return new Blob([decoded], { type: mimeType })
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

function parseSvgDimensions(svgText: string): { width: number; height: number } {
  const viewBoxMatch = svgText.match(/\bviewBox\s*=\s*["']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*["']/i)
  if (viewBoxMatch) {
    const w = Number(viewBoxMatch[3])
    const h = Number(viewBoxMatch[4])
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: Math.round(w), height: Math.round(h) }
    }
  }
  return { width: 800, height: 600 }
}

async function canvasExportPng(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  draw(ctx)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new Error('图片转码失败')
  return png
}

export async function rasterizeBlobToPngBlob(blob: Blob, sourceUrl?: string): Promise<Blob> {
  if (blob.type !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      try {
        return await canvasExportPng(bitmap.width, bitmap.height, (ctx) => {
          ctx.drawImage(bitmap, 0, 0)
        })
      } finally {
        bitmap.close()
      }
    } catch {
      // 回退到 HTMLImageElement（例如部分 BMP/ICO/SVG）
    }
  }

  let objectUrl: string | null = null
  try {
    const targetSrc = sourceUrl && /^data:/i.test(sourceUrl) ? sourceUrl : (objectUrl = URL.createObjectURL(blob))
    const img = await loadImageElement(targetSrc)
    let width = img.naturalWidth
    let height = img.naturalHeight
    if (width <= 0 || height <= 0) {
      if (blob.type === 'image/svg+xml') {
        const fallback = parseSvgDimensions(await blob.text())
        width = fallback.width
        height = fallback.height
      } else {
        width = img.width || 800
        height = img.height || 600
      }
    }
    return await canvasExportPng(width, height, (ctx) => {
      ctx.drawImage(img, 0, 0, width, height)
    })
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

async function writeImageBytesToClipboard(
  bytes: Uint8Array,
  pngBlobProvider: () => Promise<Blob>
): Promise<void> {
  const ipcResult = await window.api?.workbench?.copyImageBuffer?.(bytes)
  if (ipcResult?.success) return

  const pngBlob = await pngBlobProvider()
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
}

async function copyImageBlobToClipboard(blob: Blob, sourceUrl?: string): Promise<void> {
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await writeImageBytesToClipboard(bytes, () =>
      blob.type === 'image/png' ? Promise.resolve(blob) : rasterizeBlobToPngBlob(blob, sourceUrl)
    )
    return
  }

  const pngBlob = await rasterizeBlobToPngBlob(blob, sourceUrl)
  const bytes = new Uint8Array(await pngBlob.arrayBuffer())
  await writeImageBytesToClipboard(bytes, () => Promise.resolve(pngBlob))
}

export async function copyImageElementToClipboard(img: HTMLImageElement): Promise<void> {
  const blob = /^data:/i.test(img.src)
    ? dataUrlToBlob(img.src)
    : await fetch(img.src).then((res) => {
        if (!res.ok) throw new Error(`下载失败: ${res.status}`)
        return res.blob()
      })
  await copyImageBlobToClipboard(blob, img.src)
}

export async function copyHtmlImageToClipboard(
  srcURL: string,
  coords?: { x: number; y: number }
): Promise<void> {
  if (/^data:/i.test(srcURL)) {
    const blob = dataUrlToBlob(srcURL)
    await copyImageBlobToClipboard(blob, srcURL)
    return
  }

  if (srcURL.startsWith('workbench-file://')) {
    const res = await window.api?.workbench?.copyHtmlImageFromUrl?.(srcURL)
    if (res?.success) return
    if (res?.data?.dataUrl) {
      const blob = dataUrlToBlob(res.data.dataUrl)
      await copyImageBlobToClipboard(blob, res.data.dataUrl)
      return
    }
    if (coords) {
      const fallback = await window.api?.workbench?.copyHtmlImageAt?.(coords.x, coords.y)
      if (fallback?.success) return
    }
    throw new Error(res?.error || '复制图片失败')
  }

  try {
    const blob = await fetch(srcURL).then((res) => {
      if (!res.ok) throw new Error(`下载失败: ${res.status}`)
      return res.blob()
    })
    await copyImageBlobToClipboard(blob, srcURL)
  } catch (err) {
    if (coords) {
      const fallback = await window.api?.workbench?.copyHtmlImageAt?.(coords.x, coords.y)
      if (fallback?.success) return
    }
    throw err
  }
}
