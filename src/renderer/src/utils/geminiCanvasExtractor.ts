/**
 * Gemini Canvas 模式内容提取工具
 * 
 * 用于从 Gemini Canvas 模式中提取内容，通过模拟真实鼠标点击复制按钮
 * 来获取富文本格式的内容，然后转换为 Markdown 格式
 */

import TurndownService from 'turndown'

// 类型定义
interface CanvasCheckResult {
  isCanvas: boolean
  hasExportBtn?: boolean
  exportBtnPos?: { x: number; y: number }
}

interface CopyButtonResult {
  found: boolean
  selector?: string
  pos?: { x: number; y: number }
  debug?: {
    menuContentExists: boolean
    overlayExists: boolean
    overlayHTML: string
  }
}

interface ReferenceLink {
  index: number
  href: string
  domain: string
  title: string
}


interface WindowAPI {
  readClipboardText?: () => Promise<string>
  readClipboardHTML?: () => Promise<string>
  sendMouseClick?: (webContentsId: number, x: number, y: number) => Promise<{ success: boolean; error?: string }>
}

// ========== 注入到 Webview 的脚本 ==========

/**
 * 检测 Canvas 模式并获取导出按钮位置
 */
const CHECK_CANVAS_SCRIPT = `
  (function() {
    const canvasPanel = document.querySelector('immersive-panel, deep-research-immersive-panel, [class*="immersive-panel"]');
    if (!canvasPanel) {
      return { isCanvas: false };
    }
    
    const exportBtnSelectors = [
      'button[data-test-id="export-menu-button"]',
      '.export-menu-button',
      'button.toc-menu-button'
    ];
    
    let exportBtn = null;
    for (const sel of exportBtnSelectors) {
      exportBtn = document.querySelector(sel);
      if (exportBtn) break;
    }
    
    if (!exportBtn) {
      return { isCanvas: true, hasExportBtn: false };
    }
    
    const rect = exportBtn.getBoundingClientRect();
    return { 
      isCanvas: true, 
      hasExportBtn: true,
      exportBtnPos: { 
        x: rect.left + rect.width / 2, 
        y: rect.top + rect.height / 2 
      }
    };
  })();
`

/**
 * 查找复制按钮位置
 */
const FIND_COPY_BUTTON_SCRIPT = `
  (function() {
    const copyBtnSelectors = [
      '.mat-mdc-menu-content copy-button button[data-test-id="copy-button"]',
      '.mat-mdc-menu-content button[data-test-id="copy-button"]',
      '.cdk-overlay-container copy-button button[data-test-id="copy-button"]',
      '.cdk-overlay-container button[data-test-id="copy-button"]',
      'button[data-test-id="copy-button"]'
    ];
    
    for (const sel of copyBtnSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        const rect = btn.getBoundingClientRect();
        return { 
          found: true, 
          selector: sel,
          pos: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        };
      }
    }
    
    const menuContent = document.querySelector('.mat-mdc-menu-content');
    const overlay = document.querySelector('.cdk-overlay-container');
    return { 
      found: false, 
      debug: {
        menuContentExists: !!menuContent,
        overlayExists: !!overlay,
        overlayHTML: overlay?.innerHTML?.substring(0, 300) || ''
      }
    };
  })();
`

/**
 * 等待复制完成的 Toast 消息
 */
const WAIT_FOR_COPY_TOAST_SCRIPT = `
  (async function() {
    const toastKeywords = ['已复制', '复制', 'copied', 'clipboard'];
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 200));
      const elements = document.querySelectorAll('[class*="snackbar"], [class*="toast"], [role="status"], [aria-live]');
      for (const el of elements) {
        const text = el.textContent || '';
        if (toastKeywords.some(k => text.includes(k))) {
          return { success: true, toast: text };
        }
      }
    }
    return { success: false };
  })();
`

/**
 * 提取引用链接
 */
const EXTRACT_LINKS_SCRIPT = `
  (function() {
    const links = [];
    const canvasPanel = document.querySelector('immersive-panel, deep-research-immersive-panel');
    const sourceContainer = canvasPanel || document;
    
    const sourceList = sourceContainer.querySelector('.source-list');
    if (sourceList) {
      const items = sourceList.querySelectorAll('browse-web-item');
      items.forEach((item, index) => {
        const link = item.querySelector('a[href]');
        if (link) {
          const href = link.getAttribute('href') || '';
          if (href && !href.startsWith('javascript:')) {
            const displayName = item.querySelector('.display-name, [data-test-id="domain-name"]');
            const subTitle = item.querySelector('.sub-title, [data-test-id="sub-title"]');
            const domain = displayName ? displayName.textContent.trim() : '';
            const title = subTitle ? subTitle.textContent.trim() : '';
            links.push({ index: index + 1, href, domain, title });
          }
        }
      });
    }
    
    if (links.length === 0) {
      const allItems = sourceContainer.querySelectorAll('browse-web-item');
      allItems.forEach((item, index) => {
        const link = item.querySelector('a[href]');
        if (link) {
          const href = link.getAttribute('href') || '';
          if (href && !href.startsWith('javascript:')) {
            const displayName = item.querySelector('.display-name, [data-test-id="domain-name"]');
            const subTitle = item.querySelector('.sub-title, [data-test-id="sub-title"]');
            const domain = displayName ? displayName.textContent.trim() : '';
            const title = subTitle ? subTitle.textContent.trim() : '';
            links.push({ index: index + 1, href, domain, title });
          }
        }
      });
    }
    
    return links;
  })();
`

/**
 * 关闭菜单（按 Escape 键）
 */
const CLOSE_MENU_SCRIPT = `
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
`

// ========== 辅助函数 ==========

/**
 * 检测是否为 Canvas 模式
 */
async function checkCanvasMode(viewId: string): Promise<CanvasCheckResult | null> {
  try {
    const result = (await window.api.executeWebviewScript(viewId, CHECK_CANVAS_SCRIPT)).data
    console.log('[GeminiCanvasExtractor] Canvas 检测结果:', result)
    return result as CanvasCheckResult
  } catch (error) {
    console.error('[GeminiCanvasExtractor] Canvas 检测失败:', error)
    return null
  }
}

/**
 * 点击导出按钮
 */
async function clickExportButton(
  windowApi: WindowAPI,
  webContentsId: number,
  pos: { x: number; y: number }
): Promise<boolean> {
  if (!windowApi.sendMouseClick) {
    console.error('[GeminiCanvasExtractor] sendMouseClick API 不可用')
    return false
  }

  try {
    console.log('[GeminiCanvasExtractor] 点击导出按钮, 位置:', pos)
    const result = await windowApi.sendMouseClick(webContentsId, pos.x, pos.y)
    console.log('[GeminiCanvasExtractor] 导出按钮点击结果:', result)
    return result.success
  } catch (error) {
    console.error('[GeminiCanvasExtractor] 点击导出按钮失败:', error)
    return false
  }
}

/**
 * 查找并点击复制按钮
 */
async function findAndClickCopyButton(
  webview: WebviewAPI,
  windowApi: WindowAPI,
  webContentsId: number
): Promise<boolean> {
  try {
    // 等待菜单出现
    await new Promise(r => setTimeout(r, 500))

    // 查找复制按钮
    const copyBtnResult = await webview.executeJavaScript(FIND_COPY_BUTTON_SCRIPT) as CopyButtonResult
    console.log('[GeminiCanvasExtractor] 复制按钮查找结果:', copyBtnResult)

    if (!copyBtnResult?.found || !copyBtnResult?.pos) {
      // 关闭可能打开的菜单
      await webview.executeJavaScript(CLOSE_MENU_SCRIPT)
      return false
    }

    // 点击复制按钮
    if (!windowApi.sendMouseClick) {
      return false
    }

    console.log('[GeminiCanvasExtractor] 点击复制按钮, 位置:', copyBtnResult.pos)
    const clickResult = await windowApi.sendMouseClick(
      webContentsId,
      copyBtnResult.pos.x,
      copyBtnResult.pos.y
    )
    console.log('[GeminiCanvasExtractor] 复制按钮点击结果:', clickResult)
    return clickResult.success
  } catch (error) {
    console.error('[GeminiCanvasExtractor] 查找/点击复制按钮失败:', error)
    return false
  }
}

/**
 * 等待复制完成的 Toast 消息
 */
async function waitForCopyToast(viewId: string): Promise<boolean> {
  try {
    const result = await webview.executeJavaScript(WAIT_FOR_COPY_TOAST_SCRIPT)
    console.log('[GeminiCanvasExtractor] 等待复制结果:', result)
    return result?.success === true
  } catch (error) {
    console.error('[GeminiCanvasExtractor] 等待 Toast 失败:', error)
    return false
  }
}

/**
 * 读取剪贴板并转换为 Markdown
 */
async function readClipboardAndConvert(
  windowApi: WindowAPI,
  turndownService: TurndownService,
  clipboardBefore: string
): Promise<string | null> {
  // 额外等待确保剪贴板更新
  await new Promise(r => setTimeout(r, 300))

  // 优先读取 HTML 格式
  if (windowApi.readClipboardHTML) {
    try {
      const clipboardHTML = await windowApi.readClipboardHTML()
      console.log('[GeminiCanvasExtractor] 剪贴板 HTML 长度:', clipboardHTML?.length || 0)

      if (clipboardHTML && clipboardHTML.trim().length > 100) {
        const markdown = turndownService.turndown(clipboardHTML)
        console.log('[GeminiCanvasExtractor] 转换后 Markdown 长度:', markdown?.length || 0)

        if (markdown && markdown.trim().length > 100) {
          return markdown.trim()
        }
      }
    } catch (error) {
      console.error('[GeminiCanvasExtractor] HTML 转 Markdown 失败:', error)
    }
  }

  // 备选：读取纯文本
  if (windowApi.readClipboardText) {
    try {
      const clipboardText = await windowApi.readClipboardText()
      if (
        clipboardText &&
        clipboardText.trim().length > 100 &&
        clipboardText !== clipboardBefore
      ) {
        console.log('[GeminiCanvasExtractor] ✓ 使用纯文本备选')
        return clipboardText.trim()
      }
    } catch (error) {
      console.error('[GeminiCanvasExtractor] 读取纯文本失败:', error)
    }
  }

  return null
}

/**
 * 提取引用链接
 */
async function extractReferenceLinks(viewId: string): Promise<ReferenceLink[]> {
  try {
    const links = (await window.api.executeWebviewScript(viewId, EXTRACT_LINKS_SCRIPT)).data as ReferenceLink[]
    console.log('[GeminiCanvasExtractor] 提取到引用链接数量:', links?.length || 0)
    return links || []
  } catch (error) {
    console.log('[GeminiCanvasExtractor] 提取引用链接失败:', error)
    return []
  }
}

/**
 * 将引用链接格式化为 Markdown
 */
function formatReferenceLinks(links: ReferenceLink[]): string {
  if (links.length === 0) {
    return ''
  }

  let markdown = '\n\n---\n\n## 📚 参考来源\n\n'
  links.forEach((link) => {
    const linkText = link.title || link.domain || link.href
    const domainSuffix = link.domain && link.title ? ` - ${link.domain}` : ''
    markdown += `${link.index}. [${linkText}](${link.href})${domainSuffix}\n`
  })

  return markdown
}

// ========== 主函数 ==========

/**
 * 从 Gemini Canvas 模式提取内容
 * 
 * @param webview - Webview 实例，需要实现 executeJavaScript 和 getWebContentsId 方法
 * @param windowApi - Window API 对象，包含 readClipboardHTML、readClipboardText、sendMouseClick 方法
 * @param turndownService - Turndown 实例，用于 HTML 转 Markdown
 * @returns Promise<string | null> - 提取的 Markdown 内容，失败或非 Canvas 模式返回 null
 */
export async function extractGeminiCanvasContent(
  viewId: string,
  windowApi: any,
  turndownService: TurndownService
): Promise<string | null> {
  try {
    // 1. 检测 Canvas 模式
    const canvasCheck = await checkCanvasMode(viewId)
    if (!canvasCheck?.isCanvas || !canvasCheck?.hasExportBtn || !canvasCheck?.exportBtnPos) {
      return null
    }

    // 2. 记录复制前的剪贴板内容
    let clipboardBefore = ''
    if (windowApi.readClipboardText) {
      clipboardBefore = await windowApi.readClipboardText()
      console.log('[GeminiCanvasExtractor] 复制前剪贴板内容长度:', clipboardBefore?.length || 0)
    }

    // 3. 获取 webContents ID
    const wcRes = await window.api.getWebviewWebContentsId(viewId)
    const webContentsId = wcRes.success && wcRes.data ? wcRes.data.webContentsId : -1
    console.log('[GeminiCanvasExtractor] webContentsId:', webContentsId)

    // 4. 点击导出按钮
    const exportClicked = await clickExportButton(
      windowApi,
      webContentsId,
      canvasCheck.exportBtnPos
    )
    if (!exportClicked) {
      return null
    }

    // 5. 查找并点击复制按钮
    const copyClicked = await findAndClickCopyButton(viewId, windowApi, webContentsId)
    if (!copyClicked) {
      console.log('[GeminiCanvasExtractor] 复制按钮点击失败，回退到 DOM 爬取')
      return null
    }

    // 6. 等待复制完成
    await waitForCopyToast(viewId)

    // 7. 读取剪贴板并转换为 Markdown
    const markdown = await readClipboardAndConvert(windowApi, turndownService, clipboardBefore)
    if (!markdown) {
      console.log('[GeminiCanvasExtractor] 剪贴板内容无效，回退到 DOM 爬取')
      return null
    }

    // 8. 提取并拼接引用链接
    const links = await extractReferenceLinks(viewId)
    if (links.length > 0) {
      const linksMarkdown = formatReferenceLinks(links)
      const finalMarkdown = markdown.trim() + linksMarkdown
      console.log('[GeminiCanvasExtractor] ✓ 已拼接引用链接，最终长度:', finalMarkdown.length)
      return finalMarkdown
    }

    console.log('[GeminiCanvasExtractor] ✓ 从 Gemini 复制按钮获取到 Markdown 内容')
    return markdown
  } catch (error) {
    console.error('[GeminiCanvasExtractor] 提取失败:', error)
    return null
  }
}