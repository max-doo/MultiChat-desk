/**
 * 把 docx 预览渲染产物中的 WMF/EMF 内嵌图片转换为 PNG data URL。
 *
 * docx-preview 对图片只做 blob URL 透传，不做格式转换；WMF/EMF 是 Windows
 * 图元文件，Chromium 没有解码器，一律渲染为裂图（高校论文模板的封面校徽
 * 几乎都是这种格式）。转换走 @mlightcad/emf-converter 的 canvas 重放，
 * 用 maxWidth/maxHeight 把最终位图尺寸钉死在硬上限内——矢量图元的逻辑
 * 坐标系可能很大，不设上限一张封面图就能渲染出 8000px 宽的位图。
 */

// 最终位图边长上限（像素）。按显示尺寸约 600px、3 倍缩放余量取值，
// 位图内存峰值约 1600*1600*4 ≈ 10MB/张，实际 PNG 输出远小于此。
const METAFILE_MAX_OUTPUT_PX = 1600

const METAFILE_MIME_RE = /(?:^|\/)[x-]*(wmf|emf)$/i

// 浏览器原生可解码的格式直接跳过，不做字节嗅探
const BROWSER_NATIVE_IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i

// EMF 文件头：type=1、signature=' EMF'（0x464D4520）
const EMF_SIGNATURE = 0x464d4520

type MetafileFormat = 'wmf' | 'emf'

function sniffMetafileFormat(header: DataView): MetafileFormat | null {
  if (header.byteLength < 4) return null
  // 可放置 WMF（Aldus placeable header）：0x9AC6CDD7
  if (header.getUint32(0, true) === 0x9ac6cdd7) return 'wmf'
  // 标准 WMF：type 1（内存）或 2（文件）
  const wmfType = header.getUint16(0, true)
  if (wmfType === 1 || wmfType === 2) return 'wmf'
  if (header.byteLength >= 44 && header.getUint32(40, true) === EMF_SIGNATURE) return 'emf'
  return null
}

function formatFromMime(mime: string): MetafileFormat | null {
  const match = mime.match(METAFILE_MIME_RE)
  if (!match) return null
  return match[1].toLowerCase() === 'emf' ? 'emf' : 'wmf'
}

async function convertMetafileImage(img: HTMLImageElement, blobUrl: string): Promise<void> {
  const response = await fetch(blobUrl)
  const blob = await response.blob()
  if (BROWSER_NATIVE_IMAGE_MIME_RE.test(blob.type)) return

  const bytes = await blob.arrayBuffer()
  const format = formatFromMime(blob.type) ?? sniffMetafileFormat(new DataView(bytes, 0, Math.min(bytes.byteLength, 64)))
  if (!format) return

  // 依赖按文档懒加载（emf-converter 约 163KB），只有真的遇到图元文件才付出成本
  const converter = await import('@mlightcad/emf-converter')
  const convert = format === 'emf' ? converter.convertEmfToDataUrl : converter.convertWmfToDataUrl
  const dataUrl = await convert(bytes, {
    dpiScale: 2,
    maxWidth: METAFILE_MAX_OUTPUT_PX,
    maxHeight: METAFILE_MAX_OUTPUT_PX
  })
  if (!dataUrl) {
    console.warn('[docxMetafileImages] 图元文件转换返回空，保留原始裂图', { format, size: bytes.byteLength })
    return
  }

  img.src = dataUrl
  // data URL 不占用 blob 存储，原 blob URL 立即回收；
  // 若此时才回收失败，卸载阶段的统一回收逻辑会兜底（src 已不是 blob，顶多漏掉这一个）
  URL.revokeObjectURL(blobUrl)
}

/**
 * 扫描容器内所有 blob 图，把其中 WMF/EMF 原位替换为 PNG。
 * 需要在文档 DOM 换入容器后、展示给用户前调用；非图元图片几乎零成本。
 */
export async function convertMetafileImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src^="blob:"]'))
  if (images.length === 0) return

  const tasks = images.map(async (img) => {
    const blobUrl = img.src
    try {
      await convertMetafileImage(img, blobUrl)
    } catch (error) {
      console.warn('[docxMetafileImages] 图元文件转换失败，保留原始裂图', error)
    }
  })
  await Promise.all(tasks)
}
