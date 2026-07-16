/**
 * 千问深度研究报告内容提取工具
 *
 * 用户打开报告页后，通过模拟真实鼠标点击右侧面板顶部的复制按钮
 * 来获取报告内容（Markdown/HTML 格式），再转换为 Markdown。
 *
 * 参照 geminiCanvasExtractor.ts 的相同模式实现。
 */

import TurndownService from 'turndown'

interface WebviewAPI {
  executeJavaScript: (script: string) => Promise<any>
  getWebContentsId: () => number
}

interface WindowAPI {
  readClipboardText?: () => Promise<string>
  readClipboardHTML?: () => Promise<string>
  sendMouseClick?: (
    webContentsId: number,
    x: number,
    y: number
  ) => Promise<{ success: boolean; error?: string }>
}

interface CopyButtonResult {
  found: boolean
  pos?: { x: number; y: number }
}

// ========== 注入到 Webview 的脚本 ==========

/**
 * 检测右侧面板的复制按钮是否存在并可见，返回其坐标
 */
const CHECK_COPY_BUTTON_SCRIPT = `
  (function() {
    // 多候选选择器，防止 CSS hash 变化
    const selectors = [
      'div.item-icon-y_fPPG',
      '[data-testid="qianwen-layout-right-panel"] [class*="right-tools"] [class*="item-icon"]',
      '[data-testid="qianwen-layout-right-panel"] [class*="item-icon"]',
      '#qianwen-layout-right-panel [class*="right-tools"] [class*="item-icon"]',
      '#qianwen-layout-right-panel [class*="item-icon"]'
    ];

    for (const sel of selectors) {
      let el = null;
      try { el = document.querySelector(sel); } catch (_) {}
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      return {
        found: true,
        pos: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        }
      };
    }

    return { found: false };
  })();
`

// ========== 主函数 ==========

/**
 * 从千问深度研究报告页提取内容
 *
 * 前提：用户已点击报告卡片，报告页面已打开（复制按钮可见）。
 *
 * @param webview    - Webview 实例
 * @param windowApi  - Window API（readClipboardHTML / readClipboardText / sendMouseClick）
 * @param turndownService - Turndown 实例，用于 HTML 转 Markdown
 * @returns Promise<string | null> - 提取的 Markdown 内容；未检测到报告页则返回 null
 */
export async function extractQwenReportContent(
  webview: WebviewAPI,
  windowApi: WindowAPI,
  turndownService: TurndownService
): Promise<string | null> {
  try {
    // 1. 检测复制按钮是否可见
    const checkResult = (await webview.executeJavaScript(
      CHECK_COPY_BUTTON_SCRIPT
    )) as CopyButtonResult
    console.log('[QwenReportExtractor] 复制按钮检测结果:', checkResult)

    if (!checkResult?.found || !checkResult?.pos) {
      // 报告页未打开，回退到普通 DOM 爬取
      return null
    }

    // 2. 记录复制前的剪贴板内容（用于判断是否写入成功）
    let clipboardBefore = ''
    if (windowApi.readClipboardText) {
      try {
        clipboardBefore = await windowApi.readClipboardText()
      } catch { /* ignore */ }
    }

    // 3. 获取 webContents ID
    const webContentsId = webview.getWebContentsId()
    console.log('[QwenReportExtractor] webContentsId:', webContentsId)

    // 4. 真实鼠标点击复制按钮
    if (!windowApi.sendMouseClick) {
      console.error('[QwenReportExtractor] sendMouseClick API 不可用')
      return null
    }

    const { x, y } = checkResult.pos
    console.log('[QwenReportExtractor] 点击复制按钮，位置:', { x, y })
    const clickResult = await windowApi.sendMouseClick(webContentsId, x, y)
    console.log('[QwenReportExtractor] 点击结果:', clickResult)

    if (!clickResult?.success) {
      console.warn('[QwenReportExtractor] 点击失败')
      return null
    }

    // 5. 等待剪贴板更新
    await new Promise((r) => setTimeout(r, 400))

    // 6. 优先读取 HTML 格式并转 Markdown
    if (windowApi.readClipboardHTML) {
      try {
        const html = await windowApi.readClipboardHTML()
        console.log('[QwenReportExtractor] 剪贴板 HTML 长度:', html?.length ?? 0)

        if (html && html.trim().length > 50) {
          const markdown = turndownService.turndown(html)
          if (markdown && markdown.trim().length > 50) {
            console.log('[QwenReportExtractor] ✓ 从 HTML 转换 Markdown，长度:', markdown.length)
            return markdown.trim()
          }
        }
      } catch (e) {
        console.warn('[QwenReportExtractor] HTML 转 Markdown 失败:', e)
      }
    }

    // 7. 备选：读取纯文本
    if (windowApi.readClipboardText) {
      try {
        const text = await windowApi.readClipboardText()
        if (text && text.trim().length > 50 && text !== clipboardBefore) {
          console.log('[QwenReportExtractor] ✓ 使用纯文本备选，长度:', text.length)
          return text.trim()
        }
      } catch (e) {
        console.warn('[QwenReportExtractor] 读取纯文本失败:', e)
      }
    }

    console.warn('[QwenReportExtractor] 剪贴板内容无效或未变化，回退到 DOM 爬取')
    return null
  } catch (error) {
    console.error('[QwenReportExtractor] 提取失败:', error)
    return null
  }
}
